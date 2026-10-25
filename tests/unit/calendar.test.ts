import { describe, expect, it } from 'vitest';
import { calendarCells, compactYen, dailyNet, ledgerDays } from '../../src/lib/calendar';
import { seedCategories } from '../../src/lib/categories';
import { periodFor } from '../../src/lib/period';
import type { Transaction } from '../../src/lib/types';

const cats = seedCategories('x');
const id = (name: string) => cats.find((c) => c.name === name)!.id;
let n = 0;
const tx = (date: string, amount: number, cat: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, date, amount, type: 'expense', category_id: id(cat), payment_method_id: null, memo: '', source: 'manual',
  recurring_rule_id: null, created_at: 'x', updated_at: 'x', deleted_at: null, ...extra,
});

describe('カレンダー', () => {
  it('2026 年 10 月は木曜始まり: 前に 4 マス空き、7 の倍数のマス', () => {
    const c = calendarCells(periodFor(new Date(2026, 9, 11), 1));
    expect(c.slice(0, 4).every((x) => x.date === null)).toBe(true);
    expect(c[4]).toEqual({ date: '2026-10-01', day: 1 });
    expect(c.filter((x) => x.date).length).toBe(31);
    expect(c.length % 7).toBe(0);
  });
  it('給料日基準（9/25〜10/24）でも月をまたいで並ぶ', () => {
    const c = calendarCells(periodFor(new Date(2026, 9, 11), 25)).filter((x) => x.date);
    expect(c[0]!.date).toBe('2026-09-25');
    expect(c[c.length - 1]!.date).toBe('2026-10-24');
    expect(c.find((x) => x.date === '2026-10-01')!.day).toBe(1);
  });
  it('日ごとの収支: 収入 − 支出（固定費も含む）。期間外・削除済みは除く', () => {
    const p = periodFor(new Date(2026, 9, 11), 1);
    const m = dailyNet([
      tx('2026-10-05', 3850, '外食'),
      tx('2026-10-05', 1200, 'コンビニ'),
      tx('2026-10-25', 320000, '給与', { type: 'income' }),
      tx('2026-10-25', 100000, '家賃'),
      tx('2026-10-06', 999, '外食', { deleted_at: 'x' }),
      tx('2026-09-30', 500, '外食'),
    ], cats, p);
    expect(m.get('2026-10-05')).toEqual({ income: 0, expense: 5050, net: -5050, count: 2 });
    expect(m.get('2026-10-25')).toEqual({ income: 320000, expense: 100000, net: 220000, count: 2 });
    expect(m.has('2026-10-06')).toBe(false);
    expect(m.has('2026-09-30')).toBe(false);
  });
  it('マス用の短い表記', () => {
    expect(compactYen(3850)).toBe('3,850');
    expect(compactYen(9999)).toBe('9,999');
    expect(compactYen(-12400)).toBe('1.2万');
    expect(compactYen(21400)).toBe('2.1万');
    expect(compactYen(30000)).toBe('3万');
    expect(compactYen(99999)).toBe('10万');
    expect(compactYen(320000)).toBe('32万');
    expect(compactYen(1250000)).toBe('125万');
  });
});

describe('履歴の一覧（お金の流れ）', () => {
  const p = periodFor(new Date(2026, 9, 26), 25); // 10/25〜11/24
  const list = [
    tx('2026-10-26', 1200, '外食'),
    tx('2026-10-25', 300000, '給与', { type: 'income' }),
    tx('2026-10-25', 800, 'カフェ'),
    tx('2026-10-25', 5000, '食料品'),
    tx('2026-10-27', 999, 'カフェ', { deleted_at: 'x' }),
    tx('2026-10-24', 7000, '外食'), // 前の期間
    tx('2026-10-30', 130000, '家賃', { source: 'recurring' }),
  ];
  it('日付順に並び、日ごとの収支と月初からの累計が付く。日の中は収入が先、あとは金額の大きい順', () => {
    const d = ledgerDays(list, p);
    expect(d.map((x) => x.date)).toEqual(['2026-10-25', '2026-10-26', '2026-10-30']);
    expect(d[0]!.entries.map((t) => t.amount)).toEqual([300000, 5000, 800]);
    expect(d.map((x) => x.net)).toEqual([294200, -1200, -130000]);
    expect(d.map((x) => x.running)).toEqual([294200, 293000, 163000]);
  });
  it('支出・収入で絞り込んでも、収支と累計は全件で数える。該当のない日は出さない', () => {
    const inc = ledgerDays(list, p, 'income');
    expect(inc.map((x) => x.date)).toEqual(['2026-10-25']);
    expect(inc[0]!.net).toBe(294200);
    const exp = ledgerDays(list, p, 'expense');
    expect(exp[0]!.entries.map((t) => t.amount)).toEqual([5000, 800]);
    expect(exp.at(-1)!.running).toBe(163000);
  });
});
