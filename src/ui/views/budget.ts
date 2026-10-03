// 予算の設定（F05）: 大分類ごと。前の期間の実績を横に出し、前の期間からコピーできる。
import { h } from '../dom';
import { yen, group } from '../../lib/money';
import { budgetableParents, spentByParent } from '../../lib/budget';
import { shiftPeriod } from '../../lib/period';
import type { AppContext, Route } from '../context';
import { monthNav, periodFromParam } from '../monthNav';
import { toast } from '../toast';
import { icon } from '../icons';

export function renderBudget(ctx: AppContext, route: Route): HTMLElement {
  const { store } = ctx;
  const sd = store.settings.month_start_day;
  const { period, isCurrent } = periodFromParam(route.params.get('p'), sd);
  const prev = shiftPeriod(period, 1, sd);
  const prevSpent = spentByParent(store.transactions, store.categories, prev);
  const curSpent = spentByParent(store.transactions, store.categories, period);
  const budgets = store.budgetsFor(period.start);
  const prevBudgets = store.budgetsFor(prev.start);

  const root = h('div', { 'data-testid': 'budget' },
    h('div', { class: 'row' }, h('a', { href: '#/summary', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, '予算')),
    monthNav('/budget', period, sd, isCurrent),
    h('div', { class: 'muted small', style: 'margin:6px 0 12px' }, '大分類ごとに、この月に使ってよい額を決めます。合計が「今月あと使える額」の元になります。右の数字は前の月の実績です。'),
  );

  const totalEl = h('span', { class: 'amount', 'data-testid': 'budget-total' }, yen(budgets.reduce((a, b) => a + b.amount, 0)));
  if (prevBudgets.length > 0 && budgets.length === 0) {
    root.appendChild(h('button', { class: 'btn big', type: 'button', 'data-testid': 'budget-copy', style: 'margin-bottom:12px', onClick: async () => {
      const n = await store.copyBudgets(prev.start, period.start);
      toast(`前の月の予算を ${n} 件コピーしました`);
      ctx.navigate(`/budget?p=${period.start}`);
    } }, '前の月の予算をコピー'));
  }

  const card = h('div', { class: 'card tight' });
  for (const p of budgetableParents(store.categories)) {
    const b = budgets.find((x) => x.category_id === p.id);
    const input = h('input', {
      class: 'input budget-input', type: 'text', inputmode: 'numeric', placeholder: '0', value: b ? group(b.amount) : '',
      'data-testid': `budget-${p.name}`, 'aria-label': `${p.name}の予算`,
    });
    input.addEventListener('focus', () => { input.value = input.value.replace(/\D/g, ''); });
    input.addEventListener('change', async () => {
      const v = Number(input.value.replace(/\D/g, '')) || 0;
      await store.setBudget(p.id, period.start, v);
      input.value = v ? group(v) : '';
      totalEl.textContent = yen(store.budgetsFor(period.start).reduce((a, x) => a + x.amount, 0));
    });
    const used = curSpent.get(p.id) ?? 0;
    card.appendChild(h('div', { class: 'list-item budget-row' },
      h('div', { class: 'grow' },
        h('div', { style: 'font-weight:700' }, p.name),
        h('div', { class: 'recent-meta' }, `前月 ${yen(prevSpent.get(p.id) ?? 0)}${used ? ` · 今月 ${yen(used)}` : ''}`),
      ),
      h('span', { class: 'mono', style: 'margin-right:4px' }, '¥'),
      input,
    ));
  }
  root.appendChild(card);
  root.appendChild(h('div', { class: 'card row' }, h('span', { class: 'grow mono' }, 'TOTAL / 変動費の予算'), totalEl));
  root.appendChild(h('div', { class: 'muted small' }, '固定費（家賃・サブスク・返済・積立）は予算ではなく「固定費・定期の収入」で毎月自動記録します。'));
  return root;
}
