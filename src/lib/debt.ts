// リボ・分割の残高（F08）: 残高と毎月の返済額・年率から、完済見込み月と手数料の合計を出す。
// 手数料は「残高 × 年率 ÷ 12」を毎月の返済から先に引く（元金定額ではなく、カード会社のリボの簡略化）。
// 本人が明細を見て残高を更新すると、そこから計算し直す。

import { addMonths } from './recurring';
import type { Debt } from './types';

export interface DebtPlan {
  /** 完済までの月数。返済額が手数料以下で終わらない場合は null */
  months: number | null;
  /** 最後の返済の月 'YYYY-MM' */
  payoffMonth: string | null;
  /** 完済までの手数料の合計（円） */
  totalInterest: number;
  /** 各月の返済後の残高。[0] は起点の月（残高を確認した月） */
  schedule: { month: string; balance: number }[];
}

const MAX_MONTHS = 600;

export function monthlyInterest(balance: number, annualRatePct: number): number {
  return Math.round((balance * annualRatePct) / 100 / 12);
}

/** 1 件の返済計画。fromMonth は残高を確認した月（その翌月から返済） */
export function planDebt(balance: number, monthly: number, annualRatePct: number, fromMonth: string): DebtPlan {
  const schedule = [{ month: fromMonth, balance: Math.max(0, balance) }];
  let b = Math.max(0, balance);
  let totalInterest = 0;
  let m = fromMonth;
  if (b === 0) return { months: 0, payoffMonth: fromMonth, totalInterest: 0, schedule };
  if (monthly <= monthlyInterest(b, annualRatePct)) return { months: null, payoffMonth: null, totalInterest: 0, schedule };
  for (let i = 1; i <= MAX_MONTHS; i++) {
    m = addMonths(m, 1);
    const interest = monthlyInterest(b, annualRatePct);
    totalInterest += interest;
    b = Math.max(0, b + interest - monthly);
    schedule.push({ month: m, balance: b });
    if (b === 0) return { months: i, payoffMonth: m, totalInterest, schedule };
  }
  return { months: null, payoffMonth: null, totalInterest, schedule };
}

export function debtPlan(d: Debt, extra = 0): DebtPlan {
  return planDebt(d.balance, d.monthly_payment + extra, d.annual_rate, d.balance_date.slice(0, 7));
}

export interface TotalPlan {
  months: number | null;
  payoffMonth: string | null;
  totalInterest: number;
  schedule: { month: string; balance: number }[];
}

/**
 * 全部の残高の合計の推移。extra を足すときは、年率の高いものから順に上乗せする（手数料が一番減る順）。
 * 返し終わったカードの返済額は他へ回さない（今のペースと比べたとき、違いが「上乗せした額」だけになるように）。
 */
export function totalPlan(debts: Debt[], extra = 0): TotalPlan {
  const live = debts.filter((d) => !d.deleted_at && d.is_active);
  if (live.length === 0) return { months: 0, payoffMonth: null, totalInterest: 0, schedule: [] };
  const start = live.map((d) => d.balance_date.slice(0, 7)).sort()[0]!;
  const items = live
    .map((d) => ({ d, b: Math.max(0, d.balance), from: d.balance_date.slice(0, 7) }))
    .sort((a, b) => b.d.annual_rate - a.d.annual_rate);
  const schedule = [{ month: start, balance: items.reduce((a, x) => a + x.b, 0) }];
  let m = start;
  let totalInterest = 0;
  for (let i = 1; i <= MAX_MONTHS; i++) {
    m = addMonths(m, 1);
    let pool = extra;
    for (const x of items) {
      if (m <= x.from || x.b === 0) continue;
      const interest = monthlyInterest(x.b, x.d.annual_rate);
      totalInterest += interest;
      x.b = Math.max(0, x.b + interest - x.d.monthly_payment);
    }
    for (const x of items) {
      if (pool <= 0) break;
      if (m <= x.from || x.b === 0) continue;
      const pay = Math.min(pool, x.b);
      x.b -= pay;
      pool -= pay;
    }
    const total = items.reduce((a, x) => a + x.b, 0);
    schedule.push({ month: m, balance: total });
    if (total === 0) return { months: i, payoffMonth: m, totalInterest, schedule };
    // どれか 1 件でも手数料に追いつかない場合は終わらない
    if (i === MAX_MONTHS || (extra === 0 && items.some((x) => x.b > 0 && x.d.monthly_payment <= monthlyInterest(x.b, x.d.annual_rate)))) break;
  }
  return { months: null, payoffMonth: null, totalInterest, schedule };
}

/** 'YYYY-MM' → 'YYYY年M月' */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y}年${Number(m)}月`;
}

/** 残高を最後に確認してからの日数（更新の案内に使う） */
export function daysSinceBalance(d: Debt, today: Date): number {
  const [y, mo, da] = d.balance_date.split('-').map(Number);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((t.getTime() - new Date(y!, mo! - 1, da!).getTime()) / 86400000);
}

/** 固定費の「リボ・分割返済」の中分類（初期カテゴリの固定 ID） */
export const REPAYMENT_CATEGORY_ID = '11111111-0013-4000-8000-000000000002';

export interface DebtOverview {
  /** 残高の合計 */
  total: number;
  /** 毎月の返済額の合計 */
  monthly: number;
  /** 今の残高で計算した、今月の返済のうち手数料の分 */
  interestNow: number;
  /** 今月の返済のうち元金が減る分（手数料を引いた残り。マイナスにはしない） */
  principalNow: number;
  /** 今の残高のままなら 1 年で払う手数料 */
  yearlyFee: number;
  payoffMonth: string | null;
  months: number | null;
  /** 完済までの手数料の合計（終わらない場合は null） */
  totalInterest: number | null;
  /** 前回確認した残高からの増減（合計。推移が 2 点以上あるカードだけ） */
  changeSinceLast: number | null;
}

export function debtOverview(debts: Debt[]): DebtOverview | null {
  const live = debts.filter((d) => !d.deleted_at && d.is_active);
  if (live.length === 0) return null;
  const total = live.reduce((a, d) => a + d.balance, 0);
  const monthly = live.reduce((a, d) => a + d.monthly_payment, 0);
  const interestNow = live.reduce((a, d) => a + monthlyInterest(d.balance, d.annual_rate), 0);
  const plan = totalPlan(live);
  const withHistory = live.filter((d) => d.history.length >= 2);
  const changeSinceLast = withHistory.length === 0 ? null : withHistory.reduce((a, d) => a + d.history.at(-1)!.balance - d.history.at(-2)!.balance, 0);
  return {
    total, monthly, interestNow, principalNow: Math.max(0, monthly - interestNow), yearlyFee: interestNow * 12,
    payoffMonth: plan.payoffMonth, months: plan.months, totalInterest: plan.months === null ? null : plan.totalInterest, changeSinceLast,
  };
}
