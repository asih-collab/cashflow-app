// 使う前に見せる（記録画面で金額とカテゴリを選んだ時点）: この記録を足すと、予算の残り・今日の目安・チャレンジがどうなるか、
// 手取りで何時間分か。保存の手間は増やさない（表示だけ）。
import type { Budget, Category, Challenge, RecurringRule, Transaction } from './types';
import { budgetStatus } from './budget';
import { dailyContext } from './dailyAdvice';
import { challengeAfter, formatChallenge } from './challenge';
import type { Period } from './period';

/** 手取りの時給の見積もりに使う 1 か月の労働時間 */
export const WORK_HOURS_PER_MONTH = 160;
/** 何円以上から「何時間分」を出すか */
export const HOURS_FROM = 3000;

export interface PreSpend {
  budget: { name: string; before: number; after: number } | null;
  /** 今日の目安の残り（この記録の後） */
  allowanceLeft: number | null;
  challenges: { name: string; text: string; reached: boolean; over: boolean }[];
  /** 手取りで何時間分（0.5 時間単位） */
  hours: number | null;
}

/** 1 か月の手取りの見積もり: 給料の自動記録の合計（なければ前の期間の収入） */
export function monthlyTakeHome(rules: RecurringRule[], transactions: Transaction[], prev: Period): number {
  const fromRules = rules.filter((r) => r.is_active && !r.deleted_at && r.type === 'income').reduce((a, r) => a + r.amount, 0);
  if (fromRules > 0) return fromRules;
  return transactions.filter((t) => !t.deleted_at && t.type === 'income' && t.date >= prev.start && t.date <= prev.end).reduce((a, t) => a + t.amount, 0);
}

export function preSpend(input: {
  transactions: Transaction[]; categories: Category[]; budgets: Budget[]; challenges: Challenge[]; rules: RecurringRule[];
  period: Period; prev: Period; today: Date; categoryId: string; amount: number; date: string; excludeId?: string;
}): PreSpend {
  const { categories, period, categoryId, amount } = input;
  const tx = input.transactions.filter((t) => t.id !== input.excludeId);
  const cat = categories.find((c) => c.id === categoryId);
  const inThisPeriod = input.date >= period.start && input.date <= period.end;
  const out: PreSpend = { budget: null, allowanceLeft: null, challenges: [], hours: null };
  if (!cat || cat.kind !== 'variable' || amount <= 0) return out;

  if (inThisPeriod) {
    const line = budgetStatus(input.budgets, tx, categories, period).lines.find((l) => l.categoryId === cat.parent_id && l.budget > 0);
    if (line) out.budget = { name: line.name, before: line.remaining, after: line.remaining - amount };
    const d = dailyContext({ transactions: tx, categories, budgets: input.budgets, period, today: input.today });
    if (d.allowanceToday !== null && input.date === d.today) out.allowanceLeft = d.allowanceToday - d.todayTotal - amount;
    for (const c of input.challenges) {
      const s = challengeAfter(c, tx, period, categoryId, amount);
      if (s) out.challenges.push({ name: c.name, text: formatChallenge(s, c.kind), reached: s.reached, over: s.over });
    }
  }
  const takeHome = monthlyTakeHome(input.rules, tx, input.prev);
  if (takeHome > 0 && amount >= HOURS_FROM) out.hours = Math.round((amount / (takeHome / WORK_HOURS_PER_MONTH)) * 2) / 2;
  return out;
}
