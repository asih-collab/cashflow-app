// ホーム画面（F02）の集計。段階 1 は「今月の変動費合計」と「中分類別の内訳」。

import type { Category, Transaction } from './types';
import { inPeriod, type Period } from './period';

export interface Breakdown {
  categoryId: string | null;
  name: string;
  parentName: string;
  amount: number;
  count: number;
}

export interface PeriodStats {
  /** 変動費（kind=variable のカテゴリ）の支出合計 */
  variableTotal: number;
  /** 準固定・固定の支出合計 */
  fixedTotal: number;
  /** 収入合計 */
  incomeTotal: number;
  /** 期間内の支出件数 */
  expenseCount: number;
  /** 変動費の中分類別内訳。金額の多い順 */
  variableBreakdown: Breakdown[];
}

export function statsFor(transactions: Transaction[], categories: Category[], period: Period): PeriodStats {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const acc = new Map<string, Breakdown>();
  let variableTotal = 0;
  let fixedTotal = 0;
  let incomeTotal = 0;
  let expenseCount = 0;

  for (const t of transactions) {
    if (t.deleted_at) continue;
    if (!inPeriod(t.date, period)) continue;
    if (t.type === 'income') {
      incomeTotal += t.amount;
      continue;
    }
    const cat = t.category_id ? byId.get(t.category_id) : undefined;
    const kind = cat?.kind ?? 'variable';
    if (kind === 'income') {
      // 収入のカテゴリで支出として記録されたもの（返金の取り消しなど）は、収入から差し引く
      incomeTotal -= t.amount;
      continue;
    }
    expenseCount++;
    if (kind === 'variable') {
      variableTotal += t.amount;
      const key = t.category_id ?? '';
      const parent = cat?.parent_id ? byId.get(cat.parent_id) : undefined;
      const cur = acc.get(key) ?? { categoryId: t.category_id, name: cat?.name ?? '未分類', parentName: parent?.name ?? '', amount: 0, count: 0 };
      cur.amount += t.amount;
      cur.count += 1;
      acc.set(key, cur);
    } else {
      fixedTotal += t.amount;
    }
  }

  const variableBreakdown = [...acc.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ja'));
  return { variableTotal, fixedTotal, incomeTotal, expenseCount, variableBreakdown };
}

/** 1 日あたりの平均支出（経過日数で割る）。段階 2 の予算表示までの参考値 */
export function perDaySoFar(total: number, period: Period): number {
  const elapsed = period.totalDays - period.daysLeft + 1;
  return elapsed > 0 ? Math.round(total / elapsed) : 0;
}

export interface DailyTotal {
  /** YYYY-MM-DD */
  date: string;
  /** その日の変動費の合計 */
  amount: number;
  /** その日の変動費の件数 */
  count: number;
}

/** 予算期間の各日について、変動費の合計を返す（記録のない日は 0）。ホームの日別グラフ用 */
export function dailyTotals(transactions: Transaction[], categories: Category[], period: Period): DailyTotal[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const days: DailyTotal[] = [];
  const index = new Map<string, DailyTotal>();
  const [y, m, d] = period.start.split('-').map(Number);
  for (let i = 0; i < period.totalDays; i++) {
    const dt = new Date(y!, m! - 1, d! + i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const row = { date: key, amount: 0, count: 0 };
    days.push(row);
    index.set(key, row);
  }
  for (const t of transactions) {
    if (t.deleted_at || t.type !== 'expense') continue;
    const row = index.get(t.date);
    if (!row) continue;
    const kind = (t.category_id ? byId.get(t.category_id)?.kind : undefined) ?? 'variable';
    if (kind !== 'variable') continue;
    row.amount += t.amount;
    row.count += 1;
  }
  return days;
}

/** 軸の上端に使う、切りのよい値（1, 2, 5 × 10^n） */
export function niceCeil(v: number): number {
  if (v <= 0) return 1000;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
