import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { missingInPeriod, monthInPeriod, recurringTransactionId, splitSuggestions } from '../../src/lib/recurring';
import { periodFor } from '../../src/lib/period';
import { Db } from '../../src/lib/db';
import { AppStore } from '../../src/lib/store';
import type { RecurringRule, Transaction } from '../../src/lib/types';

const rule = (name: string, day: number, start_month: string, extra: Partial<RecurringRule> = {}): RecurringRule => ({
  id: `00000000-0000-4000-8000-${String(day).padStart(12, '0')}`, name, amount: 1000, type: 'expense', category_id: null, payment_method_id: null, day_of_month: day,
  start_month, end_month: null, needs_review: false, is_active: true, sort_order: 0, created_at: 'x', updated_at: 'x', deleted_at: null, ...extra,
});
// 給料日 25 日始まり。今日 11/4 → 期間 10/25〜11/24
const period = periodFor(new Date(2026, 10, 4), 25);

describe('今の期間に入っていない固定費', () => {
  it('計上日が期間に入る月: 27 日なら前の月、10 日なら今月、暦月の期間なら今月', () => {
    expect(monthInPeriod(27, period)).toBe('2026-10');
    expect(monthInPeriod(10, period)).toBe('2026-11');
    expect(monthInPeriod(25, period)).toBe('2026-10');
    expect(monthInPeriod(27, periodFor(new Date(2026, 10, 4), 1))).toBe('2026-11');
  });
  it('開始月を今月にした 27 日の積立は、期間に入る 10/27 の分がないので確認に出る。10 日のものは出ない', () => {
    const late = rule('積立', 27, '2026-11');
    const m = missingInPeriod([late, rule('通信', 10, '2026-11')], new Set(), period);
    expect(m).toEqual([{ rule: late, month: '2026-10', date: '2026-10-27' }]);
  });
  it('もう記録がある・消した・今回はなし・止めた・終わった月なら出ない', () => {
    const r = rule('積立', 27, '2026-11');
    expect(missingInPeriod([r], new Set([recurringTransactionId(r.id, '2026-10')]), period)).toEqual([]);
    expect(missingInPeriod([r], new Set(), period, new Set([`${r.id}:2026-10`]))).toEqual([]);
    expect(missingInPeriod([{ ...r, is_active: false }], new Set(), period)).toEqual([]);
    expect(missingInPeriod([{ ...r, start_month: '2026-10' }], new Set(), period)).toEqual([]); // 開始月が前の月なら、自動記録で入る
  });
});

describe('ストア: 期間に合わせた開始月と確認', () => {
  it('給料日始まりなら、新しい固定費は期間に入る月から記録される。確認して「記録する」「今回はなし」', async () => {
    const s = new AppStore(new Db(new IDBFactory(), 'missing'));
    await s.init();
    const today = new Date();
    await s.updateSettings({ month_start_day: 25 });
    const p = periodFor(today, 25);
    const r = await s.saveRule({ name: 'サブスク', amount: 990, type: 'expense', category_id: null, payment_method_id: null, day_of_month: 27, needs_review: false });
    expect(r.start_month).toBe(monthInPeriod(27, p));
    const posted = s.liveTransactions.filter((t) => t.recurring_rule_id === r.id);
    expect(posted.some((t) => t.date >= p.start && t.date <= p.end)).toBe(true);
    expect(s.missingRecurring(today)).toEqual([]);

    // 開始月が期間より後のルール（以前の登録）→ 確認に出る
    const late = await s.saveRule({ name: '積立', amount: 40000, type: 'expense', category_id: null, payment_method_id: null, day_of_month: 26, needs_review: false, start_month: '2099-01' });
    const m = s.missingRecurring(today).find((x) => x.rule.id === late.id)!;
    expect(m.month).toBe(monthInPeriod(26, p));
    await s.confirmMissingRecurring(late.id, m.month);
    expect(s.missingRecurring(today)).toEqual([]);
    expect(s.liveTransactions.find((t) => t.recurring_rule_id === late.id)?.date).toBe(m.date);

    const other = await s.saveRule({ name: '会費', amount: 500, type: 'expense', category_id: null, payment_method_id: null, day_of_month: 28, needs_review: false, start_month: '2099-01' });
    await s.skipMissingRecurring(other.id, monthInPeriod(28, p)!);
    expect(s.missingRecurring(today)).toEqual([]);
    await s.reload();
    expect(s.missingRecurring(today)).toEqual([]); // 開き直しても出ない
  });
});

