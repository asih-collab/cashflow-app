// 月次サマリ（F07）: 収支（返済・積立を含む）、カテゴリ別の実績と予算、前月比。

import type { Budget, Category, CategoryKind, Transaction } from './types';
import { inPeriod, type Period } from './period';

export interface SummaryGroup {
  categoryId: string;
  name: string;
  kind: CategoryKind;
  amount: number;
  budget: number | null;
  prevAmount: number;
}

export interface MonthSummary {
  income: number;
  expense: number;
  /** 収入 − 支出（返済・積立を含む）。黒字判定（ステップ1） */
  balance: number;
  byKind: Record<'variable' | 'semi_fixed' | 'fixed', number>;
  prevExpense: number;
  prevIncome: number;
  groups: SummaryGroup[];
}

function totals(transactions: Transaction[], categories: Category[], period: Period) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  let income = 0;
  let expense = 0;
  const byKind = { variable: 0, semi_fixed: 0, fixed: 0 };
  const byParent = new Map<string, number>();
  for (const t of transactions) {
    if (t.deleted_at || !inPeriod(t.date, period)) continue;
    const c = t.category_id ? byId.get(t.category_id) : undefined;
    if (t.type === 'income') { income += t.amount; continue; }
    if (c?.kind === 'income') { income -= t.amount; continue; }
    expense += t.amount;
    const kind = (c?.kind ?? 'variable') as 'variable' | 'semi_fixed' | 'fixed';
    byKind[kind] += t.amount;
    const pid = c?.parent_id ?? c?.id ?? '';
    byParent.set(pid, (byParent.get(pid) ?? 0) + t.amount);
  }
  return { income, expense, byKind, byParent };
}

export function monthSummary(transactions: Transaction[], categories: Category[], budgets: Budget[], period: Period, prev: Period): MonthSummary {
  const cur = totals(transactions, categories, period);
  const before = totals(transactions, categories, prev);
  const groups: SummaryGroup[] = [];
  const parents = categories.filter((c) => c.parent_id === null && c.kind !== 'income' && !c.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
  for (const p of parents) {
    const amount = cur.byParent.get(p.id) ?? 0;
    const prevAmount = before.byParent.get(p.id) ?? 0;
    const b = budgets.find((x) => x.category_id === p.id && x.period_start === period.start && !x.deleted_at);
    if (amount === 0 && prevAmount === 0 && !b) continue;
    groups.push({ categoryId: p.id, name: p.name, kind: p.kind, amount, budget: b ? b.amount : null, prevAmount });
  }
  const un = cur.byParent.get('') ?? 0;
  if (un > 0) groups.push({ categoryId: '', name: '未分類', kind: 'variable', amount: un, budget: null, prevAmount: before.byParent.get('') ?? 0 });
  return {
    income: cur.income,
    expense: cur.expense,
    balance: cur.income - cur.expense,
    byKind: cur.byKind,
    prevExpense: before.expense,
    prevIncome: before.income,
    groups: groups.sort((a, b) => b.amount - a.amount),
  };
}
