// 履歴（S3 / F11）: 月ごとに日付順で一覧。押すと修正。過去の日付で追加もできる
import { h } from '../dom';
import { yen } from '../../lib/money';
import { categoryById } from '../../lib/categories';
import { toDateString } from '../../lib/period';
import type { AppContext, Route } from '../context';
import { monthNav, periodFromParam } from '../monthNav';
import { icon } from '../icons';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function renderHistory(ctx: AppContext, route: Route): HTMLElement {
  const { store } = ctx;
  const sd = store.settings.month_start_day;
  const { period, isCurrent } = periodFromParam(route.params.get('p'), sd);
  const rows = store.liveTransactions
    .filter((t) => t.date >= period.start && t.date <= period.end)
    .sort((a, b) => (b.date + b.created_at).localeCompare(a.date + a.created_at));
  const today = toDateString(new Date());
  const addDate = isCurrent ? today : period.end < today ? period.end : period.start;

  const root = h('div', { 'data-testid': 'history' },
    h('h1', null, '履歴'),
    monthNav('/history', period, sd, isCurrent),
    h('a', { class: 'btn big', href: `#/add?date=${addDate}`, 'data-testid': 'history-add', style: 'text-decoration:none;margin:4px 0 8px' }, icon('add'), isCurrent ? '記録を追加' : `${period.label}に記録を追加`),
  );
  if (rows.length === 0) {
    root.appendChild(h('div', { class: 'card muted' }, 'この月の記録はありません。'));
    return root;
  }
  let day = '';
  let card: HTMLElement | null = null;
  for (const t of rows) {
    if (t.date !== day) {
      day = t.date;
      const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)));
      const spent = rows.filter((x) => x.date === day && x.type === 'expense').reduce((a, x) => a + x.amount, 0);
      root.appendChild(h('div', { class: 'day-head' + (day > today ? ' future' : '') },
        h('span', { class: 'mono' }, `${day.slice(5).replace('-', '/')} (${WEEK[d.getDay()]})${day > today ? ' · 予定' : ''}`),
        h('span', { class: 'mono' }, spent ? yen(spent) : ''),
      ));
      card = h('div', { class: 'card tight' });
      root.appendChild(card);
    }
    const cat = categoryById(store.categories, t.category_id);
    const pm = store.paymentMethods.find((p) => p.id === t.payment_method_id);
    card!.appendChild(h('a', { class: 'list-item row-link', href: `#/edit?id=${t.id}`, 'data-testid': 'history-row' },
      h('div', { class: 'grow' },
        h('div', null, cat?.name ?? '未分類', t.source === 'recurring' ? h('span', { class: 'tag' }, '自動') : null),
        h('div', { class: 'recent-meta' }, [t.memo, pm?.name].filter(Boolean).join(' · ') || ' '),
      ),
      h('span', { class: 'amount' + (t.type === 'income' ? ' is-income' : ''), style: 'font-size:19px' }, `${t.type === 'income' ? '+' : ''}${yen(t.amount)}`),
      icon('chevron'),
    ));
  }
  return root;
}
