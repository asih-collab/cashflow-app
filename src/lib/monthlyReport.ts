// 月終わりのふり返りと来月の見通し。予算期間が終わるたびに、その人の記録だけから計算する（端末の中で。外に出さない）。
// 数字は記録から毎回同じに出るので、保存はしない（どの端末で開いても同じ）。
// アドバイス・役立ち情報のルールと文言は adviceRules.ts（MONTHLY_TIPS / MONTHLY_LIMITS）。月 1 回の見直しでいっしょに直す。

import type { Advice } from './advice';
import type { Budget, Category, Debt, Goal, RecurringRule, Transaction } from './types';
import { budgetableParents, spentByParent } from './budget';
import { statsFor } from './stats';
import { parseDate, periodFor, shiftPeriod, toDateString, type Period } from './period';
import { monthInPeriod } from './recurring';
import { pendingLumps } from './debt';
import { goalLabel, goalStatus } from './goal';
import { MONTHLY_LIMITS, MONTHLY_TIPS } from './adviceRules';

export interface ParentLine {
  id: string;
  name: string;
  /** 終わった期間の実績 */
  actual: number;
  /** 終わった期間の予算（なければ null） */
  budget: number | null;
  /** その前の期間の実績（記録がなければ null） */
  prev: number | null;
  /** 来月の見込み（直近 3 期間の重み付き平均: 新しい順に 3:2:1） */
  predicted: number;
  /** 来月の予算の案（見込みを 1,000 円単位に切り上げ） */
  suggested: number;
  /** 来月の予算がもうあれば、その額 */
  nextBudget: number | null;
}

export interface PlannedEvent {
  label: string;
  amount: number;
  kind: 'debt' | 'goal';
}

export interface MonthlyReport {
  /** ふり返る期間（終わった期間。期間の最終日はその期間） */
  period: Period;
  next: Period;
  income: number;
  fixed: number;
  variable: number;
  balance: number;
  /** その前の期間の変動費（記録がなければ null） */
  prevVariable: number | null;
  lines: ParentLine[];
  /** 変動費 0 円の日、記録を始めてからの日数（期間の中） */
  noSpendDays: number;
  trackedDays: number;
  /** 土日の変動費の割合（0〜1） */
  weekendShare: number;
  /** よく使う小さな出費（回数の多い順） */
  habits: { name: string; count: number; total: number }[];
  /** 固定費のサブスク（自動記録のルール） */
  subscriptions: { name: string; amount: number }[];
  forecast: { income: number; fixed: number; variable: number; balance: number };
  /** 来月の一括返済・貯金の入金の予定（見込みの収支には入れない。ボーナスなどから払う前提のため） */
  events: PlannedEvent[];
  /** 金利の一番高い借入（年率） */
  topDebt: { name: string; rate: number; balance: number } | null;
  goals: { label: string; ratio: number; total: number; target: number; reachMonth: string | null }[];
  tips: Advice[];
}

const SUBSCRIPTION_PARENT = '11111111-0012-4000-8000-000000000000';

/** ふり返る期間: 今日が期間の最終日ならその期間、そうでなければ 1 つ前の期間 */
export function reportPeriod(today: Date, startDay: number): Period {
  const p = periodFor(today, startDay);
  return toDateString(today) === p.end ? p : shiftPeriod(p, 1, startDay);
}

/** ホームで知らせる日: 期間の最終日から、次の期間の 7 日目まで */
export function reportIsFresh(today: Date, startDay: number): boolean {
  const p = periodFor(today, startDay);
  const t = toDateString(today);
  if (t === p.end) return true;
  const day = Math.round((parseDate(t).getTime() - parseDate(p.start).getTime()) / 86400000);
  return day < 7;
}

