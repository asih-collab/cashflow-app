// 節約のチャレンジ（飲み会は月 2 回まで、ギャンブルは月 1 万円まで など）。予算期間ごとに数える。
import type { Challenge, Transaction } from './types';
import { inPeriod, type Period } from './period';

export interface ChallengeStatus {
  challenge: Challenge;
  /** 今の値（回数 or 円） */
  used: number;
  limit: number;
  ratio: number;
  /** 上限に達した（回数は上限ちょうども「達した」） */
  reached: boolean;
  over: boolean;
}

export function challengeStatus(c: Challenge, transactions: Transaction[], period: Period): ChallengeStatus {
  const ids = new Set(c.category_ids);
  const mine = transactions.filter((t) => !t.deleted_at && t.type === 'expense' && t.category_id && ids.has(t.category_id) && inPeriod(t.date, period));
  const used = c.kind === 'count' ? mine.length : mine.reduce((a, t) => a + t.amount, 0);
  return { challenge: c, used, limit: c.limit, ratio: c.limit > 0 ? used / c.limit : used > 0 ? Infinity : 0, reached: used >= c.limit, over: used > c.limit };
}

/** この記録（カテゴリと金額）を足したらどうなるか（記録画面で保存前に見せる） */
export function challengeAfter(c: Challenge, transactions: Transaction[], period: Period, categoryId: string, amount: number): ChallengeStatus | null {
  if (!c.is_active || c.deleted_at || !c.category_ids.includes(categoryId)) return null;
  const s = challengeStatus(c, transactions, period);
  const used = s.used + (c.kind === 'count' ? 1 : amount);
  return { ...s, used, ratio: c.limit > 0 ? used / c.limit : Infinity, reached: used >= c.limit, over: used > c.limit };
}

export function formatChallenge(s: Pick<ChallengeStatus, 'used' | 'limit'>, kind: Challenge['kind']): string {
  const f = (n: number) => n.toLocaleString('ja-JP');
  return kind === 'count' ? `${s.used} / ${s.limit} 回` : `¥${f(s.used)} / ¥${f(s.limit)}`;
}
