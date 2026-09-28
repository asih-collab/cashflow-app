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
    expenseCount++;
    const cat = t.category_id ? byId.get(t.category_id) : undefined;
    const kind = cat?.kind ?? 'variable';
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
