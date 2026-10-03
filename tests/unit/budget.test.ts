import { describe, expect, it } from 'vitest';
import { budgetId, budgetStatus, crossedThreshold } from '../../src/lib/budget';
import { seedCategories } from '../../src/lib/categories';
import { periodFor, shiftPeriod } from '../../src/lib/period';
import { monthSummary, groupDetail } from '../../src/lib/summary';
import type { Budget, Transaction } from '../../src/lib/types';

const cats = seedCategories('2026-09-01T00:00:00.000Z');
const id = (name: string) => cats.find((c) => c.name === name)!.id;
let n = 0;
const tx = (date: string, amount: number, cat: string | null, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, date, amount, type: 'expense', category_id: cat ? id(cat) : null, payment_method_id: null, memo: '', source: 'manual',
  recurring_rule_id: null, created_at: 'x', updated_at: 'x', deleted_at: null, ...extra,
});
const bud = (parent: string, start: string, amount: number): Budget => ({ id: budgetId(id(parent), start), period_start: start, category_id: id(parent), amount, created_at: 'x', updated_at: 'x', deleted_at: null });

describe('予算', () => {
  const period = periodFor(new Date(2026, 9, 11), 1); // 10 月、残り 21 日
  it('budgetId は大分類と期間で決まる', () => {
    expect(budgetId(id('食費'), '2026-10-01')).toBe(budgetId(id('食費'), '2026-10-01'));
    expect(budgetId(id('食費'), '2026-10-01')).not.toBe(budgetId(id('食費'), '2026-11-01'));
  });
  it('大分類ごとに中分類の実績をまとめ、残額と 1 日あたりを出す', () => {
    const s = budgetStatus(
      [bud('食費', '2026-10-01', 40000), bud('交際費', '2026-10-01', 30000), bud('食費', '2026-09-01', 99999)],
      [tx('2026-10-02', 12000, '外食'), tx('2026-10-03', 3000, 'コンビニ'), tx('2026-10-05', 27000, 'デート'), tx('2026-10-05', 130000, '家賃'), tx('2026-09-30', 5000, '外食')],
      cats, period,
    );
    expect(s.totalBudget).toBe(70000);
    expect(s.totalSpent).toBe(42000);
    expect(s.remaining).toBe(28000);
    expect(s.perDayLeft).toBe(Math.floor(28000 / 21));
    expect(s.lines[0]).toMatchObject({ name: '交際費', budget: 30000, spent: 27000, remaining: 3000 });
    expect(s.lines.find((l) => l.name === '食費')).toMatchObject({ spent: 15000, remaining: 25000 });
  });
  it('予算のない大分類でも、使っていれば行に出る（予算 0）。超過はマイナス', () => {
    const s = budgetStatus([bud('食費', '2026-10-01', 1000)], [tx('2026-10-02', 1500, '外食'), tx('2026-10-02', 800, 'タクシー')], cats, period);
    expect(s.lines.find((l) => l.name === '食費')!.remaining).toBe(-500);
    expect(s.lines.find((l) => l.name === '交通費')).toMatchObject({ budget: 0, spent: 800 });
    expect(s.perDayLeft).toBe(0);
  });
  it('80% を超えた瞬間だけを検出する', () => {
    const b = [bud('交際費', '2026-10-01', 10000)];
    const before = budgetStatus(b, [tx('2026-10-01', 7000, 'デート')], cats, period);
    const after = budgetStatus(b, [tx('2026-10-01', 7000, 'デート'), tx('2026-10-02', 1500, 'デート')], cats, period);
    expect(crossedThreshold(before, after).map((l) => l.name)).toEqual(['交際費']);
    const after2 = budgetStatus(b, [tx('2026-10-01', 7000, 'デート'), tx('2026-10-02', 1500, 'デート'), tx('2026-10-03', 100, 'デート')], cats, period);
    expect(crossedThreshold(after, after2)).toHaveLength(0);
  });
});

describe('月次サマリ', () => {
  const period = periodFor(new Date(2026, 9, 11), 1);
  const prev = shiftPeriod(period, 1, 1);
  it('前の期間を正しく求める（暦月・給料日基準）', () => {
    expect(prev).toMatchObject({ start: '2026-09-01', end: '2026-09-30' });
    const p25 = periodFor(new Date(2026, 9, 11), 25); // 9/25〜10/24
    expect(shiftPeriod(p25, 1, 25)).toMatchObject({ start: '2026-08-25', end: '2026-09-24' });
    expect(shiftPeriod(p25, -1, 25)).toMatchObject({ start: '2026-10-25', end: '2026-11-24' });
  });
  it('収支は 収入 − 支出（固定費・返済・積立を含む）。前月比用に前の期間も集計', () => {
    const s = monthSummary([
      tx('2026-10-25', 300000, '給与', { type: 'income' }),
      tx('2026-10-27', 100000, '家賃'),
      tx('2026-10-10', 30000, 'リボ・分割返済'),
      tx('2026-10-10', 20000, '積立投資'),
      tx('2026-10-11', 5000, '電気'),
      tx('2026-10-05', 12000, 'デート'),
      tx('2026-09-05', 9000, 'デート'),
    ], cats, [bud('交際費', '2026-10-01', 20000)], period, prev);
    expect(s.income).toBe(300000);
    expect(s.expense).toBe(167000);
    expect(s.balance).toBe(133000);
    expect(s.byKind).toEqual({ variable: 12000, semi_fixed: 5000, fixed: 150000 });
    expect(s.prevExpense).toBe(9000);
    const g = s.groups.find((x) => x.name === '交際費')!;
    expect(g).toMatchObject({ amount: 12000, budget: 20000, prevAmount: 9000 });
    expect(s.groups[0]!.name).toBe('住宅');
  });
});

describe('サマリの詳細（中分類と記録）', () => {
  const period = periodFor(new Date(2026, 9, 11), 1);
  it('大分類を開くと、中分類ごとの合計と記録が出る（期間外・収入・削除済みは除く）', () => {
    const d = groupDetail([
      tx('2026-10-02', 1200, '外食'),
      tx('2026-10-05', 800, '外食'),
      tx('2026-10-03', 450, 'コンビニ'),
      tx('2026-10-04', 3000, 'デート'), // 別の大分類
      tx('2026-09-30', 999, '外食'), // 期間外
      tx('2026-10-06', 500, 'カフェ', { deleted_at: 'x' }),
    ], cats, period, id('食費'));
    expect(d.subs.map((x) => [x.name, x.amount, x.count])).toEqual([['外食', 2000, 2], ['コンビニ', 450, 1]]);
    expect(d.items.map((t) => t.date)).toEqual(['2026-10-05', '2026-10-03', '2026-10-02']);
  });
  it('未分類（カテゴリなし）も開ける', () => {
    const d = groupDetail([tx('2026-10-02', 700, null)], cats, period, '');
    expect(d.subs).toEqual([{ categoryId: '', name: '未分類', amount: 700, count: 1 }]);
  });
});
