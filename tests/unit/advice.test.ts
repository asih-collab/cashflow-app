import { describe, expect, it } from 'vitest';
import { adviceContext, buildAdvice, upcomingRecurring, type Advice } from '../../src/lib/advice';
import { recurringTransactionId } from '../../src/lib/recurring';
import type { RecurringRule } from '../../src/lib/types';
import { LIMITS } from '../../src/lib/adviceRules';
import { seedCategories } from '../../src/lib/categories';
import { periodFor, shiftPeriod } from '../../src/lib/period';
import type { Budget, Debt, Transaction } from '../../src/lib/types';

const cats = seedCategories('x');
const id = (name: string) => cats.find((c) => c.name === name)!.id;
let n = 0;
const tx = (date: string, amount: number, cat: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, date, amount, type: cat === '給与' ? 'income' : 'expense', category_id: id(cat), payment_method_id: null, memo: '', source: 'manual',
  recurring_rule_id: null, created_at: 'x', updated_at: 'x', deleted_at: null, ...extra,
});
const budget = (parent: string, amount: number, period_start: string): Budget => ({ id: parent, period_start, category_id: id(parent), amount, created_at: 'x', updated_at: 'x', deleted_at: null });
const debt = (p: Partial<Debt>): Debt => ({ id: 'd', name: 'カードA', balance: 900000, balance_date: '2026-10-25', monthly_payment: 30000, annual_rate: 15, history: [], lumps: [], is_active: true, sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null, ...p });

// 給料日基準（25 日始まり）。今日 = 11/9（期間 10/25〜11/24 の 16 日目）
const SD = 25;
const TODAY = new Date(2026, 10, 9);
const period = periodFor(TODAY, SD);
const prev = shiftPeriod(period, 1, SD);

function advise(transactions: Transaction[], opts: { budgets?: Budget[]; debts?: Debt[]; today?: Date } = {}): Advice[] {
  const today = opts.today ?? TODAY;
  const p = periodFor(today, SD);
  return buildAdvice(adviceContext({ transactions, categories: cats, budgets: opts.budgets ?? [], debts: opts.debts ?? [], period: p, prev: shiftPeriod(p, 1, SD), today }));
}
const rules = (a: Advice[]) => a.map((x) => x.rule);

