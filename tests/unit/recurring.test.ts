import { describe, expect, it } from 'vitest';
import { addMonths, dueRecurringTransactions, postingDate, recurringTransactionId, monthKey } from '../../src/lib/recurring';
import type { RecurringRule } from '../../src/lib/types';

const rule = (p: Partial<RecurringRule> = {}): RecurringRule => ({
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: '家賃', amount: 100000, type: 'expense', category_id: 'c1', payment_method_id: 'p1',
  day_of_month: 27, start_month: '2026-10', end_month: null, needs_review: false, is_active: true, sort_order: 0,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', deleted_at: null, ...p,
});

describe('自動計上', () => {
  it('月の計算', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthKey(new Date(2026, 9, 3))).toBe('2026-10');
  });
  it('計上日は月末を超えない', () => {
    expect(postingDate('2026-02', 31)).toBe('2026-02-28');
    expect(postingDate('2026-10', 25)).toBe('2026-10-25');
    expect(postingDate('2026-10', 0)).toBe('2026-10-01');
  });
  it('ID はルールと年月で決まり、UUID の形', () => {
    const a = recurringTransactionId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '2026-10');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).toBe(recurringTransactionId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '2026-10'));
    expect(a).not.toBe(recurringTransactionId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '2026-11'));
  });
  it('今月分を月初から（予定日付で）1 回だけ計上する', () => {
    const r = rule();
    const first = dueRecurringTransactions([r], new Set(), new Date(2026, 9, 3), 'now');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ date: '2026-10-27', amount: 100000, source: 'recurring', recurring_rule_id: r.id });
    const again = dueRecurringTransactions([r], new Set(first.map((t) => t.id)), new Date(2026, 9, 20), 'now');
    expect(again).toHaveLength(0);
  });
  it('開始月から今月までの抜けている月をまとめて計上する。終了月の後は計上しない', () => {
    const r = rule({ start_month: '2026-08', end_month: '2026-09' });
    const out = dueRecurringTransactions([r], new Set(), new Date(2026, 9, 3), 'now');
    expect(out.map((t) => t.date)).toEqual(['2026-08-27', '2026-09-27']);
  });
  it('削除済みの計上分（ID が残っている）は作り直さない', () => {
    const r = rule();
    const id = recurringTransactionId(r.id, '2026-10');
    expect(dueRecurringTransactions([r], new Set([id]), new Date(2026, 9, 3), 'now')).toHaveLength(0);
  });
  it('止めたルール・未来に始まるルールは計上しない。収入は支払い手段を持たない', () => {
    expect(dueRecurringTransactions([rule({ is_active: false })], new Set(), new Date(2026, 9, 3), 'now')).toHaveLength(0);
    expect(dueRecurringTransactions([rule({ start_month: '2026-11' })], new Set(), new Date(2026, 9, 3), 'now')).toHaveLength(0);
    const inc = dueRecurringTransactions([rule({ type: 'income', day_of_month: 25 })], new Set(), new Date(2026, 9, 3), 'now');
    expect(inc[0]).toMatchObject({ type: 'income', payment_method_id: null, date: '2026-10-25' });
  });
  it('準固定費は「仮の金額」とメモに残す', () => {
    const out = dueRecurringTransactions([rule({ name: '電気', needs_review: true })], new Set(), new Date(2026, 9, 3), 'now');
    expect(out[0]!.memo).toContain('仮の金額');
  });
});
