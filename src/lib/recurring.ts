// 固定費・給料などの毎月の自動計上（F06）。
// 要件: 月に必ず 1 回だけ計上し、二重計上しない（05 の 4.3）。
// 計上する記録の ID を「ルール ID + 年月」から決めるので、別の端末で同時に計上しても同じ行になり、
// 同期で重複しない。削除した計上分も ID が残るので、勝手に作り直されない。

import type { RecurringRule, Transaction } from './types';

/** 'YYYY-MM' */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, m! - 1 + n, 1);
  return monthKey(d);
}

/** ルールと年月から決まる記録の ID（UUID の形） */
export function recurringTransactionId(ruleId: string, month: string): string {
  const head = ruleId.replace(/-/g, '').slice(0, 20); // 20 桁
  const tail = (month.replace('-', '') + '000000').slice(0, 12); // 例: 202610000000
  const hex = head + tail;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** その月の計上日（31 日指定で 30 日しかない月は 30 日） */
export function postingDate(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y!, m!, 0).getDate();
  return `${month}-${String(Math.min(Math.max(1, day), last)).padStart(2, '0')}`;
}

/**
 * まだ計上していない分の記録を作る。today の月まで（その月の分は月初から、予定日付で計上）。
 * existingIds には削除済みも含めること（削除した分を作り直さないため）。
 */
export function dueRecurringTransactions(rules: RecurringRule[], existingIds: Set<string>, today: Date, now: string): Transaction[] {
  const current = monthKey(today);
  const out: Transaction[] = [];
  for (const r of rules) {
    if (!r.is_active || r.deleted_at) continue;
    let m = r.start_month;
    let guard = 0;
    while (m <= current && (!r.end_month || m <= r.end_month) && guard++ < 120) {
      const id = recurringTransactionId(r.id, m);
      if (!existingIds.has(id)) {
        out.push({
          id,
          date: postingDate(m, r.day_of_month),
          amount: r.amount,
          type: r.type,
          category_id: r.category_id,
          payment_method_id: r.type === 'income' ? null : r.payment_method_id,
          memo: r.needs_review ? `${r.name}（仮の金額・確定したら直す）` : r.name,
          source: 'recurring',
          recurring_rule_id: r.id,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        });
      }
      m = addMonths(m, 1);
    }
  }
  return out;
}
