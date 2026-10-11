// 履歴（S3 / F11）: 月のカレンダーに日ごとの収支だけを出し、日付を押すと下にその日の詳細を開く。
// 詳細から記録の修正（押す）と、その日付での追加ができる。選んだ日は URL（?d=）に残す。
import { h } from '../dom';
import { yen } from '../../lib/money';
import { categoryById } from '../../lib/categories';
import { toDateString, type Period } from '../../lib/period';
import { calendarCells, compactYen, dailyNet, type DayNet } from '../../lib/calendar';
import type { AppContext, Route } from '../context';
import { monthNav, periodFromParam } from '../monthNav';
import { icon } from '../icons';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${yen(Math.abs(n))}`;
}

export function renderHistory(ctx: AppContext, route: Route): HTMLElement {
  const { store } = ctx;
  const sd = store.settings.month_start_day;
  const { period, isCurrent } = periodFromParam(route.params.get('p'), sd);
  const today = toDateString(new Date());
  const nets = dailyNet(store.transactions, store.categories, period);
  let total = { income: 0, expense: 0 };
  for (const v of nets.values()) total = { income: total.income + v.income, expense: total.expense + v.expense };

  const dParam = route.params.get('d');
  let selected: string | null = dParam && dParam >= period.start && dParam <= period.end ? dParam : isCurrent ? today : null;

  const root = h('div', { 'data-testid': 'history' },
    h('h1', null, '履歴'),
    monthNav('/history', period, sd, isCurrent),
  );

  const net = total.income - total.expense;
  root.appendChild(h('div', { class: 'cal-total' },
    h('div', { class: 'net' }, h('span', { class: 'mono' }, net >= 0 ? 'NET / 黒字' : 'NET / 赤字'), h('b', { class: net >= 0 ? 'is-income' : 'neg', 'data-testid': 'cal-net' }, signed(net))),
    h('div', null, h('span', { class: 'mono' }, 'INCOME'), h('b', { class: 'is-income', 'data-testid': 'cal-income' }, `+${yen(total.income)}`)),
    h('div', null, h('span', { class: 'mono' }, 'SPEND'), h('b', { 'data-testid': 'cal-expense' }, yen(total.expense))),
  ));

  // カレンダー
  const grid = h('div', { class: 'cal', role: 'grid', 'data-testid': 'calendar' },
    WEEK.map((w, i) => h('div', { class: 'cal-wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') }, w)),
  );
  const cellEls = new Map<string, HTMLElement>();
  for (const c of calendarCells(period)) {
    if (!c.date) { grid.appendChild(h('div', { class: 'cal-cell empty' })); continue; }
    const v = nets.get(c.date);
    const date = c.date;
    const cls = ['cal-cell'];
    if (date === today) cls.push('today');
    if (date > today) cls.push('future');
    const showMonth = c.day === 1 || date === period.start;
    const el = h('button', {
      type: 'button', class: cls.join(' '), 'data-testid': `cal-${date}`, 'data-date': date,
      'aria-label': `${Number(date.slice(5, 7))}月${c.day}日${v ? ` 収支 ${signed(v.net)}` : ' 記録なし'}`,
      onClick: () => select(date),
    },
      h('span', { class: 'cal-day' }, showMonth ? `${Number(date.slice(5, 7))}/${c.day}` : String(c.day)),
      // 赤字の日は朱色（「−」は省いて幅を節約）、黒字の日は「+」付きの緑
      v ? h('span', { class: 'cal-net ' + (v.net > 0 ? 'pos' : v.net < 0 ? 'neg' : 'zero') }, `${v.net > 0 ? '+' : ''}${compactYen(v.net)}`) : null,
    );
    cellEls.set(date, el);
    grid.appendChild(el);
  }
  root.appendChild(grid);

  const panel = h('div', { 'data-testid': 'day-panel' });
  root.appendChild(panel);

  function select(date: string): void {
    selected = date;
    for (const [d, el] of cellEls) el.classList.toggle('on', d === date);
    renderPanel(ctx, panel, period, date, nets.get(date), today);
    // 戻ってきたときに同じ日が開くよう、URL に残す（画面の再描画は起こさない）
    history.replaceState(null, '', `${location.pathname}${location.search}#/history?p=${period.start}&d=${date}`);
  }
  if (selected) {
    const s = selected;
    for (const [d, el] of cellEls) el.classList.toggle('on', d === s);
    renderPanel(ctx, panel, period, s, nets.get(s), today);
  } else {
    panel.appendChild(h('div', { class: 'muted small', style: 'margin-top:12px' }, '日付を押すと、その日の記録の確認・修正・追加ができます。'));
  }
  return root;
}

function renderPanel(ctx: AppContext, el: HTMLElement, period: Period, date: string, v: DayNet | undefined, today: string): void {
  const { store } = ctx;
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8)));
  const items = store.liveTransactions
    .filter((t) => t.date === date)
    .sort((a, b) => (a.type === b.type ? b.amount - a.amount : a.type === 'income' ? -1 : 1));
  const back = `/history?p=${period.start}&d=${date}`;
  el.replaceChildren(h('div', { class: 'card day-card', 'data-testid': 'day-detail' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' },
        h('div', { class: 'mono' }, `${date.slice(0, 4)} · ${WEEK[d.getDay()]}${date === today ? ' · 今日' : date > today ? ' · 予定' : ''}`),
        h('div', { class: 'day-title' }, `${Number(date.slice(5, 7))}月${d.getDate()}日`),
      ),
      h('div', { class: 'day-net ' + ((v?.net ?? 0) >= 0 ? 'pos' : 'neg'), 'data-testid': 'day-net' }, signed(v?.net ?? 0)),
    ),
    v ? h('div', { class: 'row recent-meta', style: 'margin:6px 0 2px' },
      h('span', null, `収入 +${yen(v.income)}`), h('span', null, '·'), h('span', null, `支出 ${yen(v.expense)}`), h('span', null, '·'), h('span', null, `${v.count} 件`),
    ) : null,
    h('div', { class: 'day-items' },
      items.length === 0 ? h('div', { class: 'muted small', style: 'padding:10px 0' }, 'この日の記録はありません。') : null,
      items.map((t) => {
        const cat = categoryById(store.categories, t.category_id);
        const parent = cat?.parent_id ? categoryById(store.categories, cat.parent_id) : undefined;
        const pm = store.paymentMethods.find((p) => p.id === t.payment_method_id);
        return h('a', { class: 'list-item row-link', href: `#/edit?id=${t.id}`, 'data-testid': 'history-row' },
          h('div', { class: 'grow' },
            h('div', null, cat?.name ?? '未分類', t.source === 'recurring' ? h('span', { class: 'tag' }, '自動') : null),
            h('div', { class: 'recent-meta' }, [parent?.name, t.memo, pm?.name].filter(Boolean).join(' · ') || ' '),
          ),
          h('span', { class: 'amount' + (t.type === 'income' ? ' is-income' : ''), style: 'font-size:19px' }, `${t.type === 'income' ? '+' : ''}${yen(t.amount)}`),
          icon('chevron'),
        );
      }),
    ),
    h('div', { class: 'day-actions' },
      h('a', { class: 'btn primary', href: `#/add?date=${date}&ret=${encodeURIComponent(back)}`, 'data-testid': 'history-add', style: 'text-decoration:none' }, icon('add'), '支出を追加'),
      h('a', { class: 'btn', href: `#/add?date=${date}&type=income&ret=${encodeURIComponent(back)}`, 'data-testid': 'history-add-income', style: 'text-decoration:none' }, '収入を追加'),
    ),
  ));
}
