// 改善アドバイス（F23）の土台: 記録・予算・リボから「今月の状況」を計算し、ルール（adviceRules.ts）に渡す。
// 外部の AI は使わない（04 の 5 章）。ルールのしきい値と文言は adviceRules.ts の 1 か所にまとめ、
// 月 1 回の見直しではそのファイルだけを直す（04 の 6 章）。

import type { Budget, Category, Debt, RecurringRule, Transaction } from './types';
import { postingDate, recurringTransactionId } from './recurring';
import { inPeriod, parseDate, toDateString, type Period } from './period';
import { RULES, LIMITS } from './adviceRules';

export type AdviceLevel = 'warn' | 'info' | 'good';

export interface Advice {
  /** ルールの ID（見直しの集計に使う） */
  rule: string;
  /** 同じルールでも対象が違えば別のアドバイス（例: budget_pace:食費） */
  key: string;
  level: AdviceLevel;
  title: string;
  body: string;
  /** 押したときに開く画面（任意） */
  href?: string;
  /** 並べる順（大きいほど上） */
  priority: number;
}

export interface CatAgg {
  id: string;
  name: string;
  amount: number;
  count: number;
}

/** ルールに渡す「今月の状況」 */
export interface AdviceContext {
  period: Period;
  prev: Period;
  today: string;
  /** 期間の何日目か（1 始まり。今日を含む） */
  elapsedDays: number;
  totalDays: number;
  daysLeft: number;
  /** 経過の割合（0〜1） */
  elapsedRatio: number;
  /** 変動費の今日までの実績 */
  variableSoFar: number;
  /** 変動費の月末の見込み（今日までのペースで伸ばす。最初の数日は前月の実績も使う） */
  variableForecast: number;
  /** 収入（予定の日付の自動記録を含む） */
  income: number;
  /** 固定費・準固定費・返済・積立（予定の日付の自動記録を含む） */
  fixed: number;
  /** 月末の収支の見込み = 収入 − 固定費など − 変動費の見込み */
  balanceForecast: number;
  /** 大分類ごとの変動費（今月・前月） */
  parents: CatAgg[];
  prevParents: CatAgg[];
  /** 中分類ごとの変動費（今月・前月） */
  subs: CatAgg[];
  prevSubs: CatAgg[];
  /** 今月の予算（大分類 ID → 金額） */
  budgets: Map<string, number>;
  /** 前月にも記録があるか（比べられるか） */
  hasPrev: boolean;
  /** 直近 7 日（今日を除く）で、手入力の記録がなかった日数 */
  emptyDaysLast7: number;
  /** 始まって間もないか（見込みに予算・前月を混ぜている間） */
  warmingUp: boolean;
  /** 記録を使い始めて何日か（最初の記録の日から） */
  daysSinceFirstRecord: number;
  debts: Debt[];
}

