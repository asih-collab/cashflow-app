// 改善アドバイス（F23）の月 1 回の見直し用の集計（04 の 6 章）。
// 管理者（本人）の行だけを使う。本人の user_id は DB の private.app_config（owner_user_id）にあり、リポジトリには置かない。
// 知人の記録・反応は、本人の同意なしに分析へ使わない。
//
// 使い方: SUPABASE_PROJECT_REF=xxxx node scripts/advice-review.mjs [出力先.json]
// 出力（JSON）: ルールごとの反応の数、直近の反応と文言、期間ごとの大分類別の変動費。
// この結果と src/lib/adviceRules.ts を見比べ、しきい値・文言・ルールの追加を提案する（docs/アドバイスの見直し.md）。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REF = process.env.SUPABASE_PROJECT_REF;
if (!REF) throw new Error('SUPABASE_PROJECT_REF を指定してください');
const out = process.argv[2] ?? 'advice-review.json';

function sql(query) {
  const auth = process.env.SUPABASE_ACCESS_TOKEN ? ['-H', `Authorization: Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`] : [];
  const res = execFileSync('curl', ['-sS', '--fail-with-body', ...auth, '-X', 'POST', `https://api.supabase.com/v1/projects/${REF}/database/query`,
    '-H', 'Content-Type: application/json', '--data-binary', '@-'], { input: JSON.stringify({ query }), encoding: 'utf8' });
  return JSON.parse(res);
}

const owner = `(select value::uuid from private.app_config where key = 'owner_user_id')`;
const [r] = sql(`select json_build_object(
  'by_rule', (select json_agg(x order by x.rule) from (
     select rule, count(*) filter (where useful) as useful, count(*) filter (where not useful) as not_useful, max(updated_at) as last
     from public.advice_feedback where user_id = ${owner} and deleted_at is null group by rule) x),
  'recent', (select json_agg(x order by x.updated_at desc) from (
     select period_start, rule, advice_key, useful, title, updated_at from public.advice_feedback
     where user_id = ${owner} and deleted_at is null order by updated_at desc limit 50) x),
  'variable_by_period', (select json_agg(x order by x.month, x.parent) from (
     select to_char(t.date, 'YYYY-MM') as month, coalesce(p.name, c.name, '未分類') as parent, sum(t.amount) as amount, count(*) as n
     from public.transactions t
     left join public.categories c on c.user_id = t.user_id and c.id = t.category_id
     left join public.categories p on p.user_id = c.user_id and p.id = c.parent_id
     where t.user_id = ${owner} and t.deleted_at is null and t.type = 'expense' and coalesce(c.kind, 'variable') = 'variable'
       and t.date >= (current_date - interval '4 months')
     group by 1, 2) x),
  'settings', (select json_build_object('month_start_day', month_start_day) from public.settings where user_id = ${owner})
) as review`);
writeFileSync(out, JSON.stringify(r.review, null, 2));
const rules = r.review.by_rule ?? [];
console.log(`ルールごとの反応（役に立った / 立たない）: ${rules.length === 0 ? 'まだありません' : ''}`);
for (const x of rules) console.log(`  ${x.rule}: ${x.useful} / ${x.not_useful}`);
console.log(`詳しくは ${out}（家計の数字を含むので、リポジトリに入れない）`);
