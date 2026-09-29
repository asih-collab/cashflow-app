// クイック記録（F01）: 金額テンキー → 中分類 → 保存。日付は今日、支払い手段は前回と同じ。
// 上の切り替えで「収入」にすると、カテゴリが収入用（給与・賞与など）に変わる。

import { h } from '../dom';
import { group, yen } from '../../lib/money';
import { periodFor, toDateString } from '../../lib/period';
import { statsFor } from '../../lib/stats';
import { childrenOf, parentsOf, categoryById } from '../../lib/categories';
import type { AppContext, Route } from '../context';
import { toast } from '../toast';
import type { Category } from '../../lib/types';
import { icon } from '../icons';

const MAX_DIGITS = 7;
const QUICK_COUNT = 8;

export function renderAdd(ctx: AppContext, route: Route): HTMLElement {
  const { store } = ctx;
  let digits = route.params.get('amount')?.replace(/\D/g, '').slice(0, MAX_DIGITS) ?? '';
  let mode: 'expense' | 'income' = route.params.get('type') === 'income' ? 'income' : 'expense';
  const list = () => (mode === 'income' ? store.incomeCategories : store.quickCategories);
  const catParam = route.params.get('cat');
  let selected: Category | null = catParam
    ? [...store.quickCategories, ...store.incomeCategories].find((c) => c.name === catParam) ?? null
    : null;
  if (selected?.kind === 'income') mode = 'income';
  let extraSelected: Category | null = null; // 「その他…」から選んだもの（上位に無い場合）
  let saving = false;

  const period = periodFor(new Date(), store.settings.month_start_day);
  const stats = statsFor(store.transactions, store.categories, period);

  const root = h('div', { class: 'add-view', 'data-testid': 'add' });

  root.appendChild(
    h('div', { class: 'top' },
      h('a', { href: '#/', 'data-testid': 'to-home', style: 'text-decoration:none' }, icon('back'), `${period.label} `, h('span', { class: 'num' }, yen(stats.variableTotal))),
      h('span', null, `${toDateString(new Date()).slice(5).replace('-', '/')} 今日`),
    ),
  );

  const tabExpense = h('button', { type: 'button', class: 'seg', 'data-testid': 'mode-expense', onClick: () => setMode('expense') }, '支出');
  const tabIncome = h('button', { type: 'button', class: 'seg', 'data-testid': 'mode-income', onClick: () => setMode('income') }, '収入');
  root.appendChild(h('div', { class: 'segmented', role: 'tablist' }, tabExpense, tabIncome));

  const display = h('div', { class: 'display empty', 'data-testid': 'amount' }, h('span', { class: 'yen' }, '¥'), '0');
  root.appendChild(display);

  const cats = h('div', { class: 'cats', 'data-testid': 'categories' });
  root.appendChild(cats);

  // 詳細（日付・支払い手段・メモ）は折りたたみ
  const dateInput = h('input', { class: 'input', type: 'date', value: toDateString(new Date()), 'data-testid': 'date' });
  const pmSelect = h('select', { class: 'input', 'data-testid': 'payment-method' });
  for (const p of store.activePaymentMethods) {
    pmSelect.appendChild(h('option', { value: p.id, selected: p.id === store.defaultPaymentMethodId }, p.name));
  }
  const memoInput = h('input', { class: 'input', type: 'text', placeholder: 'メモ（任意）', 'data-testid': 'memo', autocomplete: 'off' });
  const summary = h('summary', null, '詳細（日付・支払い手段・メモ）');
  const details = h('details', { class: 'details' },
    summary,
    h('label', { class: 'field' }, h('span', null, '日付'), dateInput),
    h('label', { class: 'field', 'data-role': 'pm-field' }, h('span', null, '支払い手段（前回と同じが初期値）'), pmSelect),
    h('label', { class: 'field' }, h('span', null, 'メモ'), memoInput),
  );
  root.appendChild(details);

  const keypad = h('div', { class: 'keypad', 'data-testid': 'keypad' });
  for (const k of ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫']) {
    keypad.appendChild(
      h('button', {
        class: 'key' + (k === '⌫' ? ' fn' : ''), type: 'button', 'data-key': k, 'aria-label': k === '⌫' ? '1 文字消す' : k,
        onClick: () => press(k),
      }, k === '⌫' ? icon('backspace') : k),
    );
  }
  root.appendChild(keypad);

  const saveBtn = h('button', { class: 'btn primary big save', type: 'button', 'data-testid': 'save', disabled: true, onClick: () => void save() }, '保存');
  root.appendChild(saveBtn);

  function amount(): number {
    return digits ? Number(digits) : 0;
  }

  function press(k: string): void {
    if (k === '⌫') digits = digits.slice(0, -1);
    else if (digits.length < MAX_DIGITS) {
      const next = digits === '' && (k === '0' || k === '00') ? '' : digits + k;
      digits = next.slice(0, MAX_DIGITS);
    }
    ctx.busy.entering = digits.length > 0;
    update();
  }

  function renderCats(): void {
    cats.replaceChildren();
    const top = list().slice(0, QUICK_COUNT);
    const shown = [...top];
    if (extraSelected && !top.some((c) => c.id === extraSelected!.id)) shown.push(extraSelected);
    for (const c of shown) {
      cats.appendChild(
        h('button', {
          class: 'cat' + (selected?.id === c.id ? ' selected' : ''), type: 'button', 'data-testid': `cat-${c.name}`, 'aria-pressed': selected?.id === c.id ? 'true' : 'false',
          onClick: () => choose(c),
        }, c.name),
      );
    }
    cats.appendChild(h('button', { class: 'cat more', type: 'button', 'data-testid': 'cat-more', onClick: openAll }, 'その他…'));
  }

  function choose(c: Category): void {
    selected = c;
    renderCats();
    update();
    if (store.settings.save_on_category_tap && amount() > 0) void save();
  }

  function openAll(): void {
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'すべてのカテゴリ' }, h('div', { class: 'handle' }));
    for (const p of parentsOf(store.categories).filter((x) => (mode === 'income') === (x.kind === 'income'))) {
      const kids = childrenOf(store.categories, p.id).filter((c) => c.is_active);
      if (kids.length === 0) continue;
      sheet.appendChild(h('h3', null, p.name));
      sheet.appendChild(
        h('div', { class: 'cats' }, kids.map((c) =>
          h('button', { class: 'cat', type: 'button', 'data-testid': `all-cat-${c.name}`, onClick: () => { bg.remove(); extraSelected = c; choose(c); } }, c.name),
        )),
      );
    }
    const bg = h('div', { class: 'sheet-bg', onClick: (e: Event) => { if (e.target === bg) bg.remove(); } }, sheet);
    document.body.appendChild(bg);
  }

  function setMode(m: 'expense' | 'income'): void {
    mode = m;
    if (selected && (selected.kind === 'income') !== (m === 'income')) selected = null;
    extraSelected = null;
    root.classList.toggle('income', m === 'income');
    tabExpense.classList.toggle('on', m === 'expense');
    tabIncome.classList.toggle('on', m === 'income');
    tabExpense.setAttribute('aria-selected', String(m === 'expense'));
    tabIncome.setAttribute('aria-selected', String(m === 'income'));
    const pmField = details.querySelector<HTMLElement>('[data-role="pm-field"]');
    if (pmField) pmField.style.display = m === 'income' ? 'none' : '';
    summary.textContent = m === 'income' ? '詳細（日付・メモ）' : '詳細（日付・支払い手段・メモ）';
    renderCats();
    update();
  }

  function update(): void {
    const a = amount();
    display.replaceChildren(h('span', { class: 'yen' }, '¥'), a > 0 ? group(a) : '0');
    display.classList.toggle('empty', a === 0);
    saveBtn.disabled = saving || a <= 0 || !selected;
    saveBtn.textContent = selected && a > 0 ? `${selected.name} ${mode === 'income' ? '+' : ''}${yen(a)} を保存` : mode === 'income' ? '収入を保存' : '保存';
  }

  async function save(): Promise<void> {
    const a = amount();
    if (saving || a <= 0 || !selected) return;
    saving = true;
    update();
    const t = await store.addTransaction({
      amount: a,
      categoryId: selected.id,
      date: dateInput.value || toDateString(new Date()),
      paymentMethodId: mode === 'income' ? null : pmSelect.value || null,
      memo: memoInput.value.trim(),
      type: mode,
      source: route.params.has('amount') ? 'shortcut' : 'manual',
    });
    ctx.busy.entering = false;
    const p = periodFor(new Date(), store.settings.month_start_day);
    const s = statsFor(store.transactions, store.categories, p);
    const catName = categoryById(store.categories, t.category_id)?.name ?? '';
    const msg = t.type === 'income'
      ? `${catName} +${yen(t.amount)} を収入として記録 ・ ${p.label}の収入 ${yen(s.incomeTotal)}`
      : `${catName} ${yen(t.amount)} を記録 ・ ${p.label} ${yen(s.variableTotal)}`;
    toast(msg, {
      actionLabel: '取り消す',
      durationMs: 5000,
      onAction: () => {
        void store.deleteTransaction(t.id).then(() => toast('取り消しました'));
      },
    });
    ctx.navigate('/');
  }

  setMode(mode);
  return root;
}
