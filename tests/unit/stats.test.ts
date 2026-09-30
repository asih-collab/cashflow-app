import { describe, expect, it } from 'vitest';
import { seedCategories } from '../../src/lib/categories';
import { periodFor } from '../../src/lib/period';
import { statsFor, perDaySoFar, dailyTotals, niceCeil } from '../../src/lib/stats';
import type { Transaction } from '../../src/lib/types';

const cats = seedCategories('2026-09-01T00:00:00.000Z');
const id = (name: string) => cats.find((c) => c.name === name)!.id;
let n = 0;
const tx = (date: string, amount: number, cat: string | null, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, date, amount, type: 'expense', category_id: cat ? id(cat) : null, payment_method_id: null, memo: '', source: 'manual',
  recurring_rule_id: null, created_at: `${date}T00:00:00.000Z`, updated_at: `${date}T00:00:00.000Z`, deleted_at: null, ...extra,
});

describe('statsFor', () => {
  const period = periodFor(new Date(2026, 8, 28), 1); // 9 月
  it('期間内の変動費だけ合計し、中分類別に多い順で内訳を出す', () => {
    const s = statsFor([
      tx('2026-09-01', 1200, 'デート'),
      tx('2026-09-15', 3000, 'デート'),
      tx('2026-09-20', 800, '外食'),
      tx('2026-08-31', 5000, 'デート'), // 期間外
      tx('2026-10-01', 5000, '外食'), // 期間外
    ], cats, period);
    expect(s.variableTotal).toBe(5000);
    expect(s.expenseCount).toBe(3);
    expect(s.variableBreakdown.map((b) => [b.name, b.amount, b.count])).toEqual([['デート', 4200, 2], ['外食', 800, 1]]);
    expect(s.variableBreakdown[0]!.parentName).toBe('交際費');
  });
  it('固定費・準固定費は変動費に含めず別枠', () => {
    const s = statsFor([tx('2026-09-01', 130000, '家賃'), tx('2026-09-02', 6000, '電気'), tx('2026-09-03', 500, 'コンビニ')], cats, period);
    expect(s.variableTotal).toBe(500);
    expect(s.fixedTotal).toBe(136000);
  });
  it('削除済みは無視、収入は別集計', () => {
    const s = statsFor([
      tx('2026-09-01', 1000, 'デート', { deleted_at: '2026-09-02T00:00:00.000Z' }),
      tx('2026-09-25', 540000, null, { type: 'income' }),
      tx('2026-09-05', 700, null),
    ], cats, period);
    expect(s.variableTotal).toBe(700);
    expect(s.incomeTotal).toBe(540000);
    expect(s.variableBreakdown[0]!.name).toBe('未分類');
  });
  it('perDaySoFar は経過日数で割る', () => {
    // 9/28 時点: 経過 28 日
    expect(perDaySoFar(28000, period)).toBe(1000);
  });
  it('収入のカテゴリで記録した収入は収入合計に入り、変動費には入らない', () => {
    const s = statsFor([
      tx('2026-09-25', 300000, '給与', { type: 'income' }),
      tx('2026-09-26', 20000, '臨時収入', { type: 'income' }),
      tx('2026-09-26', 1000, 'デート'),
    ], cats, period);
    expect(s.incomeTotal).toBe(320000);
    expect(s.variableTotal).toBe(1000);
    expect(s.expenseCount).toBe(1);
  });
  it('収入カテゴリで支出として記録されたもの（取り消し等）は収入から差し引き、件数に数えない', () => {
    const s = statsFor([
      tx('2026-09-25', 5000, '臨時収入', { type: 'income' }),
      tx('2026-09-26', 2000, '臨時収入'),
    ], cats, period);
    expect(s.incomeTotal).toBe(3000);
    expect(s.expenseCount).toBe(0);
    expect(s.variableTotal).toBe(0);
  });
});

describe('dailyTotals / niceCeil', () => {
  const period = periodFor(new Date(2026, 8, 28), 1); // 9 月（30 日）
  it('期間の全日を返し、変動費だけを日ごとに合計する', () => {
    const d = dailyTotals([
      tx('2026-09-01', 1200, 'デート'),
      tx('2026-09-01', 800, '外食'),
      tx('2026-09-03', 500, 'コンビニ'),
      tx('2026-09-03', 130000, '家賃'), // 固定費は入れない
      tx('2026-09-03', 300000, '給与', { type: 'income' }), // 収入は入れない
      tx('2026-09-04', 999, 'カフェ', { deleted_at: '2026-09-05T00:00:00.000Z' }), // 削除済み
      tx('2026-10-01', 700, '外食'), // 期間外
    ], cats, period);
    expect(d).toHaveLength(30);
    expect(d[0]).toEqual({ date: '2026-09-01', amount: 2000, count: 2 });
    expect(d[2]).toEqual({ date: '2026-09-03', amount: 500, count: 1 });
    expect(d[3]!.amount).toBe(0);
    expect(d[29]!.date).toBe('2026-09-30');
  });
  it('給料日基準の期間（月をまたぐ）でも日付が正しく並ぶ', () => {
    const p = periodFor(new Date(2027, 0, 3), 25); // 12/25〜1/24
    const d = dailyTotals([tx('2027-01-01', 3000, '外食')], cats, p);
    expect(d[0]!.date).toBe('2026-12-25');
    expect(d[7]).toEqual({ date: '2027-01-01', amount: 3000, count: 1 });
    expect(d[d.length - 1]!.date).toBe('2027-01-24');
  });
  it('niceCeil は切りのよい上端を返す', () => {
    expect(niceCeil(0)).toBe(1000);
    expect(niceCeil(830)).toBe(1000);
    expect(niceCeil(12400)).toBe(20000);
    expect(niceCeil(3200)).toBe(5000);
    expect(niceCeil(2400)).toBe(2500);
    expect(niceCeil(50000)).toBe(50000);
  });
});
