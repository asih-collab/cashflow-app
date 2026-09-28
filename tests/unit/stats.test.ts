import { describe, expect, it } from 'vitest';
import { seedCategories } from '../../src/lib/categories';
import { periodFor } from '../../src/lib/period';
import { statsFor, perDaySoFar } from '../../src/lib/stats';
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
});
