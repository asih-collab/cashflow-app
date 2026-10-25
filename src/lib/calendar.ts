// 履歴のカレンダー表示: 予算期間を週ごとのマスに並べ、日ごとの収支を出す。

import type { Category, Transaction } from './types';
import { parseDate, toDateString, type Period } from './period';

export interface DayNet {
  income: number;
  expense: number;
  /** 収入 − 支出 */
  net: number;
  count: number;
}

export interface CalendarCell {
  /** YYYY-MM-DD。期間外の埋め草なら null */
  date: string | null;
  day: number;
}

/** 期間を日曜始まりの週に並べる（前後の空きは date: null） */
export function calendarCells(period: Period): CalendarCell[] {
  const start = parseDate(period.start);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < start.getDay(); i++) cells.push({ date: null, day: 0 });
  for (let i = 0; i < period.totalDays; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: toDateString(d), day: d.getDate() });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: 0 });
  return cells;
}

/** 日ごとの収入・支出・収支。収入カテゴリで支出として記録したものは収入から差し引く（サマリと同じ扱い） */
export function dailyNet(transactions: Transaction[], categories: Category[], period: Period): Map<string, DayNet> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out = new Map<string, DayNet>();
  for (const t of transactions) {
    if (t.deleted_at || t.date < period.start || t.date > period.end) continue;
    const cur = out.get(t.date) ?? { income: 0, expense: 0, net: 0, count: 0 };
    const kind = t.category_id ? byId.get(t.category_id)?.kind : undefined;
    if (t.type === 'income') cur.income += t.amount;
    else if (kind === 'income') cur.income -= t.amount;
    else cur.expense += t.amount;
    cur.net = cur.income - cur.expense;
    cur.count += 1;
    out.set(t.date, cur);
  }
  return out;
}

/** マスに収まる短い金額表記。1 万以上は「万」でまとめる（例: 5,600 → 5,600、21,400 → 2.1万、320,000 → 32万） */
export function compactYen(n: number): string {
  const a = Math.abs(Math.trunc(n));
  if (a < 10000) return a.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const man = a / 10000;
  return `${man < 10 ? man.toFixed(1).replace(/\.0$/, '') : Math.round(man)}万`;
}

export type LedgerFilter = 'all' | 'expense' | 'income';

export interface LedgerDay {
  date: string;
  /** その日の記録（収入が先、あとは金額の大きい順）。絞り込みで隠したものは含まない */
  entries: Transaction[];
  /** その日の収支（絞り込みに関係なく全件） */
  net: number;
  /** 期間の初日からその日までの収支の累計（絞り込みに関係なく全件） */
  running: number;
}

/** 記録 1 件が収支に与える額（収入 +、支出 −。収入カテゴリで支出にしたものは収入の取り消しとして −） */
export function signedAmount(t: Transaction): number {
  return t.type === 'income' ? t.amount : -t.amount;
}

/**
 * 履歴の一覧表示: 期間の記録を日付順に並べ、日ごとの収支と累計（お金の流れ）を付ける。
 * 記録のない日は出さない。予定の日付（自動記録の固定費など）も含める。
 */
export function ledgerDays(transactions: Transaction[], period: Period, filter: LedgerFilter = 'all'): LedgerDay[] {
  const live = transactions.filter((t) => !t.deleted_at && t.date >= period.start && t.date <= period.end);
  const byDate = new Map<string, Transaction[]>();
  for (const t of live) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  const out: LedgerDay[] = [];
  let running = 0;
  for (const date of [...byDate.keys()].sort()) {
    const all = byDate.get(date)!;
    const net = all.reduce((a, t) => a + signedAmount(t), 0);
    running += net;
    const entries = all
      .filter((t) => filter === 'all' || t.type === filter)
      .sort((a, b) => (a.type === b.type ? b.amount - a.amount || a.created_at.localeCompare(b.created_at) : a.type === 'income' ? -1 : 1));
    if (entries.length > 0) out.push({ date, entries, net, running });
  }
  return out;
}
