import { h } from '../dom';
import { icon } from '../icons';
import { childrenOf, parentsOf } from '../../lib/categories';
import type { AppContext } from '../context';

export function renderCategories(ctx: AppContext): HTMLElement {
  const { store } = ctx;
  const root = h('div', { 'data-testid': 'categories-view' },
    h('div', { class: 'row' }, h('a', { href: '#/settings', style: 'text-decoration:none;display:inline-flex', 'aria-label': '設定に戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, 'カテゴリ')),
    h('div', { class: 'muted small', style: 'margin-bottom:12px' }, '記録画面には、使った回数の多い中分類から順に並びます。名前を押すと変更できます。'),
  );
  for (const p of parentsOf(store.categories)) {
    const card = h('div', { class: 'card tight', 'data-testid': `parent-${p.name}` });
    for (const c of childrenOf(store.categories, p.id)) {
      card.appendChild(h('div', { class: 'list-item' },
        h('button', { class: 'grow', type: 'button', style: 'text-align:left;min-height:32px', 'data-testid': `edit-${c.name}`, onClick: async () => {
          const name = prompt('中分類の名前', c.name);
          if (name && name.trim() && name.trim() !== c.name) await store.updateCategory(c.id, { name: name.trim() });
          ctx.navigate('/categories');
        } }, c.name, h('span', { class: 'muted small' }, ` ${c.use_count} 回`), !c.is_active ? h('span', { class: 'muted small' }, '（非表示）') : null),
        h('button', { class: 'btn sm', type: 'button', 'data-testid': `toggle-${c.name}`, onClick: async () => { await store.updateCategory(c.id, { is_active: !c.is_active }); ctx.navigate('/categories'); } }, c.is_active ? '非表示' : '表示'),
      ));
    }
    card.appendChild(h('div', { class: 'list-item' }, h('button', { class: 'btn link', type: 'button', 'data-testid': `add-under-${p.name}`, onClick: async () => {
      const name = prompt(`「${p.name}」に追加する中分類の名前`);
      if (!name || !name.trim()) return;
      await store.addSubcategory(p.id, name);
      ctx.navigate('/categories');
    } }, '＋ 追加')));
    root.appendChild(h('h2', null, p.name, h('span', { class: 'muted small', style: 'font-weight:400' }, p.kind === 'fixed' ? '（固定費）' : p.kind === 'semi_fixed' ? '（準固定費）' : '')));
    root.appendChild(card);
  }
  return root;
}
