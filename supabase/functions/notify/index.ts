// 通知（F09 の C 記録リマインド・E 月末振り返り）を送る Edge Function。
// - pg_cron が毎日 20:00 / 21:00（日本時間）に kind を付けて呼ぶ。ヘッダーの x-cron-secret で本物か確かめる
// - アプリの「テスト通知」は本人のログイン情報（JWT）付きで kind=test を呼ぶ。本人の端末にだけ送る
// - 同じ通知は同じ日に 1 回だけ（notification_log）
// 必要なシークレット: VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK / VAPID_SUBJECT / CRON_SECRET
// （SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で渡す）

import { sendWebPush, type VapidKeys } from './webpush.ts';
import { jstDate, messageFor, usersToNotify, type Candidate, type NotifyKind } from './logic.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Promise<Response>): void };

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' },
});

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function userFromJwt(auth: string | null): Promise<string | null> {
  if (!auth?.startsWith('Bearer ')) return null;
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: auth } });
  if (!res.ok) return null;
  const u = await res.json() as { id?: string };
  return u.id ?? null;
}

interface SubRow { user_id: string; endpoint: string; p256dh: string; auth: string; reminder: boolean; review: boolean }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json(200, {});
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let kind: NotifyKind;
  try {
    kind = ((await req.json()) as { kind?: NotifyKind }).kind ?? 'reminder';
  } catch {
    return json(400, { error: 'body' });
  }
  if (!['reminder', 'review', 'test'].includes(kind)) return json(400, { error: 'kind' });

  let onlyUser: string | null = null;
  if (kind === 'test') {
    onlyUser = await userFromJwt(req.headers.get('Authorization'));
    if (!onlyUser) return json(401, { error: 'login' });
  } else if (!Deno.env.get('CRON_SECRET') || req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return json(401, { error: 'secret' });
  }

  const keys: VapidKeys = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY')!,
    privateJwk: JSON.parse(Deno.env.get('VAPID_PRIVATE_JWK')!),
    subject: Deno.env.get('VAPID_SUBJECT') ?? 'https://asih-collab.github.io/cashflow-app/',
  };
  const today = jstDate(new Date());

  // 購読している端末
  const flag = kind === 'reminder' ? '&reminder=is.true' : kind === 'review' ? '&review=is.true' : '';
  const subs = await rest<SubRow[]>(`push_subscriptions?select=*${flag}${onlyUser ? `&user_id=eq.${onlyUser}` : ''}`);
  const userIds = [...new Set(subs.map((s) => s.user_id))];
  if (userIds.length === 0) return json(200, { kind, today, sent: 0 });
  const inList = `(${userIds.join(',')})`;

  const candidates: Candidate[] = userIds.map((user_id) => ({ user_id, manualCount: 0, monthStartDay: 1 }));
  if (kind === 'reminder') {
    const rows = await rest<{ user_id: string }[]>(`transactions?select=user_id&user_id=in.${inList}&date=eq.${today}&deleted_at=is.null&source=in.(manual,shortcut)`);
    for (const r of rows) candidates.find((c) => c.user_id === r.user_id)!.manualCount++;
  }
  if (kind === 'review') {
    const rows = await rest<{ user_id: string; month_start_day: number }[]>(`settings?select=user_id,month_start_day&user_id=in.${inList}`);
    for (const r of rows) candidates.find((c) => c.user_id === r.user_id)!.monthStartDay = r.month_start_day;
  }
  const targets = usersToNotify(kind, today, candidates);

  const message = messageFor(kind);
  let sent = 0;
  let removed = 0;
  const errors: string[] = [];
  for (const user_id of targets) {
    if (kind !== 'test') {
      // 同じ日に同じ通知を 2 回送らない（ここで行が入らなければ送信済み）
      const inserted = await rest<unknown[]>('notification_log?on_conflict=user_id,kind,key', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify([{ user_id, kind, key: today }]),
      });
      if (!inserted || inserted.length === 0) continue;
    }
    for (const s of subs.filter((x) => x.user_id === user_id)) {
      try {
        const r = await sendWebPush(s, message, keys);
        if (r.status >= 200 && r.status < 300) sent++;
        else if (r.gone) {
          await rest(`push_subscriptions?user_id=eq.${s.user_id}&endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
          removed++;
        } else errors.push(`${r.status} ${r.body ?? ''}`.slice(0, 200));
      } catch (e) {
        errors.push(String(e).slice(0, 200));
      }
    }
  }
  return json(200, { kind, today, users: targets.length, sent, removed, errors });
});
