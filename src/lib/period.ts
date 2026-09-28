// 予算期間（「今月」）の計算。初期値は暦月。設定で給料日基準（例: 25 日〜翌月 24 日）にできる。

export interface Period {
  /** YYYY-MM-DD（含む） */
  start: string;
  /** YYYY-MM-DD（含む） */
  end: string;
  /** 表示用。暦月なら「9月」、給料日基準なら「9/25〜10/24」 */
  label: string;
  /** 今日を含む残り日数 */
  daysLeft: number;
  /** 期間の総日数 */
  totalDays: number;
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(a: Date, b: Date): number {
  const ms = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  return Math.round(ms / 86400000);
}

/**
 * today を含む予算期間を返す。
 * startDay=1 なら暦月。startDay=25 なら「25 日〜翌月 24 日」。startDay は 1〜28 に丸める。
 */
export function periodFor(today: Date, startDay = 1): Period {
  const sd = Math.min(28, Math.max(1, Math.trunc(startDay) || 1));
  let start: Date;
  if (today.getDate() >= sd) {
    start = new Date(today.getFullYear(), today.getMonth(), sd);
  } else {
    start = new Date(today.getFullYear(), today.getMonth() - 1, sd);
  }
  const nextStart = new Date(start.getFullYear(), start.getMonth() + 1, sd);
  const end = addDays(nextStart, -1);
  const totalDays = diffDays(start, end) + 1;
  const daysLeft = diffDays(today, end) + 1;
  const label =
    sd === 1
      ? `${start.getMonth() + 1}月`
      : `${start.getMonth() + 1}/${start.getDate()}〜${end.getMonth() + 1}/${end.getDate()}`;
  return { start: toDateString(start), end: toDateString(end), label, daysLeft, totalDays };
}

export function inPeriod(date: string, p: Period): boolean {
  return date >= p.start && date <= p.end;
}
