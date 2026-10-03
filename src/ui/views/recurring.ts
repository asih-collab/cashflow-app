// 固定費・給料などの毎月の自動記録（F06）の登録・編集
import { h } from '../dom';
import { yen, group } from '../../lib/money';
import { childrenOf, parentsOf } from '../../lib/categories';
import type { AppContext, Route } from '../context';
import type { RecurringRule } from '../../lib/types';
import { icon } from '../icons';
import { toast } from '../toast';

export function renderRecurring(ctx: AppContext, route: Route): HTMLElement {
  const id = route.params.get('id');
  if (id) return renderRuleForm(ctx, id === 'new' ? null : ctx.store.recurringRules.find((r) => r.id === id) ?? null);
  const { store } = ctx;
  const root = h('div', { 'data-testid': 'recurring' },
    h('div', { class: 'row' }, h('a', { href: '#/settings', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, '固定費・定期の収入')),
    h('div', { class: 'muted small', style: 'margin-bottom:12px' }, '登録すると、毎月 1 回だけ自動で記録されます（その月の分は月初に、予定の日付で記録）。光熱費のように毎月変わるものは「金額は毎月確認」にして、確定したら記録を直します。'),
  );
  const rules = store.activeRules;
  const total = (t: 'expense' | 'income') => rules.filter((r) => r.type === t && r.is_active).reduce((a, r) => a + r.amount, 0);
  if (rules.length > 0) {
    root.appendChild(h('div', { class: 'card row' },
      h('span', { class: 'grow mono' }, 'MONTHLY'),
      h('span', { class: 'amount', style: 'margin-right:14px' }, `−${yen(total('expense'))}`),
      h('span', { class: 'amount is-income' }, `+${yen(total('income'))}`),
    ));
  }
  const card = h('div', { class: 'card tight', 'data-testid': 'rule-list' });
  if (rules.length === 0) card.appendChild(h('div', { class: 'list-item muted' }, 'まだありません。家賃・通信費・サブスク・返済・積立・給料などを登録しましょう。'));
  for (const r of rules) {
    const cat = store.categories.find((c) => c.id === r.category_id);
    card.appendChild(h('a', { class: 'list-item row-link', href: `#/recurring?id=${r.id}`, 'data-testid': `rule-${r.name}` },
      h('div', { class: 'grow' },
        h('div', { style: 'font-weight:700' }, r.name, !r.is_active ? h('span', { class: 'muted small' }, '（停止中）') : null),
        h('div', { class: 'recent-meta' }, `毎月 ${r.day_of_month} 日 · ${cat?.name ?? '未分類'}${r.needs_review ? ' · 毎月確認' : ''}`),
      ),
      h('span', { class: 'amount' + (r.type === 'income' ? ' is-income' : '') }, `${r.type === 'income' ? '+' : ''}${yen(r.amount)}`),
      icon('chevron'),
    ));
  }
  root.appendChild(card);
  root.appendChild(h('a', { class: 'btn primary big', href: '#/recurring?id=new', 'data-testid': 'rule-add', style: 'text-decoration:none;margin-top:4px' }, icon('add'), '追加する'));
  return root;
}

function renderRuleForm(ctx: AppContext, rule: RecurringRule | null): HTMLElement {
  const { store } = ctx;
  let type: 'expense' | 'income' = rule?.type ?? 'expense';
  const nameIn = h('input', { class: 'input', type: 'text', value: rule?.name ?? '', placeholder: '例: 家賃、携帯、給料', 'data-testid': 'rule-name' });
  const amountIn = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: rule ? group(rule.amount) : '', placeholder: '0', 'data-testid': 'rule-amount' });
  const dayIn = h('select', { class: 'input', 'data-testid': 'rule-day' });
  for (let d = 1; d <= 31; d++) dayIn.appendChild(h('option', { value: String(d), selected: (rule?.day_of_month ?? 1) === d }, d === 31 ? '31 日（月末）' : `${d} 日`));
  const catIn = h('select', { class: 'input', 'data-testid': 'rule-category' });
  const pmIn = h('select', { class: 'input', 'data-testid': 'rule-pm' }, h('option', { value: '' }, '指定しない'));
  for (const p of store.activePaymentMethods) pmIn.appendChild(h('option', { value: p.id, selected: rule?.payment_method_id === p.id }, p.name));
  const reviewIn = h('input', { class: 'toggle', type: 'checkbox', checked: rule?.needs_review ?? false, 'data-testid': 'rule-review' });
  const fillCats = () => {
    catIn.replaceChildren();
    // 支出は固定費・準固定費の大分類を先に
    const parents = parentsOf(store.categories).filter((p) => (type === 'income') === (p.kind === 'income'))
      .sort((a, b) => (a.kind === 'variable' ? 1 : 0) - (b.kind === 'variable' ? 1 : 0) || a.sort_order - b.sort_order);
    for (const p of parents) {
      const og = h('optgroup', { label: p.name });
      for (const c of childrenOf(store.categories, p.id).filter((c) => c.is_active)) og.appendChild(h('option', { value: c.id, selected: rule?.category_id === c.id }, c.name));
      catIn.appendChild(og);
    }
  };
  const tabE = h('button', { type: 'button', class: 'seg', 'data-testid': 'rule-expense', onClick: () => setType('expense') }, '支出');
  const tabI = h('button', { type: 'button', class: 'seg', 'data-testid': 'rule-income', onClick: () => setType('income') }, '収入');
  const pmField = h('label', { class: 'field' }, h('span', null, '支払い手段'), pmIn);
  function setType(t: 'expense' | 'income') {
    type = t;
    tabE.classList.toggle('on', t === 'expense');
    tabI.classList.toggle('on', t === 'income');
    pmField.style.display = t === 'income' ? 'none' : '';
    fillCats();
  }
  const root = h('div', { 'data-testid': 'rule-form' },
    h('div', { class: 'row' }, h('a', { href: '#/recurring', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, rule ? '定期の記録を編集' : '定期の記録を追加')),
    h('div', { class: 'segmented', style: 'margin:0 0 14px' }, tabE, tabI),
    h('label', { class: 'field' }, h('span', null, '名前'), nameIn),
    h('label', { class: 'field' }, h('span', null, '金額（円）'), amountIn),
    h('label', { class: 'field' }, h('span', null, '毎月の日付'), dayIn),
    h('label', { class: 'field' }, h('span', null, 'カテゴリ'), catIn),
    pmField,
    h('label', { class: 'list-item', style: 'border:0' }, h('span', { class: 'grow' }, '金額は毎月確認（光熱費など）', h('div', { class: 'muted small' }, '仮の金額で記録し、確定したら記録を直します')), reviewIn),
    h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'rule-save', style: 'margin-top:8px', onClick: async () => {
      const amount = Number(amountIn.value.replace(/\D/g, '')) || 0;
      const name = nameIn.value.trim();
      if (!name || amount <= 0) { toast('名前と金額を入れてください'); return; }
      await store.saveRule({
        id: rule?.id, name, amount, type, category_id: catIn.value || null,
        payment_method_id: type === 'income' ? null : pmIn.value || null,
        day_of_month: Number(dayIn.value), needs_review: reviewIn.checked,
      });
      toast(rule ? `${name} を更新しました` : `${name} を登録しました。今月分を記録しました`);
      ctx.navigate('/recurring');
    } }, '保存'),
    rule ? h('button', { class: 'btn danger big', type: 'button', 'data-testid': 'rule-delete', style: 'margin-top:10px', onClick: async () => {
      if (!confirm(`「${rule.name}」の自動記録をやめますか？ これまでの記録は残ります。`)) return;
      await store.deleteRule(rule.id);
      toast(`${rule.name} の自動記録をやめました`);
      ctx.navigate('/recurring');
    } }, '自動記録をやめる') : null,
  );
  amountIn.addEventListener('blur', () => { const v = Number(amountIn.value.replace(/\D/g, '')); amountIn.value = v ? group(v) : ''; });
  setType(type);
  return root;
}