/** 毎日の記録（記録漏れのルールが出ないように） */
function daily(from: string, to: string, amount: number, cat: string): Transaction[] {
  const out: Transaction[] = [];
  const d = new Date(from);
  for (;;) {
    const s = d.toISOString().slice(0, 10);
    if (s > to) break;
    out.push(tx(s, amount, cat));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

describe('改善アドバイス（F23）: 状況の計算', () => {
  it('経過日数・見込み・収支の見込み', () => {
    const t = [tx('2026-10-25', 540000, '給与'), tx('2026-10-30', 130000, '家賃'), ...daily('2026-10-25', '2026-11-09', 10000, '食料品')];
    const c = adviceContext({ transactions: t, categories: cats, budgets: [], debts: [], period, prev, today: TODAY });
    expect(period.start).toBe('2026-10-25');
    expect(c.elapsedDays).toBe(16);
    expect(c.totalDays).toBe(31);
    expect(c.variableSoFar).toBe(160000);
    expect(c.variableForecast).toBe(310000); // 前月の記録がないので今日までのペースだけ
    expect(c.balanceForecast).toBe(540000 - 130000 - 310000);
  });
  it('未来の日付の変動費は今日までの実績に入れない。固定費の予定は入れる', () => {
    const t = [tx('2026-11-20', 9999, '外食'), tx('2026-11-23', 60000, 'リボ・分割返済', { source: 'recurring' })];
    const c = adviceContext({ transactions: t, categories: cats, budgets: [], debts: [], period, prev, today: TODAY });
    expect(c.variableSoFar).toBe(0);
    expect(c.fixed).toBe(60000);
  });
});

describe('改善アドバイス（F23）: まだ記録になっていない自動記録', () => {
  const rule = (name: string, amount: number, day: number, type: 'expense' | 'income' = 'expense'): RecurringRule => ({
    id: `00000000-0000-4000-8000-${name.length.toString().padStart(12, '0')}`, name, amount, type, category_id: null, payment_method_id: null, day_of_month: day,
    start_month: '2026-11', end_month: null, needs_review: false, is_active: true, sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null,
  });
  it('給料日基準の期間（10/25〜11/24）では、11 月分の固定費が月初まで記録されないので見込みに足す。期間外の日付は足さない', () => {
    const rules = [rule('リボ', 60000, 23), rule('サブスク', 31910, 31), rule('通信', 18000, 10)];
    expect(upcomingRecurring(rules, [], period)).toEqual({ income: 0, expense: 78000 });
  });
  it('すでに記録になっている月の分は足さない', () => {
    const r = rule('リボ', 60000, 23);
    const posted = tx('2026-11-23', 60000, 'リボ・分割返済', { id: recurringTransactionId(r.id, '2026-11'), source: 'recurring' });
    expect(upcomingRecurring([r], [posted], period)).toEqual({ income: 0, expense: 0 });
  });
});

describe('改善アドバイス（F23）: ルール', () => {
  const salary = tx('2026-10-25', 540000, '給与');
  const rent = tx('2026-10-30', 400000, '家賃');

  it('赤字の見込み: 金額と、残りの日数で抑える目安を出す。一番上に出る', () => {
    const a = advise([salary, rent, ...daily('2026-10-25', '2026-11-09', 10000, '外食')]);
    expect(a[0]!.rule).toBe('deficit_forecast');
    expect(a[0]!.title).toContain('赤字');
    expect(a[0]!.body).toContain('残り 15 日');
    expect(a[0]!.body).toContain('食費');
  });
  it('黒字見込みなら赤字のアドバイスは出ない。収入が未記録なら判断しない', () => {
    expect(rules(advise([salary, ...daily('2026-10-25', '2026-11-09', 1000, '外食')]))).not.toContain('deficit_forecast');
    expect(rules(advise(daily('2026-10-25', '2026-11-09', 50000, '外食')))).not.toContain('deficit_forecast');
  });
  it('予算超過と、予算のペースより速い大分類', () => {
    const b = [budget('食費', 100000, '2026-10-25'), budget('交際費', 50000, '2026-10-25')];
    const t = [salary, ...daily('2026-10-25', '2026-11-09', 7000, '食料品'), tx('2026-11-01', 40000, 'デート')];
    const a = advise(t, { budgets: b });
    const over = a.find((x) => x.rule === 'over_budget')!;
    expect(over.title).toBe('食費が予算を ¥12,000 超えています');
    const pace = a.find((x) => x.rule === 'budget_pace')!;
    expect(pace.title).toContain('交際費');
    expect(pace.body).toContain('予算の 80%');
    expect(pace.body).toContain('残りは ¥10,000');
  });
  it('予算内でペース通りなら、ペースのアドバイスは出ず「順調」が出る', () => {
    const b = [budget('食費', 300000, '2026-10-25')];
    const a = advise([salary, ...daily('2026-10-25', '2026-11-09', 3000, '食料品')], { budgets: b });
    expect(rules(a)).not.toContain('budget_pace');
    expect(rules(a)).toContain('good_pace');
  });
  it('前月より増えるペースの大分類と、1 回あたりの金額の上昇', () => {
    const t = [
      salary,
      ...daily('2026-09-25', '2026-10-24', 1000, '外食'), // 前月: 30 回 × 1,000
      ...daily('2026-10-25', '2026-11-09', 2000, '外食'), // 今月: 16 回 × 2,000
    ];
    const a = advise(t);
    expect(a.find((x) => x.rule === 'category_jump')?.title).toBe('食費が先月より増えるペースです');
    const unit = a.find((x) => x.rule === 'unit_price_up')!;
    expect(unit.body).toContain('先月は 1 回 ¥1,000、今月は ¥2,000');
  });
  it('コンビニの回数が多い', () => {
    const t = [salary, ...daily('2026-10-25', '2026-11-09', 600, 'コンビニ')];
    const f = advise(t).find((x) => x.rule === 'frequency')!;
    expect(f.title).toBe('コンビニは今月 16 回（¥9,600）');
    expect(f.body).toContain('週に 1 回減らすと');
  });
  it('黒字見込みとリボがあれば、返済に回したときの効果を出す', () => {
    const a = advise([salary, ...daily('2026-10-25', '2026-11-09', 1000, '食料品')], { debts: [debt({})] });
    const s = a.find((x) => x.rule === 'surplus_to_debt')!;
    expect(s.title).toContain('黒字見込み');
    expect(s.body).toContain('カードA');
    // 年率の高いカードがあればそちらに回す。月の初めのうちは出さない
    const two = advise([salary, ...daily('2026-10-25', '2026-11-09', 1000, '食料品')], { debts: [debt({}), debt({ id: 'd2', name: 'カードB', balance: 550000, annual_rate: 18 })] });
    expect(two.find((x) => x.rule === 'surplus_to_debt')!.body).toContain('カードB');
    expect(rules(advise([salary, tx('2026-10-26', 1000, '食料品')], { debts: [debt({})], today: new Date(2026, 9, 27) }))).not.toContain('surplus_to_debt');
    expect(s.body).toMatch(/手数料が約 ¥[\d,]+ 減ります/);
  });
  it('リボの手数料と、次の一括返済の効果', () => {
    const d = debt({ lumps: [{ month: '2026-12', amount: 300000, done: false }] });
    const r = advise([salary], { debts: [d] }).find((x) => x.rule === 'revo_fee')!;
    expect(r.title).toBe('リボの手数料は今月約 ¥11,250');
    expect(r.body).toContain('2026年12月の一括返済（¥300,000）のあとは、月 ¥3,750 ほど減ります');
  });
  it('記録の抜け: 使い始めて 1 週間以上たち、直近 7 日で 3 日以上記録がない', () => {
    const t = [salary, tx('2026-10-26', 500, 'カフェ'), tx('2026-11-03', 500, 'カフェ'), tx('2026-11-08', 500, 'カフェ')];
    expect(advise(t).find((x) => x.rule === 'missing_records')?.title).toBe('この 1 週間で記録のない日が 5 日あります');
    expect(rules(advise([tx('2026-11-08', 500, 'カフェ')]))).not.toContain('missing_records');
  });
  it('同じルールは上限まで。優先度の高い順', () => {
    const b = ['食費', '交際費', '日用品', '趣味・娯楽'].map((p) => budget(p, 1000, '2026-10-25'));
    const t = [salary, tx('2026-10-26', 5000, '外食'), tx('2026-10-26', 5000, 'デート'), tx('2026-10-26', 5000, '日用雑貨'), tx('2026-10-26', 5000, 'ゲーム')];
    const a = advise(t, { budgets: b });
    expect(a.filter((x) => x.rule === 'over_budget')).toHaveLength(LIMITS.maxPerRule);
    expect([...a].sort((x, y) => y.priority - x.priority)).toEqual(a);
  });
  it('記録がほとんどない月初でも落ちない', () => {
    expect(() => advise([], { today: new Date(2026, 9, 25) })).not.toThrow();
    expect(advise([], { today: new Date(2026, 9, 25) })).toEqual([]);
  });
});
