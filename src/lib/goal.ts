// 貯金の目標（旅行資金など）: いくら貯まったか、いつ届くか。
// - 貯まった額 = 目標の中分類の記録（今日まで）の合計 + 当てにする資産（NISA の残高など）
// - 毎月の入金 = 目標の中分類に入る固定費の自動記録（先取り）の合計 + 「◯月から増やす」予定
// - ボーナスなどの入金の予定（extras）は、その月に足す

import { addMonths, monthKey } from './recurring';
import type { Goal, RecurringRule, Transaction } from './types';
import { isUnlocked } from './privacy';

/** 画面に出す名前（鍵付きで鍵が閉じていれば別名） */
export function goalLabel(g: Goal): string {
  return g.is_private && !isUnlocked() ? g.alias || '貯金' : g.name;
}

/** 鍵付きで、まだ見せない目標か */
export function goalHidden(g: Goal): boolean {
  return !!g.is_private && !isUnlocked();
}

export interface GoalStatus {
  /** 記録で貯まった額（今日まで） */
  saved: number;
  /** 当てにする資産の合計 */
  assets: number;
  /** saved + assets */
  total: number;
  /** total ÷ 目標（1 を超えない） */
  ratio: number;
  /** 今の毎月の入金（先取り） */
  monthlyNow: number;
  /** 届く見込みの月 'YYYY-MM'（もう届いていれば今月、10 年以内に届かなければ null） */
  reachMonth: string | null;
  /** 見込みの月まで、あと何か月（今月なら 0） */
  monthsLeft: number | null;
  /** 次の入金の予定（済んでいないもののうち一番早い） */
  nextExtra: { month: string; amount: number } | null;
}

function ruleActive(r: RecurringRule, month: string): boolean {
  return r.is_active && !r.deleted_at && r.type === 'expense' && month >= r.start_month && (!r.end_month || month <= r.end_month);
}

/** 目標に数える中分類（目標の中分類 + 積立に連動する資産の中分類） */
function goalCategories(goal: Goal): Set<string> {
  return new Set([goal.category_id, ...(goal.assets ?? []).map((a) => a.category_id).filter((x): x is string => !!x)]);
}

/** その月の毎月の入金（先取り・連動する積立の自動記録 + 増やす予定） */
export function monthlyFor(goal: Goal, rules: RecurringRule[], month: string): number {
  const cats = goalCategories(goal);
  const fromRules = rules.filter((r) => r.category_id && cats.has(r.category_id) && ruleActive(r, month)).reduce((a, r) => a + r.amount, 0);
  const inc = (goal.increases ?? []).filter((x) => x.from <= month).reduce((a, x) => a + x.amount, 0);
  return fromRules + inc;
}

export function goalStatus(goal: Goal, transactions: Transaction[], rules: RecurringRule[], today: Date, extraNow = 0): GoalStatus {
  const todayStr = `${monthKey(today)}-${String(today.getDate()).padStart(2, '0')}`;
  const mine = transactions.filter((t) => !t.deleted_at && t.type === 'expense' && t.category_id === goal.category_id);
  const saved = mine.filter((t) => t.date <= todayStr).reduce((a, t) => a + t.amount, 0);
  // 資産: 確認した日の残高 + その後の積立の記録（今日まで）
  const linked = (goal.assets ?? []).filter((x) => x.category_id).map((x) => ({
    x, tx: transactions.filter((t) => !t.deleted_at && t.type === 'expense' && t.category_id === x.category_id && t.date > (x.as_of ?? '')),
  }));
  const assets = (goal.assets ?? []).reduce((a, x) => a + Math.max(0, x.amount), 0)
    + linked.reduce((a, l) => a + l.tx.filter((t) => t.date <= todayStr).reduce((b, t) => b + t.amount, 0), 0);
  const total = saved + assets;
  const linkedFuture = linked.reduce((a, l) => a + l.tx.filter((t) => t.date > todayStr).reduce((b, t) => b + t.amount, 0), 0);
  const cur = monthKey(today);
  const pending = (goal.extras ?? []).filter((x) => !x.done && x.amount > 0).sort((a, b) => a.month.localeCompare(b.month));

  // 見込み: 今月の残り（まだ来ていない予定日付の記録と、今月の済んでいない予定）→ 来月以降は毎月の入金と予定
  let acc = total + extraNow + linkedFuture + mine.filter((t) => t.date > todayStr).reduce((a, t) => a + t.amount, 0);
  acc += pending.filter((x) => x.month <= cur).reduce((a, x) => a + x.amount, 0);
  // 今月の先取りは、自動記録が月初に予定日付で記録済み（上の「まだ来ていない記録」に入っている）
  let reachMonth: string | null = acc >= goal.target ? cur : null;
  let m = cur;
  for (let i = 1; reachMonth === null && i <= 120; i++) {
    m = addMonths(m, 1);
    acc += monthlyFor(goal, rules, m) + pending.filter((x) => x.month === m).reduce((a, x) => a + x.amount, 0);
    if (acc >= goal.target) reachMonth = m;
  }
  const monthsLeft = reachMonth === null ? null : monthDiff(cur, reachMonth);
  return {
    saved, assets, total,
    ratio: goal.target > 0 ? Math.min(1, total / goal.target) : 1,
    monthlyNow: monthlyFor(goal, rules, cur),
    reachMonth, monthsLeft,
    nextExtra: pending[0] ? { month: pending[0].month, amount: pending[0].amount } : null,
  };
}

export function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}