export function buildMonthlyReport(input: {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  rules: RecurringRule[];
  debts: Debt[];
  goals: Goal[];
  startDay: number;
  today: Date;
}): MonthlyReport | null {
  const { categories, startDay, today } = input;
  const tx = input.transactions.filter((t) => !t.deleted_at);
  const firstDate = tx.filter((t) => t.source !== 'recurring').map((t) => t.date).sort()[0];
  const period = reportPeriod(today, startDay);
  if (!firstDate || firstDate > period.end) return null;
  const next = shiftPeriod(period, -1, startDay);
  const prev = shiftPeriod(period, 1, startDay);
  const prev2 = shiftPeriod(period, 2, startDay);
  const hasData = (p: Period) => firstDate <= p.end;

  const s = statsFor(tx, categories, period);
  const fixed = s.fixedTotal;
  const variable = s.variableTotal;
  const income = s.incomeTotal;

  // 大分類ごとの実績と見込み
  const spent = [period, prev, prev2].map((p) => (hasData(p) ? spentByParent(tx, categories, p) : null));
  const budgetOf = (pStart: string, id: string) => input.budgets.find((b) => !b.deleted_at && b.period_start === pStart && b.category_id === id)?.amount ?? null;
  const lines: ParentLine[] = [];
  for (const c of budgetableParents(categories)) {
    const vals = spent.map((m) => (m ? m.get(c.id) ?? 0 : null));
    const weights = [3, 2, 1];
    let w = 0, sum = 0;
    vals.forEach((v, i) => { if (v !== null) { sum += v * weights[i]!; w += weights[i]!; } });
    const predicted = w > 0 ? Math.round(sum / w) : 0;
    const budget = budgetOf(period.start, c.id);
    if (vals[0] === 0 && predicted === 0 && !budget) continue;
    lines.push({
      id: c.id, name: c.name, actual: vals[0] ?? 0, budget, prev: vals[1] ?? null, predicted,
      suggested: Math.ceil(predicted / 1000) * 1000, nextBudget: budgetOf(next.start, c.id),
    });
  }
  lines.sort((a, b) => b.actual - a.actual);

  // 使わない日・土日の割合
  const byId = new Map(categories.map((c) => [c.id, c]));
  const isVariable = (t: Transaction) => t.type === 'expense' && (byId.get(t.category_id ?? '')?.kind ?? 'variable') === 'variable';
  const varTx = tx.filter((t) => isVariable(t) && t.date >= period.start && t.date <= period.end);
  const spendDays = new Set(varTx.map((t) => t.date));
  let noSpendDays = 0, trackedDays = 0;
  for (let d = parseDate(period.start > firstDate ? period.start : firstDate); toDateString(d) <= period.end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    trackedDays++;
    if (!spendDays.has(toDateString(d))) noSpendDays++;
  }
  const weekend = varTx.filter((t) => [0, 6].includes(parseDate(t.date).getDay())).reduce((a, t) => a + t.amount, 0);
  const habitMap = new Map<string, { name: string; count: number; total: number }>();
  for (const t of varTx) {
    const name = byId.get(t.category_id ?? '')?.name ?? '未分類';
    const x = habitMap.get(name) ?? { name, count: 0, total: 0 };
    x.count++; x.total += t.amount;
    habitMap.set(name, x);
  }

  // 来月の固定費・収入（自動記録のルールで、来月の期間に入る分）
  let fIncome = 0, fFixed = 0;
  const subscriptions: { name: string; amount: number }[] = [];
  for (const r of input.rules) {
    if (!r.is_active || r.deleted_at) continue;
    const m = monthInPeriod(r.day_of_month, next);
    if (!m || m < r.start_month || (r.end_month && m > r.end_month)) continue;
    if (r.type === 'income') fIncome += r.amount; else fFixed += r.amount;
    const cat = byId.get(r.category_id ?? '');
    if (r.type === 'expense' && (cat?.parent_id ?? cat?.id) === SUBSCRIPTION_PARENT) subscriptions.push({ name: r.name, amount: r.amount });
  }
  const fVariable = lines.reduce((a, l) => a + l.predicted, 0);

  // 来月の一括返済・貯金の入金の予定（予定の月 = 来月の期間の最終日の月）
  const eventMonth = next.end.slice(0, 7);
  const events: PlannedEvent[] = [];
  for (const d of input.debts.filter((x) => !x.deleted_at && x.is_active)) {
    for (const l of pendingLumps(d)) if (l.month === eventMonth) events.push({ label: `${d.name}の一括返済`, amount: l.amount, kind: 'debt' });
  }
  const goals = input.goals.filter((g) => !g.deleted_at && g.is_active);
  for (const g of goals) {
    for (const x of g.extras ?? []) if (!x.done && x.month === eventMonth) events.push({ label: `${goalLabel(g)}への入金`, amount: x.amount, kind: 'goal' });
  }

  const debts = input.debts.filter((d) => !d.deleted_at && d.is_active && d.balance > 0).sort((a, b) => b.annual_rate - a.annual_rate);
  const report: MonthlyReport = {
    period, next, income, fixed, variable, balance: income - fixed - variable,
    prevVariable: hasData(prev) ? statsFor(tx, categories, prev).variableTotal : null,
    lines, noSpendDays, trackedDays, weekendShare: variable > 0 ? weekend / variable : 0,
    habits: [...habitMap.values()].sort((a, b) => b.count - a.count),
    subscriptions,
    forecast: { income: fIncome, fixed: fFixed, variable: fVariable, balance: fIncome - fFixed - fVariable },
    events,
    topDebt: debts[0] ? { name: debts[0].name, rate: debts[0].annual_rate, balance: debts[0].balance } : null,
    goals: goals.map((g) => {
      const st = goalStatus(g, tx, input.rules, today);
      return { label: goalLabel(g), ratio: st.ratio, total: st.total, target: g.target, reachMonth: st.reachMonth };
    }),
    tips: [],
  };
  const all: Advice[] = [];
  for (const rule of MONTHLY_TIPS) {
    try { all.push(...rule(report)); } catch { /* 1 つのルールの不具合で全部が出なくならないように */ }
  }
  // 役立ち情報（m_info_*）は、ほかのアドバイスが多くても必ず枠を取る
  all.sort((a, b) => b.priority - a.priority);
  const info = all.filter((a) => a.rule.startsWith('m_info_')).slice(0, MONTHLY_LIMITS.infoSlots);
  const data = all.filter((a) => !a.rule.startsWith('m_info_')).slice(0, MONTHLY_LIMITS.count - info.length);
  report.tips = [...data, ...info];
  return report;
}
