// 月次サマリ（F07）: 収支（返済・積立込み）、カテゴリ別の実績と予算、前月比
import { h } from '../dom';
import { yen } from '../../lib/money';
import { shiftPeriod } from '../../lib/period';
import { monthSummary, groupDetail } from '../../lib/summary';
import { categoryById } from '../../lib/categories';
import type { Period } from '../../lib/period';
import type { AppContext as Ctx } from '../context';

/** 開いている行（画面を描き直しても保つ） */
const openRows = new Set<string>();
import type { AppContext, Route } from '../context';
import { monthNav, periodFromParam } from '../monthNav';
import { icon } from '../icons';

function diff(cur: number, prev: number): HTMLElement | null {
  // 前の月に記録がないとき（使い始めの月など）は比べようがないので出さない
  if (prev === 0) return null;
  const d = cur - prev;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return h('span', { class: 'delta' + (d > 0 ? ' up' : d < 0 ? ' down' : '') }, `前月比 ${sign}${yen(Math.abs(d))}`);
}

export function renderSummary(ctx: AppContext, route: Route): HTMLElement {
  const { store } = ctx;
  const sd = store.settings.month_start_day;
  const { period, isCurrent } = periodFromParam(route.params.get('p'), sd);
  const prev = shiftPeriod(period, 1, sd);
  const s = monthSummary(store.transactions, store.categories, store.budgets, period, prev);
  const black = s.balance >= 0;

  const root = h('div', { 'data-testid': 'summary' },
    h('h1', null, 'サマリ'),
    monthNav('/summary', period, sd, isCurrent),
  );

  root.appendChild(h('div', { class: 'card balance ' + (black ? 'black' : 'red'), 'data-testid': 'balance-card' },
    h('div', { class: 'mono' }, black ? 'SURPLUS / 黒字' : 'DEFICIT / 赤字'),
    h('div', { class: 'balance-num', 'data-testid': 'balance' }, `${s.balance > 0 ? '+' : s.balance < 0 ? '−' : ''}${yen(Math.abs(s.balance))}`),
    h('div', { class: 'muted small' }, '収入 − 支出（固定費・返済・積立を含む）', isCurrent ? '。今月分の固定費は月初に予定日付で記録済みのため、見込みを含みます' : ''),
    h('div', { class: 'kv' },
      h('div', null, h('span', { class: 'mono' }, 'INCOME'), h('b', { class: 'is-income', 'data-testid': 'sum-income' }, `+${yen(s.income)}`), diff(s.income, s.prevIncome)),
      h('div', null, h('span', { class: 'mono' }, 'SPEND'), h('b', { 'data-testid': 'sum-expense' }, yen(s.expense)), diff(s.expense, s.prevExpense)),
    ),
  ));

  root.appendChild(h('h2', null, '支出の内訳 / Mix'));
  const total = Math.max(1, s.expense);
  const mix = [
    ['変動費', s.byKind.variable, 'var(--chart)', 'variable'],
    ['準固定費', s.byKind.semi_fixed, '#b9b3a7', 'semi_fixed'],
    ['固定費・返済・積立', s.byKind.fixed, '#6d6a64', 'fixed'],
  ] as const;
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'stack' }, mix.filter((m) => m[1] > 0).map((m) => h('i', { style: `width:${(m[1] / total) * 100}%;background:${m[2]}`, title: m[0] }))),
    mix.map((m) => {
      const kind = m[3];
      const groups = s.groups.filter((g) => g.kind === kind && g.amount > 0);
      const key = `mix:${kind}`;
      const detail = h('div', { class: 'expand-body', 'data-testid': `mix-detail-${kind}`, hidden: !openRows.has(key) },
        groups.length === 0 ? h('div', { class: 'muted small', style: 'padding:4px 0 8px' }, 'この月の記録はありません。') : null,
        groups.map((g) => h('button', { type: 'button', class: 'sub-row', onClick: () => openGroup(g.categoryId) },
          h('span', { class: 'grow' }, g.name),
          h('span', { class: 'muted small', style: 'margin-right:10px' }, `${Math.round((g.amount / Math.max(1, m[1])) * 100)}%`),
          h('span', { class: 'amount', style: 'font-size:16px' }, yen(g.amount)),
          icon('chevron'),
        )),
      );
      const head = h('button', { type: 'button', class: 'list-item expand-head', style: 'padding:8px 0;min-height:40px', 'data-testid': `mix-${kind}`, 'aria-expanded': String(openRows.has(key)), onClick: () => toggle(key, head, detail) },
        h('span', { class: 'swatch', style: `background:${m[2]}` }), h('span', { class: 'grow' }, m[0]), h('span', { class: 'amount', style: 'font-size:18px' }, yen(m[1])), h('span', { class: 'caret' }, icon('chevron')));
      return [head, detail];
    }),
  ));

  root.appendChild(h('div', { class: 'row', style: 'margin-top:28px' },
    h('h2', { class: 'grow', style: 'margin:0' }, 'カテゴリ / Categories'),
    h('a', { class: 'btn sm', href: `#/budget?p=${period.start}`, 'data-testid': 'go-budget', style: 'text-decoration:none;margin-left:10px' }, '予算を設定'),
  ));
  const list = h('div', { class: 'card tight', 'data-testid': 'sum-groups', style: 'margin-top:10px' });
  if (s.groups.length === 0) list.appendChild(h('div', { class: 'list-item muted' }, 'この月の記録はありません。'));
  for (const g of s.groups) {
    const over = g.budget !== null && g.amount > g.budget;
    const key = `grp:${g.categoryId}`;
    const detail = h('div', { class: 'expand-body', 'data-testid': `sum-detail-${g.name}`, hidden: !openRows.has(key) });
    if (openRows.has(key)) fillDetail(ctx, detail, period, g.categoryId);
    const row = h('div', { class: 'list-item', id: `grp-${g.categoryId || 'none'}`, style: 'flex-direction:column;align-items:stretch;gap:6px' },
      h('button', { type: 'button', class: 'row expand-head', 'data-testid': `sum-group-${g.name}`, 'aria-expanded': String(openRows.has(key)), onClick: (e: Event) => {
        if (!detail.childElementCount) fillDetail(ctx, detail, period, g.categoryId);
        toggle(key, e.currentTarget as HTMLElement, detail);
      } },
        h('span', { class: 'grow', style: 'font-weight:700;text-align:left' }, g.name, g.kind !== 'variable' ? h('span', { class: 'breakdown-meta' }, g.kind === 'fixed' ? '固定' : '準固定') : null),
        h('span', { class: 'amount', style: 'font-size:19px' }, yen(g.amount)),
        h('span', { class: 'caret' }, icon('chevron')),
      ),
      g.budget !== null ? h('div', { class: 'bar' + (over ? ' over' : '') }, h('i', { style: `width:${Math.min(100, Math.round((g.amount / Math.max(1, g.budget)) * 100))}%` })) : null,
      h('div', { class: 'row recent-meta' },
        h('span', { class: 'grow' }, g.budget !== null ? `予算 ${yen(g.budget)} · ${over ? `${yen(g.amount - g.budget)} 超過` : `残り ${yen(g.budget - g.amount)}`}` : '予算なし'),
        diff(g.amount, g.prevAmount),
      ),
      detail,
    );
    list.appendChild(row);
  }
  root.appendChild(list);

  function openGroup(categoryId: string): void {
    const el = document.getElementById(`grp-${categoryId || 'none'}`);
    const head = el?.querySelector<HTMLElement>('.expand-head');
    const body = el?.querySelector<HTMLElement>('.expand-body');
    if (!el || !head || !body) return;
    if (!openRows.has(`grp:${categoryId}`)) {
      if (!body.childElementCount) fillDetail(ctx, body, period, categoryId);
      toggle(`grp:${categoryId}`, head, body);
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  root.appendChild(h('a', { class: 'btn big', href: `#/history?p=${period.start}`, style: 'text-decoration:none;margin-top:4px' }, icon('chevron'), 'この月の記録を見る'));
  return root;
}

function toggle(key: string, head: HTMLElement, body: HTMLElement): void {
  const open = !openRows.has(key);
  if (open) openRows.add(key);
  else openRows.delete(key);
  body.hidden = !open;
  head.setAttribute('aria-expanded', String(open));
}

/** カテゴリを開いたときの中身: 中分類ごとの合計と、記録の一覧（押すと修正） */
function fillDetail(ctx: Ctx, el: HTMLElement, period: Period, parentId: string): void {
  const { store } = ctx;
  const d = groupDetail(store.transactions, store.categories, period, parentId);
  const total = Math.max(1, d.subs.reduce((a, x) => a + x.amount, 0));
  const MAX = 30;
  el.replaceChildren(h('div', null,
    h('div', { class: 'mono', style: 'margin:6px 0 4px' }, '中分類 / Sub'),
    d.subs.map((x) => h('div', { class: 'sub-row static', 'data-testid': 'sub-row' },
      h('span', { class: 'grow' }, x.name, h('span', { class: 'breakdown-meta' }, `${x.count} 件`)),
      h('span', { class: 'muted small', style: 'margin-right:10px' }, `${Math.round((x.amount / total) * 100)}%`),
      h('span', { class: 'amount', style: 'font-size:16px' }, yen(x.amount)),
    )),
    h('div', { class: 'mono', style: 'margin:12px 0 4px' }, `記録 / Entries · ${d.items.length}`),
    d.items.slice(0, MAX).map((t) => h('a', { class: 'sub-row', href: `#/edit?id=${t.id}`, 'data-testid': 'detail-item' },
      h('span', { class: 'mono', style: 'width:44px;flex:none' }, t.date.slice(5).replace('-', '/')),
      h('span', { class: 'grow', style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
        categoryById(store.categories, t.category_id)?.name ?? '未分類', t.memo ? h('span', { class: 'muted small' }, ` ${t.memo}`) : null),
      h('span', { class: 'amount', style: 'font-size:16px' }, yen(t.amount)),
      icon('chevron'),
    )),
    d.items.length > MAX ? h('a', { class: 'btn sm', href: `#/history?p=${period.start}`, style: 'margin-top:8px;text-decoration:none' }, `ほか ${d.items.length - MAX} 件は履歴で`) : null,
  ));
}
