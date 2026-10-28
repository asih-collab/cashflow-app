import { describe, expect, it } from 'vitest';
import { buildDailyAdvice, dailyContext } from '../../src/lib/dailyAdvice';
import { seedCategories } from '../../src/lib/categories';
import { periodFor } from '../../src/lib/period';
import type { Budget, Transaction } from '../../src/lib/types';

const cats = seedCategories('x');
const id = (name: string) => cats.find((c) => c.name === name)!.id;
let n = 0;
const tx = (date: string, amount: number, cat: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, date, amount, type: cat === '給与' ? 'income' : 'expense', category_id: id(cat), payment_method_id: null, memo: '', source: 'manual',
  recurring_rule_id: null, created_at: 'x', updated_at: 'x', deleted_at: null, ...extra,
});
const budget = (amount: number, period_start = '2026-10-25'): Budget => ({ id: 'b', period_start, category_id: id('食費'), amount, created_at: 'x', updated_at: 'x', deleted_at: null });

// 給料日基準（25 日始まり）。今日 = 11/2（月）。期間 10/25〜11/24、今日を含めて残り 23 日
const TODAY = new Date(2026, 10, 2, 12, 0);
const period = periodFor(TODAY, 25);
const run = (t: Transaction[], b: Budget[] = [], today = TODAY) =>
  buildDailyAdvice(dailyContext({ transactions: t, categories: cats, budgets: b, period: periodFor(today, 25), today }));
const rule = (a: ReturnType<typeof run>, r: string) => a.find((x) => x.rule === r);

describe('今日の気づき: 状況の計算', () => {
  it('今日の目安 = （予算 − 昨日までの変動費）÷ 今日を含む残り日数', () => {
    const c = dailyContext({ transactions: [tx('2026-10-26', 7000, '外食'), tx('2026-11-02', 500, 'カフェ')], categories: cats, budgets: [budget(230000)], period, today: TODAY });
    expect(c.daysLeftInclToday).toBe(23);
    expect(c.spentBeforeToday).toBe(7000);
    expect(c.allowanceToday).toBe(Math.floor((230000 - 7000) / 23));
    expect(c.todayTotal).toBe(500);
  });
  it('先の日付で記録した変動費（予定）も目安から先に引く。今日何も使っていなければホームの 1 日あたりと同じ', () => {
    const t = [tx('2026-10-26', 18_000, '外食'), tx('2026-11-10', 50_000, 'デート'), tx('2026-11-30', 9_999, '外食')];
    const c = dailyContext({ transactions: t, categories: cats, budgets: [budget(230000)], period, today: TODAY });
    expect(c.scheduledSpend).toBe(50_000); // 11/30 は期間の外
    expect(c.allowanceToday).toBe(Math.floor((230000 - 18_000 - 50_000) / 23));
  });
  it('固定費は変動費に数えない', () => {
    const c = dailyContext({ transactions: [tx('2026-11-02', 130000, '家賃')], categories: cats, budgets: [budget(100000)], period, today: TODAY });
    expect(c.todayTotal).toBe(0);
  });
});

