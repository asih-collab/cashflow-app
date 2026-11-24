import { describe, expect, it } from 'vitest';
import { buildMonthlyReport, reportIsFresh, reportPeriod } from '../../src/lib/monthlyReport';
import { seedCategories } from '../../src/lib/categories';
import type { Budget, Debt, Goal, RecurringRule, Transaction } from '../../src/lib/types';

const cats = seedCategories('x');
const id = (name: string) => cats.find((c) => c.name === name)!.id;
let n = 0;
const tx = (date: string, amount: number, cat: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, date, amount, type: cat === '給与' ? 'income' : 'expense', category_id: id(cat), payment_method_id: null, memo: '', source: 'manual',
  recurring_rule_id: null, created_at: 'x', updated_at: 'x', deleted_at: null, ...extra,
});
const budget = (parent: string, amount: number, period_start: string): Budget => ({ id: `${parent}${period_start}`, period_start, category_id: id(parent), amount, created_at: 'x', updated_at: 'x', deleted_at: null });
const rule = (name: string, amount: number, day: number, cat: string, type: 'expense' | 'income' = 'expense'): RecurringRule => ({
  id: `r-${name}`, name, amount, type, category_id: id(cat), payment_method_id: null, day_of_month: day, start_month: '2026-01', end_month: null,
  needs_review: false, is_active: true, sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null,
});
const debt: Debt = { id: 'd', name: 'カードA', balance: 500000, balance_date: '2026-10-25', monthly_payment: 30000, annual_rate: 15, history: [], lumps: [{ month: '2026-12', amount: 100000, done: false }], is_active: true, sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null };
const goal: Goal = { id: 'g', name: '旅行資金', target: 500000, category_id: 'goal-cat', assets: [], extras: [{ month: '2026-12', amount: 50000, done: false }], increases: [], is_active: true, sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null };

