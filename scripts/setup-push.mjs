// 通知（F09 の C・E）の準備を Supabase に反映する。鍵や合言葉は画面にもリポジトリにも出さない。
//   1. 通知用の鍵（VAPID）を作る（すでにあれば使い回す。--rotate で作り直し）
//   2. 公開鍵を DB（private.app_config）に、秘密鍵と合言葉を Edge Function のシークレットに置く
//   3. Edge Function `notify` を配備する
//   4. pg_cron が呼ぶ先（URL と合言葉）を Vault に置き、毎日の予定を登録する（migrations/0008）
//
// 使い方: SUPABASE_PROJECT_REF=xxxx node scripts/setup-push.mjs [--rotate]
// （Management API の認証は SUPABASE_ACCESS_TOKEN。Claude のクラウド環境ではプロキシが自動で付ける）
// HTTP は curl で行う（プロキシ環境でもそのまま動くため）。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, webcrypto } from 'node:crypto';

const REF = process.env.SUPABASE_PROJECT_REF;
if (!REF) throw new Error('SUPABASE_PROJECT_REF を指定してください');
const API = `https://api.supabase.com/v1/projects/${REF}`;
const rotate = process.argv.includes('--rotate');
const root = new URL('..', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'push-'));

function curl(args, body) {
  const auth = process.env.SUPABASE_ACCESS_TOKEN ? ['-H', `Authorization: Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`] : [];
  let input;
  if (body !== undefined) {
    const f = join(tmp, 'body.json');
    writeFileSync(f, JSON.stringify(body), { mode: 0o600 });
    args = [...args, '-H', 'Content-Type: application/json', '--data-binary', `@${f}`];
  }
  const out = execFileSync('curl', ['-sS', '--fail-with-body', ...auth, ...args], { input, encoding: 'utf8' });
  return out ? JSON.parse(out) : null;
}
const sql = (query) => curl(['-X', 'POST', `${API}/database/query`], { query });
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

try {
  console.log('== 0007_push.sql');
  sql(readFileSync(join(root, 'supabase/migrations/0007_push.sql'), 'utf8'));

  const existing = sql(`select value from private.app_config where key = 'vapid_public_key'`);
  let publicKey = existing[0]?.value;
  if (!publicKey || rotate) {
    console.log('== 通知用の鍵を作成');
    const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
    const privateJwk = await webcrypto.subtle.exportKey('jwk', kp.privateKey);
    const cronSecret = randomBytes(32).toString('base64url');
    curl(['-X', 'POST', `${API}/secrets`], [
      { name: 'VAPID_PUBLIC_KEY', value: publicKey },
      { name: 'VAPID_PRIVATE_JWK', value: JSON.stringify(privateJwk) },
      { name: 'VAPID_SUBJECT', value: 'https://asih-collab.github.io/cashflow-app/' },
      { name: 'CRON_SECRET', value: cronSecret },
    ]);
    sql(`insert into private.app_config (key, value) values ('vapid_public_key', ${lit(publicKey)})
         on conflict (key) do update set value = excluded.value`);
    // 鍵を作り直したら、古い鍵での購読は使えないので消す（端末でもう一度オンにしてもらう）
    if (rotate) sql('delete from public.push_subscriptions');
    sql(`do $$ declare i uuid; begin
           select id into i from vault.secrets where name = 'notify_cron_secret';
           if i is null then perform vault.create_secret(${lit(cronSecret)}, 'notify_cron_secret');
           else perform vault.update_secret(i, ${lit(cronSecret)}); end if;
           select id into i from vault.secrets where name = 'notify_url';
           if i is null then perform vault.create_secret(${lit(`https://${REF}.supabase.co/functions/v1/notify`)}, 'notify_url');
           else perform vault.update_secret(i, ${lit(`https://${REF}.supabase.co/functions/v1/notify`)}); end if;
         end $$`);
  } else {
    console.log('== 通知用の鍵はすでにあります（作り直す場合は --rotate）');
  }

  console.log('== Edge Function notify を配備');
  const dir = join(root, 'supabase/functions/notify');
  const res = curl([
    '-X', 'POST', `${API}/functions/deploy?slug=notify`,
    '-F', `metadata=${JSON.stringify({ entrypoint_path: 'index.ts', name: 'notify', verify_jwt: false })};type=application/json`,
    '-F', `file=@${join(dir, 'index.ts')};filename=index.ts`,
    '-F', `file=@${join(dir, 'webpush.ts')};filename=webpush.ts`,
    '-F', `file=@${join(dir, 'logic.ts')};filename=logic.ts`,
  ]);
  console.log(`   version ${res?.version ?? '?'} status ${res?.status ?? '?'}`);

  console.log('== 0008_push_cron.sql（毎日 20:00 / 21:00 の予定）');
  sql(readFileSync(join(root, 'supabase/migrations/0008_push_cron.sql'), 'utf8'));
  console.log(sql(`select jobname, schedule from cron.job where jobname like 'notify-%' order by jobname`));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