describe('今日の気づき: ルール', () => {
  it('目安の内なら「今日使える額」は出さない（ホームの 1 日あたりと同じなので）', () => {
    expect(rule(run([], [budget(230000)]), 'daily_allowance')).toBeUndefined();
    expect(rule(run([tx('2026-11-02', 3000, '外食')], [budget(230000)]), 'daily_allowance')).toBeUndefined();
  });
  it('習慣の出費: 30 日で 6 回以上の小さな出費を今日また使ったら、1 年でいくら・週 1 回減らすといくら', () => {
    const past = [3, 6, 9, 12, 15, 18].map((d) => tx(`2026-10-${d + 10}`, 600, 'カフェ'));
    const r = rule(run([...past, tx('2026-11-02', 600, 'カフェ')]), 'habit_today')!;
    expect(r.title).toBe('カフェはこの 30 日で 6 回・¥3,600');
    expect(r.body).toContain('1 年で約 ¥44,000');
    expect(r.body).toContain('年 ¥31,200 浮きます');
    expect(rule(run(past), 'habit_today')).toBeUndefined(); // 今日使っていなければ出さない
    const bigOnes = [3, 6, 9, 12, 15, 18].map((d) => tx(`2026-10-${d + 10}`, 8000, '外食'));
    expect(rule(run([...bigOnes, tx('2026-11-02', 8000, '外食')]), 'habit_today')).toBeUndefined(); // 1 回が大きいものは対象外
  });
  it('使わない日: 昨日 0 円なら褒めて、今月何日目か・続けたときの効果を出す', () => {
    const t = ['2026-10-20', '2026-10-25', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'].map((d) => tx(d, 1300, '外食'));
    const r = rule(run(t), 'no_spend_day')!;
    // 10/20〜11/1 の 13 日で 9,100 円 → 1 日平均 700 円。今月（10/25〜）の 0 円の日は 10/26 と 11/1
    expect(r.title).toBe('昨日は使わない日でした');
    expect(r.body).toContain('今月 2 日目');
    expect(r.body).toContain('¥700');
    expect(rule(run([...t, tx('2026-11-01', 500, 'カフェ')]), 'no_spend_day')).toBeUndefined();
    expect(rule(run([tx('2026-10-31', 500, 'カフェ')]), 'no_spend_day')).toBeUndefined(); // 使い始めたばかり
  });
  it('明日が使いすぎやすい曜日なら、前の日に知らせる', () => {
    // 火曜（10/13, 10/20, 10/27）に 1 万円。今日 11/2（月）→ 明日は火曜
    const t: Transaction[] = [];
    for (let d = 10; d <= 31; d++) t.push(tx(`2026-10-${d}`, new Date(2026, 9, d).getDay() === 2 ? 10000 : 1000, '外食'));
    const r = rule(run(t), 'tomorrow_peak')!;
    expect(r.title).toBe('明日（火曜日）は使いすぎやすい日です');
    expect(r.body).toContain('1 日平均 ¥10,000');
  });
  it('目安を超えたら注意し、残りの日の 1 日あたりを出す。一番上に出る', () => {
    const a = run([tx('2026-11-02', 20000, '外食')], [budget(230000)]);
    expect(a[0]!.rule).toBe('daily_allowance');
    expect(a[0]!.level).toBe('warn');
    expect(a[0]!.title).toContain('超えています');
    expect(a[0]!.body).toContain(`残り 22 日を 1 日 ¥${Math.floor((230000 - 20000) / 22).toLocaleString('en')}`);
  });
  it('予算がなければ目安は出さない', () => {
    expect(rule(run([tx('2026-11-02', 3000, '外食')]), 'daily_allowance')).toBeUndefined();
  });
  it('昨日のふり返り: 合計・件数・いちばん大きいもの・目安との差', () => {
    const a = run([tx('2026-11-01', 1200, '外食'), tx('2026-11-01', 300, 'コンビニ')], [budget(230000)]);
    const r = rule(a, 'yesterday_recap')!;
    expect(r.title).toBe('昨日は ¥1,500（2 件）');
    expect(r.body).toContain('いちばん大きいのは外食の ¥1,200');
    expect(r.body).toContain('少なく済みました');
    expect(r.level).toBe('good');
  });
  it('今日同じ中分類を 3 回', () => {
    const t = [1, 2, 3].map(() => tx('2026-11-02', 300, 'コンビニ'));
    expect(rule(run(t), 'repeat_today')!.title).toBe('今日のコンビニは 3 回目（計 ¥900）');
  });
  it('大きめの出費: 平均の 3 倍以上かつ 5,000 円以上。残りの 1 日あたりの変化も出す', () => {
    const past = Array.from({ length: 12 }, (_, i) => tx(`2026-10-${String(10 + i).padStart(2, '0')}`, 1000, '外食'));
    const a = run([...past, tx('2026-11-02', 12000, 'デート')], [budget(230000)]);
    const r = rule(a, 'big_purchase')!;
    expect(r.title).toBe('今日のデート ¥12,000 は大きめの出費です');
    expect(r.body).toContain('いつもの 1 回の平均は ¥1,000');
    expect(r.body).toMatch(/→/);
    expect(rule(run([...past, tx('2026-11-02', 2900, 'デート')]), 'big_purchase')).toBeUndefined();
  });
  it('使いすぎやすい曜日（同じ曜日が 3 日以上あって、ほかの曜日の 1.5 倍以上）', () => {
    // 月曜（10/12, 10/19, 10/26）に 1 万円、ほかの日は 1,000 円
    const t: Transaction[] = [];
    for (let d = 10; d <= 31; d++) {
      const date = `2026-10-${String(d).padStart(2, '0')}`;
      t.push(tx(date, new Date(2026, 9, d).getDay() === 1 ? 10000 : 1000, '外食'));
    }
    const r = rule(run(t), 'weekday_peak')!;
    expect(r.title).toBe('月曜日は使いすぎやすい日です');
    expect(r.body).toContain('1 日平均 ¥10,000');
  });
  it('今日・明日の固定費の予定（自動記録で入っている先の日付の記録）', () => {
    const t = [tx('2026-11-03', 60000, 'リボ・分割返済', { source: 'recurring', memo: 'リボ・分割返済' }), tx('2026-11-03', 6800, '携帯', { source: 'recurring', memo: '通信費' })];
    expect(rule(run(t), 'upcoming_fixed')!.title).toBe('明日は リボ・分割返済・通信費（¥66,800）の予定です');
  });
  it('給料日', () => {
    const r = rule(run([tx('2026-11-02', 540000, '給与')], [budget(232500)]), 'payday')!;
    expect(r.title).toBe('今日は収入 ¥540,000 が入りました');
    expect(r.body).toContain(`1 日あたり ¥${Math.floor(232500 / 31).toLocaleString('en')}`);
  });
  it('多くても 3 件。記録がなければ何も出さない', () => {
    const t = [tx('2026-11-02', 540000, '給与'), tx('2026-11-01', 1000, '外食'), ...[1, 2, 3].map(() => tx('2026-11-02', 300, 'コンビニ')), tx('2026-11-03', 6800, '携帯', { source: 'recurring' })];
    expect(run(t, [budget(230000)])).toHaveLength(3);
    expect(run([])).toEqual([]);
  });
});
