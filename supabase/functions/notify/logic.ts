// 通知（F09 の C・E）を誰に送るかの判定。日付は日本時間で数える。
// アプリ側の src/lib/period.ts の periodFor と同じ区切り方（テストで一致を確認している）。

export type NotifyKind = 'reminder' | 'review' | 'test';

/** 日本時間の今日（YYYY-MM-DD） */
export function jstDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** その日が予算期間の最終日か（月の開始日 startDay。25 なら 24 日が最終日、1 なら月末） */
export function isLastDayOfPeriod(date: string, startDay: number): boolean {
  const sd = Math.min(28, Math.max(1, Math.trunc(startDay) || 1));
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return next.getUTCDate() === sd;
}

export interface Message {
  title: string;
  body: string;
  /** 押したときに開く画面（アプリ内のハッシュ） */
  url: string;
  tag: string;
}

export function messageFor(kind: NotifyKind): Message {
  switch (kind) {
    case 'reminder':
      return { title: '今日の記録がまだです', body: '使ったものがあれば、忘れないうちに記録しておきましょう。', url: '#/add', tag: 'reminder' };
    case 'review':
      return { title: '今月の振り返り', body: '明日から新しい月です。サマリで今月の収支と予算を確認しましょう。', url: '#/summary', tag: 'review' };
    case 'test':
      return { title: 'テスト通知', body: '通知は届いています。夜 9 時の記録リマインドと、月末の振り返りがこの形で届きます。', url: '#/settings', tag: 'test' };
  }
}

export interface Candidate {
  user_id: string;
  /** その日に手で入れた（ショートカット含む）記録の件数 */
  manualCount: number;
  monthStartDay: number;
}

/** 送る相手（ユーザー単位）を選ぶ。端末ごとのオン・オフは送信時に見る */
export function usersToNotify(kind: NotifyKind, today: string, candidates: Candidate[]): string[] {
  if (kind === 'reminder') return candidates.filter((c) => c.manualCount === 0).map((c) => c.user_id);
  if (kind === 'review') return candidates.filter((c) => isLastDayOfPeriod(today, c.monthStartDay)).map((c) => c.user_id);
  return candidates.map((c) => c.user_id);
}