describe('ストア: 内訳に分ける', () => {
  it('まとめたサブスクを内訳に分けると、これまでの記録は残り、内訳は次の月から。今の期間の分は内訳ごとに選べて二重にならない', async () => {
    const s = new AppStore(new Db(new IDBFactory(), 'split'));
    await s.init();
    const today = new Date();
    await s.updateSettings({ month_start_day: 25 });
    const p = periodFor(today, 25);
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    // 以前の登録: 今月から（今の期間に入る前の月の分が抜けている場合がある）
    const agg = await s.saveRule({ name: 'サブスク', amount: 3000, type: 'expense', category_id: null, payment_method_id: null, day_of_month: 27, needs_review: false, start_month: thisMonth });
    const before = s.liveTransactions.filter((t) => t.recurring_rule_id === agg.id).map((t) => t.id);
    expect(before).toHaveLength(1);
    const parts = await s.splitRule(agg.id, [{ name: '動画', amount: 1000 }, { name: '音楽', amount: 1500 }, { name: '雑誌', amount: 500 }]);
    expect(parts.map((r) => r.start_month)).toEqual(Array(3).fill(parts[0]!.start_month));
    expect(parts[0]!.start_month > thisMonth).toBe(true);
    expect(s.activeRules.map((r) => r.name)).toEqual(['動画', '音楽', '雑誌']);
    expect(s.liveTransactions.filter((t) => t.recurring_rule_id === agg.id).map((t) => t.id)).toEqual(before); // これまでの記録は残る
    expect(s.liveTransactions.filter((t) => parts.some((r) => r.id === t.recurring_rule_id))).toHaveLength(0); // 内訳はまだ記録しない

    const m = monthInPeriod(27, p)!;
    const missing = s.missingRecurring(today);
    if (m < thisMonth) {
      // 今の期間の分（前の月の 27 日）は元のルールで記録されていない → 内訳ごとに確認に出る
      expect(missing.map((x) => x.rule.name)).toEqual(['動画', '音楽', '雑誌']);
      await s.confirmMissingRecurring(parts[0]!.id, m);
      await s.skipMissingRecurring(parts[2]!.id, m);
      await s.confirmMissingRecurring(parts[1]!.id, m);
      expect(s.missingRecurring(today)).toEqual([]);
      const posted = s.liveTransactions.filter((t) => parts.some((r) => r.id === t.recurring_rule_id));
      expect(posted.map((t) => [t.memo, t.date])).toEqual([['動画', `${m}-27`], ['音楽', `${m}-27`]]); // その月の分だけ
    } else {
      expect(missing).toEqual([]);
    }
  });
});

describe('内訳の候補（過去の手入力から）', () => {
  const SUB = '11111111-0012-4000-8000-000000000001';
  let k = 0;
  const t = (date: string, amount: number, memo: string, extra: Partial<Transaction> = {}): Transaction => ({
    id: `s${++k}`, date, amount, type: 'expense', category_id: SUB, payment_method_id: null, memo, source: 'manual', recurring_rule_id: null,
    created_at: `${date}T00:00:0${k % 10}`, updated_at: 'x', deleted_at: null, ...extra,
  });
  it('同じカテゴリの手入力を、サービス名ごとに一番新しい金額で。自動記録・ほかのカテゴリ・古いもの・メモなしは使わない', () => {
    const r = rule('サブスク', 22, '2026-11', { category_id: SUB });
    const list = [
      t('2026-10-04', 400, '食べログ'), t('2026-10-20', 450, '食べログ'),
      t('2026-10-22', 1200, '動画'), t('2026-10-18', 3000, 'ジム'),
      t('2026-10-22', 999, 'まとめ', { source: 'recurring' }), t('2026-10-22', 500, '外食', { category_id: 'other' }),
      t('2026-06-01', 800, '昔の'), t('2026-10-05', 300, ''),
    ];
    expect(splitSuggestions(list, r, new Date(2026, 10, 22))).toEqual([
      { name: '動画', amount: 1200 }, { name: '食べログ', amount: 450 }, { name: 'ジム', amount: 3000 },
    ]);
  });
});
