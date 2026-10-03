// 月次サマリ（F07）: 収支（返済・積立込み）、カテゴリ別の実績と予算、前月比
import { h } from '../dom';
import { yen } from '../../lib/money';
import { shiftPeriod } from '../../lib/period';
import { monthSummary } from '../../lib/summary';
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
    ['変動費', s.byKind.variable, 'var(--chart)'],
    ['準固定費', s.byKind.semi_fixed, '#b9b3a7'],
    ['固定費・返済・積立', s.byKind.fixed, '#6d6a64'],
  ] as const;
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'stack' }, mix.filter((m) => m[1] > 0).map((m) => h('i', { style: `width:${(m[1] / total) * 100}%;background:${m[2]}`, title: m[0] }))),
    mix.map((m) => h('div', { class: 'list-item', style: 'padding:8px 0;min-height:34px' },
      h('span', { class: 'swatch', style: `background:${m[2]}` }), h('span', { class: 'grow' }, m[0]), h('span', { class: 'amount', style: 'font-size:18px' }, yen(m[1])))),
  ));

  root.appendChild(h('div', { class: 'row', style: 'margin-top:28px' },
    h('h2', { class: 'grow', style: 'margin:0' }, 'カテゴリ / Categories'),
    h('a', { class: 'btn sm', href: `#/budget?p=${period.start}`, 'data-testid': 'go-budget', style: 'text-decoration:none;margin-left:10px' }, '予算を設定'),
  ));
  const list = h('div', { class: 'card tight', 'data-testid': 'sum-groups', style: 'margin-top:10px' });
  if (s.groups.length === 0) list.appendChild(h('div', { class: 'list-item muted' }, 'この月の記録はありません。'));
  for (const g of s.groups) {
    const over = g.budget !== null && g.amount > g.budget;
    list.appendChild(h('div', { class: 'list-item', style: 'flex-direction:column;align-items:stretch;gap:6px' },
      h('div', { class: 'row' },
        h('span', { class: 'grow', style: 'font-weight:700' }, g.name, g.kind !== 'variable' ? h('span', { class: 'breakdown-meta' }, g.kind === 'fixed' ? '固定' : '準固定') : null),
        h('span', { class: 'amount', style: 'font-size:19px' }, yen(g.amount)),
      ),
      g.budget !== null ? h('div', { class: 'bar' + (over ? ' over' : '') }, h('i', { style: `width:${Math.min(100, Math.round((g.amount / Math.max(1, g.budget)) * 100))}%` })) : null,
      h('div', { class: 'row recent-meta' },
        h('span', { class: 'grow' }, g.budget !== null ? `予算 ${yen(g.budget)} · ${over ? `${yen(g.amount - g.budget)} 超過` : `残り ${yen(g.budget - g.amount)}`}` : '予算なし'),
        diff(g.amount, g.prevAmount),
      ),
    ));
  }
  root.appendChild(list);
  root.appendChild(h('a', { class: 'btn big', href: `#/history?p=${period.start}`, style: 'text-decoration:none;margin-top:4px' }, icon('chevron'), 'この月の記録を見る'));
  return root;
}
