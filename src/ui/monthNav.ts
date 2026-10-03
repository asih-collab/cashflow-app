// 月（予算期間）の切り替え。?p=YYYY-MM-DD（期間の初日）で表す
import { h } from './dom';
import { icon } from './icons';
import { parseDate, periodFor, shiftPeriod, type Period } from '../lib/period';

export function periodFromParam(param: string | null, startDay: number): { period: Period; isCurrent: boolean } {
  const current = periodFor(new Date(), startDay);
  if (!param || param === current.start) return { period: current, isCurrent: true };
  const p = periodFor(parseDate(param), startDay);
  if (p.start === current.start) return { period: current, isCurrent: true };
  return { period: { ...p, daysLeft: p.start > current.start ? p.totalDays : 0 }, isCurrent: false };
}

export function monthNav(path: string, period: Period, startDay: number, isCurrent: boolean): HTMLElement {
  const prev = shiftPeriod(period, 1, startDay);
  const next = shiftPeriod(period, -1, startDay);
  const y = period.start.slice(0, 4);
  return h('div', { class: 'month-nav' },
    h('a', { href: `#${path}?p=${prev.start}`, class: 'btn sm', 'aria-label': '前の月', 'data-testid': 'month-prev' }, icon('back')),
    h('div', { class: 'month-label' }, h('span', { class: 'mono' }, y), h('b', { 'data-testid': 'month-label' }, period.label), isCurrent ? h('span', { class: 'mono now' }, 'NOW') : null),
    h('a', { href: `#${path}?p=${next.start}`, class: 'btn sm', 'aria-label': '次の月', 'data-testid': 'month-next', style: 'transform:scaleX(-1)' }, icon('back')),
  );
}
