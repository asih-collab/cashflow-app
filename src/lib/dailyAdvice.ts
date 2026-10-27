// 今日の気づき（F23 の日ごと版）: その人の記録だけから、今日・昨日のことを数件。端末の中で計算する（外に出さない）。
// ルール・しきい値・文言は adviceRules.ts（DAILY_RULES / DAILY_LIMITS）。月 1 回の見直しでいっしょに直す。

import type { Advice } from './advice';
import type { Budget, Category, Transaction } from './types';
import { parseDate, toDateString, type Period } from './period';
import { DAILY_RULES, DAILY_LIMITS } from './adviceRules';

export interface DayItem {
  name: string;
  amount: number;
}

export interface DailyContext {
  today: string;
  /** 0 = 日曜 */
  weekday: number;
  /** 今日を含めた予算期間の残り日数 */
  daysLeftInclToday: number;
  /** 今月の変動費の予算の合計（なければ 0） */
  budgetTotal: number;
  /** 昨日までの今月の変動費 */
  spentBeforeToday: number;
  /** 今日の 1 日の目安（予算の残り ÷ 今日を含む残り日数）。予算がなければ null */
  allowanceToday: number | null;
  /** 今日の変動費 */
  todayItems: { sub: string; amount: number }[];
  todayTotal: number;
  /** 昨日の変動費 */
  yesterday: string;
  yesterdayItems: { sub: string; amount: number }[];
  yesterdayTotal: number;
  /** 昨日の 1 日の目安（予算がなければ null） */
  allowanceYesterday: number | null;
  /** これまでの変動費 1 回あたりの平均（記録が少なければ null） */
  avgPerRecord: number | null;
  /** 今日と同じ曜日の 1 日平均、ほかの曜日の 1 日平均、同じ曜日の日数 */
  weekdayAvg: number;
  otherAvg: number;
  weekdaySamples: number;
  /** 今日・明日の固定費などの予定（自動記録で入っている先の日付の記録） */
  scheduledToday: DayItem[];
  scheduledTomorrow: DayItem[];
  /** 今日、給料（収入）が入った */
  paydayIncome: number;
  periodTotalDays: number;
}

const DAY = 86400000;
const addDays = (d: string, n: number) => {
  const x = parseDate(d);
  return toDateString(new Date(x.getFullYear(), x.getMonth(), x.getDate() + n));
};

export function dailyContext(input: { transactions: Transaction[]; categories: Category[]; budgets: Budget[]; period: Period; today: Date }): DailyContext {
  const { transactions, categories, period } = input;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const today = toDateString(input.today);
  const yesterday = addDays(today, -1);
  const live = transactions.filter((t) => !t.deleted_at);
  const isVariable = (t: Transaction) => t.type === 'expense' && (byId.get(t.category_id ?? '')?.kind ?? 'variable') === 'variable';
  const subName = (t: Transaction) => byId.get(t.category_id ?? '')?.name ?? '未分類';
  const variable = live.filter(isVariable);

  const budgetTotal = input.budgets.filter((b) => b.period_start === period.start && !b.deleted_at).reduce((a, b) => a + b.amount, 0);
  const spentBeforeToday = variable.filter((t) => t.date >= period.start && t.date < today).reduce((a, t) => a + t.amount, 0);
  const daysLeftInclToday = Math.max(1, Math.round((parseDate(period.end).getTime() - parseDate(today).getTime()) / DAY) + 1);
  const allowanceToday = budgetTotal > 0 ? Math.max(0, Math.floor((budgetTotal - spentBeforeToday) / daysLeftInclToday)) : null;
  const spentBeforeYesterday = variable.filter((t) => t.date >= period.start && t.date < yesterday).reduce((a, t) => a + t.amount, 0);
  const allowanceYesterday = budgetTotal > 0 && yesterday >= period.start ? Math.max(0, Math.floor((budgetTotal - spentBeforeYesterday) / (daysLeftInclToday + 1))) : null;

  const todayItems = variable.filter((t) => t.date === today).map((t) => ({ sub: subName(t), amount: t.amount }));
  const yesterdayItems = variable.filter((t) => t.date === yesterday).map((t) => ({ sub: subName(t), amount: t.amount }));

  // 過去 60 日（今日を除く）
  const from = addDays(today, -60);
  const past = variable.filter((t) => t.date >= from && t.date < today);
  const avgPerRecord = past.length >= DAILY_LIMITS.minRecordsForAverage ? Math.round(past.reduce((a, t) => a + t.amount, 0) / past.length) : null;

  // 曜日ごとの 1 日平均（記録を始めた日から昨日まで、記録のない日も 0 円の日として数える）
  const firstDate = live.filter((t) => t.source !== 'recurring').map((t) => t.date).sort()[0];
  const byDay = new Map<string, number>();
  for (const t of variable) if (t.date < today) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
  let wSum = 0, wN = 0, oSum = 0, oN = 0;
  const weekday = parseDate(today).getDay();
  if (firstDate) {
    for (let d = firstDate < from ? from : firstDate; d < today; d = addDays(d, 1)) {
      const v = byDay.get(d) ?? 0;
      if (parseDate(d).getDay() === weekday) { wSum += v; wN++; } else { oSum += v; oN++; }
    }
  }

  const scheduled = (date: string) => live
    .filter((t) => t.date === date && t.source === 'recurring' && t.type === 'expense')
    .map((t) => ({ name: t.memo?.replace(/（仮の金額.*$/, '') || subName(t), amount: t.amount }));
  const paydayIncome = live.filter((t) => t.date === today && t.type === 'income').reduce((a, t) => a + t.amount, 0);

  return {
    today, weekday, daysLeftInclToday, budgetTotal, spentBeforeToday, allowanceToday,
    todayItems, todayTotal: todayItems.reduce((a, x) => a + x.amount, 0),
    yesterday, yesterdayItems, yesterdayTotal: yesterdayItems.reduce((a, x) => a + x.amount, 0), allowanceYesterday,
    avgPerRecord,
    weekdayAvg: wN > 0 ? Math.round(wSum / wN) : 0, otherAvg: oN > 0 ? Math.round(oSum / oN) : 0, weekdaySamples: wN,
    scheduledToday: scheduled(today), scheduledTomorrow: scheduled(addDays(today, 1)),
    paydayIncome,
    periodTotalDays: period.totalDays,
  };
}

/** 今日の気づき（優先度の高い順、上限 DAILY_LIMITS.count 件） */
export function buildDailyAdvice(ctx: DailyContext): Advice[] {
  const all: Advice[] = [];
  for (const rule of DAILY_RULES) {
    try { all.push(...rule(ctx)); } catch { /* 1 つのルールの不具合で全部が出なくならないように */ }
  }
  return all.sort((a, b) => b.priority - a.priority).slice(0, DAILY_LIMITS.count);
}
