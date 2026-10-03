// 予算（F05）: 大分類ごと・予算期間ごと。合計が変動費全体の予算。

import type { Budget, Category, Transaction } from './types';
import { inPeriod, type Period } from './period';

/** 大分類 + 期間で決まる予算の ID（別端末で同じ予算を入れても同じ行になる） */
export function budgetId(categoryId: string, periodStart: string): string {
  const head = categoryId.replace(/-/g, '').slice(0, 20);
  const tail = (periodStart.replace(/-/g, '') + '0000').slice(0, 12);
  const hex = head + tail;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface BudgetLine {
  categoryId: string;
  name: string;
  budget: number;
  spent: number;
  /** 予算 − 実績（マイナスは超過） */
  remaining: number;
  /** 実績 ÷ 予算（予算 0 なら 0） */
  ratio: number;
}

export interface BudgetStatus {
  hasBudget: boolean;
  totalBudget: number;
  totalSpent: number;
  remaining: number;
  /** 残り日数で割った 1 日あたりに使える額（0 未満は 0） */
  perDayLeft: number;
  lines: BudgetLine[];
}

/** 予算を立てる対象の大分類（変動費のもの） */
export function budgetableParents(categories: Category[]): Category[] {
  return categories.filter((c) => c.parent_id === null && c.kind === 'variable' && !c.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
}

/** 期間内の大分類ごとの変動費の実績 */
export function spentByParent(transactions: Transaction[], categories: Category[], period: Period): Map<string, number> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out = new Map<string, number>();
  for (const t of transactions) {
    if (t.deleted_at || t.type !== 'expense' || !inPeriod(t.date, period)) continue;
    const c = t.category_id ? byId.get(t.category_id) : undefined;
    if (c && c.kind !== 'variable') continue;
    const parentId = c?.parent_id ?? c?.id ?? '';
    out.set(parentId, (out.get(parentId) ?? 0) + t.amount);
  }
  return out;
}

export function budgetStatus(budgets: Budget[], transactions: Transaction[], categories: Category[], period: Period): BudgetStatus {
  const mine = budgets.filter((b) => b.period_start === period.start && !b.deleted_at);
  const spent = spentByParent(transactions, categories, period);
  const lines: BudgetLine[] = [];
  for (const p of budgetableParents(categories)) {
    const b = mine.find((x) => x.category_id === p.id);
    const s = spent.get(p.id) ?? 0;
    if (!b && s === 0) continue;
    const budget = b?.amount ?? 0;
    lines.push({ categoryId: p.id, name: p.name, budget, spent: s, remaining: budget - s, ratio: budget > 0 ? s / budget : 0 });
  }
  const totalBudget = mine.reduce((a, b) => a + b.amount, 0);
  const totalSpent = [...spent.values()].reduce((a, b) => a + b, 0);
  const remaining = totalBudget - totalSpent;
  return {
    hasBudget: totalBudget > 0,
    totalBudget,
    totalSpent,
    remaining,
    perDayLeft: period.daysLeft > 0 ? Math.max(0, Math.floor(remaining / period.daysLeft)) : 0,
    lines: lines.sort((a, b) => b.ratio - a.ratio || b.spent - a.spent),
  };
}

/** 記録の前後で 80% を超えた大分類（F09 の A/B: アプリ内の警告） */
export function crossedThreshold(before: BudgetStatus, after: BudgetStatus, threshold = 0.8): BudgetLine[] {
  return after.lines.filter((l) => {
    if (l.budget <= 0) return false;
    const prev = before.lines.find((x) => x.categoryId === l.categoryId);
    const prevRatio = prev ? prev.ratio : 0;
    return prevRatio < threshold && l.ratio >= threshold;
  });
}