function days(from: string, to: string, amount: number, cat: string, every = 1): Transaction[] {
  const out: Transaction[] = [];
  const d = new Date(from);
  for (let i = 0; ; i++) {
    const s = d.toISOString().slice(0, 10);
    if (s > to) break;
    if (i % every === 0) out.push(tx(s, amount, cat));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// 給料日 25 日始まり。今日 11/26 → ふり返るのは 10/25〜11/24、来月は 11/25〜12/24
const TODAY = new Date(2026, 10, 26);
const base = {
  categories: cats, debts: [debt], goals: [goal], startDay: 25, today: TODAY,
  rules: [rule('給料', 300000, 25, '給与', 'income'), rule('家賃', 100000, 27, '家賃'), rule('動画', 1500, 10, 'サブスク'), rule('音楽', 1000, 22, 'サブスク')],
};

describe('月終わりのふり返り', () => {
  it('ふり返る期間: 期間の最終日はその期間、それ以外は 1 つ前。知らせるのは最終日〜次の期間の 7 日目', () => {
    expect(reportPeriod(new Date(2026, 10, 24), 25).start).toBe('2026-10-25');
    expect(reportPeriod(TODAY, 25).start).toBe('2026-10-25');
    expect(reportPeriod(new Date(2026, 10, 10), 25).start).toBe('2026-09-25');
    expect(reportIsFresh(new Date(2026, 10, 24), 25)).toBe(true);
    expect(reportIsFresh(new Date(2026, 11, 1), 25)).toBe(true);
    expect(reportIsFresh(new Date(2026, 11, 2), 25)).toBe(false);
  });

  it('記録がまだなければ作らない', () => {
    expect(buildMonthlyReport({ ...base, transactions: [], budgets: [] })).toBeNull();
  });

  it('収支・大分類の実績と見込み（直近 3 期間を 3:2:1）・来月の固定費と予定・アドバイス', () => {
    const t = [
      // 前々期間 8/25〜9/24 と前期間 9/25〜10/24: 食費 1 日 1,000、今期間: 1 日 2,000
      ...days('2026-08-25', '2026-10-24', 1000, '食料品'),
      ...days('2026-10-25', '2026-11-24', 2000, '食料品'),
      tx('2026-10-25', 300000, '給与'), tx('2026-10-27', 100000, '家賃', { source: 'recurring' }),
      tx('2026-11-01', 40000, '飲み会'),
    ];
    const r = buildMonthlyReport({ ...base, transactions: t, budgets: [budget('食費', 50000, '2026-10-25'), budget('交際費', 30000, '2026-10-25')] })!;
    expect(r.period.label).toBe('10/25〜11/24');
    expect(r.variable).toBe(31 * 2000 + 40000);
    expect(r.balance).toBe(300000 - 100000 - (62000 + 40000));
    const food = r.lines.find((l) => l.name === '食費')!;
    expect(food.actual).toBe(62000);
    expect(food.prev).toBe(30000);
    expect(food.predicted).toBe(Math.round((62000 * 3 + 30000 * 2 + 31000 * 1) / 6));
    expect(food.suggested).toBe(Math.ceil(food.predicted / 1000) * 1000);
    // 来月の期間に入る自動記録: 給料 11/25、家賃 11/27、動画 12/10、音楽 11/22（期間外）→ 12/22
    expect(r.forecast.income).toBe(300000);
    expect(r.forecast.fixed).toBe(100000 + 1500 + 1000);
    expect(r.subscriptions.map((x) => x.name)).toEqual(['動画', '音楽']);
    expect(r.events).toEqual([{ label: 'カードAの一括返済', amount: 100000, kind: 'debt' }, { label: '旅行資金への入金', amount: 50000, kind: 'goal' }]);

    const rules = r.tips.map((x) => x.rule);
    expect(rules).toContain('m_over_budget'); // 食費・交際費が予算超え
    expect(rules).toContain('m_events');
    expect(rules).toContain('m_surplus'); // 黒字 98,000 → 年 15% のカードに
    expect(r.tips.find((x) => x.rule === 'm_surplus')!.body).toContain(`年およそ ${'¥14,700'}`);
    expect(rules.some((x) => x.startsWith('m_info_'))).toBe(true); // 来月は 12 月: 季節の情報
    expect(r.tips.length).toBeLessThanOrEqual(7);
  });

  it('赤字なら注意を一番上に。来月も赤字見込みなら週いくら減らせばいいかを出す', () => {
    const t = [tx('2026-10-25', 100000, '給与'), tx('2026-10-27', 100000, '家賃', { source: 'recurring' }), ...days('2026-10-25', '2026-11-24', 2000, '外食')];
    const r = buildMonthlyReport({ ...base, rules: [rule('給料', 100000, 25, '給与', 'income'), rule('家賃', 100000, 27, '家賃')], transactions: t, budgets: [] })!;
    expect(r.tips[0]!.rule).toBe('m_deficit');
    expect(r.tips[0]!.body).toContain('週');
  });

  it('季節の情報は来月に合わせる（来月が 2 月なら確定申告）', () => {
    const t = [tx('2026-12-26', 1000, '外食')];
    const r = buildMonthlyReport({ ...base, debts: [], goals: [], transactions: t, budgets: [], today: new Date(2027, 0, 26) })!;
    expect(r.next.end).toBe('2027-02-24');
    expect(r.tips.map((x) => x.rule)).toContain('m_info_tax_return');
  });
});

describe('お金の知恵（毎月 1 つ）', () => {
  it('その人の数字で、月ごとに入れ替わる', () => {
    const t = [tx('2026-10-25', 300000, '給与'), tx('2026-10-27', 100000, '家賃', { source: 'recurring' }), tx('2026-11-01', 20000, '外食')];
    const seen = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const today = new Date(2026, 10 + i, 26);
      const r = buildMonthlyReport({ ...base, debts: [], goals: [], transactions: t, budgets: [], today })!;
      const ev = r.tips.filter((x) => x.priority === 44);
      expect(ev).toHaveLength(1);
      seen.add(ev[0]!.rule);
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});