function dayDiff(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

function aggregate(transactions: Transaction[], byId: Map<string, Category>, period: Period, until?: string) {
  const parents = new Map<string, CatAgg>();
  const subs = new Map<string, CatAgg>();
  let variable = 0;
  let income = 0;
  let fixed = 0;
  for (const t of transactions) {
    if (t.deleted_at || !inPeriod(t.date, period)) continue;
    const c = t.category_id ? byId.get(t.category_id) : undefined;
    if (t.type === 'income') { income += t.amount; continue; }
    if (c?.kind === 'income') { income -= t.amount; continue; }
    if (c && c.kind !== 'variable') { fixed += t.amount; continue; }
    if (until && t.date > until) continue;
    variable += t.amount;
    const p = c?.parent_id ? byId.get(c.parent_id) : c;
    const pk = p?.id ?? '';
    const pa = parents.get(pk) ?? { id: pk, name: p?.name ?? '未分類', amount: 0, count: 0 };
    pa.amount += t.amount; pa.count++; parents.set(pk, pa);
    const sk = c?.id ?? '';
    const sa = subs.get(sk) ?? { id: sk, name: c?.name ?? '未分類', amount: 0, count: 0 };
    sa.amount += t.amount; sa.count++; subs.set(sk, sa);
  }
  const sort = (m: Map<string, CatAgg>) => [...m.values()].sort((a, b) => b.amount - a.amount);
  return { parents: sort(parents), subs: sort(subs), variable, income, fixed };
}

export function adviceContext(input: {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  debts: Debt[];
  /** 固定費・給料の自動記録。まだ記録されていない期間内の分を見込みに足す */
  rules?: RecurringRule[];
  period: Period;
  prev: Period;
  today: Date;
}): AdviceContext {
  const { transactions, categories, period, prev } = input;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const today = toDateString(input.today);
  const totalDays = period.totalDays;
  const elapsedDays = Math.min(totalDays, Math.max(1, dayDiff(period.start, today) + 1));
  const daysLeft = totalDays - elapsedDays;
  const cur = aggregate(transactions, byId, period, today);
  const upcoming = upcomingRecurring(input.rules ?? [], transactions, period);
  cur.income += upcoming.income;
  cur.fixed += upcoming.expense;
  const before = aggregate(transactions, byId, prev);
  const budgets = new Map<string, number>();
  for (const b of input.budgets) if (b.period_start === period.start && !b.deleted_at && b.amount > 0) budgets.set(b.category_id, b.amount);
  // 見込み: 今日までのペース。始まって間もない（数日）うちは、予算（なければ前月の実績）と混ぜてぶれを抑える
  const pace = (cur.variable / elapsedDays) * totalDays;
  const w = Math.min(1, elapsedDays / LIMITS.forecastWarmupDays);
  const budgetTotal = [...budgets.values()].reduce((a, b) => a + b, 0);
  const anchor = budgetTotal > 0 ? Math.max(budgetTotal, cur.variable) : before.variable;
  const variableForecast = Math.round(anchor > 0 ? pace * w + anchor * (1 - w) : pace);

  // 直近 7 日（今日を除く）の記録のない日
  const manualDays = new Set(transactions.filter((t) => !t.deleted_at && (t.source === 'manual' || t.source === 'shortcut' || t.source === 'receipt')).map((t) => t.date));
  let emptyDaysLast7 = 0;
  const td = parseDate(today);
  for (let i = 1; i <= 7; i++) {
    const d = toDateString(new Date(td.getFullYear(), td.getMonth(), td.getDate() - i));
    if (!manualDays.has(d)) emptyDaysLast7++;
  }
  const first = transactions.filter((t) => !t.deleted_at && t.source !== 'recurring').map((t) => t.date).sort()[0];

  return {
    period, prev, today, elapsedDays, totalDays, daysLeft, elapsedRatio: elapsedDays / totalDays,
    variableSoFar: cur.variable, variableForecast,
    income: cur.income, fixed: cur.fixed,
    balanceForecast: cur.income - cur.fixed - variableForecast,
    parents: cur.parents, prevParents: before.parents, subs: cur.subs, prevSubs: before.subs,
    budgets, hasPrev: before.variable > 0,
    warmingUp: elapsedDays < LIMITS.forecastWarmupDays,
    emptyDaysLast7,
    daysSinceFirstRecord: first ? dayDiff(first, today) : 0,
    debts: input.debts.filter((d) => !d.deleted_at && d.is_active),
  };
}

/** ルールを全部当てて、優先度の高い順に返す。同じルールの重複は上位だけ（ルール側の maxPerRule まで） */
export function buildAdvice(ctx: AdviceContext): Advice[] {
  const all: Advice[] = [];
  for (const rule of RULES) {
    try {
      all.push(...rule(ctx));
    } catch {
      // 1 つのルールの不具合で全部が出なくならないように
    }
  }
  const perRule = new Map<string, number>();
  return all
    .sort((a, b) => b.priority - a.priority)
    .filter((a) => {
      const n = perRule.get(a.rule) ?? 0;
      perRule.set(a.rule, n + 1);
      return n < LIMITS.maxPerRule;
    });
}

/**
 * 期間内に計上されるはずで、まだ記録になっていない自動記録（月初に計上されるため、給料日基準の期間では
 * 翌月分の固定費が月が変わるまで記録されない）。
 */
export function upcomingRecurring(rules: RecurringRule[], transactions: Transaction[], period: Period): { income: number; expense: number } {
  const ids = new Set(transactions.map((t) => t.id));
  const months = [...new Set([period.start.slice(0, 7), period.end.slice(0, 7)])];
  let income = 0;
  let expense = 0;
  for (const r of rules) {
    if (!r.is_active || r.deleted_at) continue;
    for (const m of months) {
      if (m < r.start_month || (r.end_month && m > r.end_month)) continue;
      const date = postingDate(m, r.day_of_month);
      if (!inPeriod(date, period) || ids.has(recurringTransactionId(r.id, m))) continue;
      if (r.type === 'income') income += r.amount;
      else expense += r.amount;
    }
  }
  return { income, expense };
}


