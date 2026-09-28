import { h } from '../dom';
import type { AppContext } from '../context';
import type { SyncState } from '../../lib/sync';
import { toast } from '../toast';
import { INSTALL_STEPS } from '../install';
import { icon } from '../icons';

export function syncStatusText(s: SyncState): string {
  const last = s.lastSyncedAt ? new Date(s.lastSyncedAt) : null;
  const lastText = last ? `最終同期 ${last.getMonth() + 1}/${last.getDate()} ${String(last.getHours()).padStart(2, '0')}:${String(last.getMinutes()).padStart(2, '0')}` : '未同期';
  const pending = s.pending > 0 ? ` ・ 未送信 ${s.pending} 件` : '';
  switch (s.status) {
    case 'syncing': return `同期中…${pending}`;
    case 'offline': return `オフライン（復帰後に自動で送ります）${pending} ・ ${lastText}`;
    case 'error': return `同期エラー: ${s.error ?? ''}${pending} ・ ${lastText}`;
    case 'signed_out': return `未ログイン（この iPhone の中だけに保存中）${pending}`;
    case 'unconfigured': return '同期先が設定されていません（端末内のみに保存）';
    default: return `同期済み ・ ${lastText}${pending}`;
  }
}

export function renderSettings(ctx: AppContext): HTMLElement {
  const { store, syncer, sessions } = ctx;
  const root = h('div', { 'data-testid': 'settings' }, h('h1', null, '設定'));

  // ---- アカウントと同期 ----
  const session = sessions.get();
  const acct = h('div', { class: 'card' });
  if (session) {
    acct.appendChild(h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', null, 'ログイン中'), h('div', { class: 'muted small', 'data-testid': 'account-email' }, session.user.email ?? ''))));
    acct.appendChild(h('div', { class: 'list-item' }, h('div', { class: 'grow small', 'data-testid': 'sync-status' }, syncStatusText(syncer.getState())),
      h('button', { class: 'btn sm', type: 'button', 'data-testid': 'sync-now', onClick: async () => { await syncer.sync(); ctx.navigate('/settings'); } }, '今すぐ同期')));
    acct.appendChild(h('div', { class: 'list-item' },
      h('button', { class: 'btn sm danger', type: 'button', 'data-testid': 'logout', onClick: async () => {
        if (!confirm('ログアウトしますか？ iPhone 内の記録はそのまま残ります。')) return;
        if (ctx.client) await ctx.client.signOut(session);
        sessions.set(null);
        await syncer.resetCursors();
        toast('ログアウトしました');
        ctx.navigate('/settings');
      } }, 'ログアウト')));
  } else {
    acct.appendChild(h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', null, '未ログイン'), h('div', { class: 'muted small' }, 'ログインすると Supabase に自動でバックアップされ、機種変更しても引き継げます。')),
      h('a', { class: 'btn sm primary', href: '#/login', 'data-testid': 'go-login', style: 'text-decoration:none' }, 'ログイン')));
  }
  root.appendChild(h('h2', null, 'アカウントと同期'));
  root.appendChild(acct);

  // ---- 使い方の設定 ----
  const prefs = h('div', { class: 'card' });
  prefs.appendChild(h('div', { class: 'list-item' }, h('span', { class: 'grow' }, '開いたときの画面'),
    h('select', { class: 'input', style: 'width:auto', 'data-testid': 'start-screen', onChange: (e: Event) => void store.updateSettings({ start_screen: (e.target as HTMLSelectElement).value as 'add' | 'home' }) },
      h('option', { value: 'add', selected: store.settings.start_screen === 'add' }, '記録（テンキー）'),
      h('option', { value: 'home', selected: store.settings.start_screen === 'home' }, 'ホーム（今月の合計）'),
    )));
  const daySel = h('select', { class: 'input', style: 'width:auto', 'data-testid': 'month-start-day', onChange: (e: Event) => void store.updateSettings({ month_start_day: Number((e.target as HTMLSelectElement).value) }) });
  for (let d = 1; d <= 28; d++) daySel.appendChild(h('option', { value: String(d), selected: store.settings.month_start_day === d }, d === 1 ? '1 日（暦月）' : `${d} 日（例: 給料日）`));
  prefs.appendChild(h('div', { class: 'list-item' }, h('span', { class: 'grow' }, '「今月」の始まりの日'), daySel));
  prefs.appendChild(h('label', { class: 'list-item' }, h('span', { class: 'grow' }, 'カテゴリを選んだらすぐ保存（2 タップ）'),
    h('input', { class: 'toggle', type: 'checkbox', 'data-testid': 'save-on-tap', checked: store.settings.save_on_category_tap, onChange: (e: Event) => void store.updateSettings({ save_on_category_tap: (e.target as HTMLInputElement).checked }) })));
  root.appendChild(h('h2', null, '使い方'));
  root.appendChild(prefs);

  // ---- カテゴリ・支払い手段 ----
  const lists = h('div', { class: 'card' });
  lists.appendChild(h('a', { class: 'list-item', href: '#/categories', style: 'text-decoration:none;color:inherit', 'data-testid': 'go-categories' }, h('span', { class: 'grow' }, 'カテゴリ（追加・名前の変更・非表示）'), h('span', { class: 'muted' }, icon('chevron'))));
  root.appendChild(h('h2', null, 'カテゴリと支払い手段'));
  root.appendChild(lists);

  const pms = h('div', { class: 'card', 'data-testid': 'payment-methods' });
  for (const p of store.paymentMethods.filter((x) => !x.deleted_at).sort((a, b) => a.sort_order - b.sort_order)) {
    pms.appendChild(h('div', { class: 'list-item' },
      h('button', { class: 'grow', type: 'button', style: 'text-align:left;min-height:32px', 'data-testid': `pm-${p.name}`, onClick: async () => {
        const name = prompt('支払い手段の名前', p.name);
        if (name && name.trim() && name.trim() !== p.name) await store.updatePaymentMethod(p.id, { name: name.trim() });
        ctx.navigate('/settings');
      } }, p.name, !p.is_active ? h('span', { class: 'muted small' }, '（非表示）') : null),
      h('button', { class: 'btn sm', type: 'button', onClick: async () => { await store.updatePaymentMethod(p.id, { is_active: !p.is_active }); ctx.navigate('/settings'); } }, p.is_active ? '非表示' : '表示'),
    ));
  }
  pms.appendChild(h('div', { class: 'list-item' }, h('button', { class: 'btn link', type: 'button', 'data-testid': 'add-pm', onClick: async () => {
    const name = prompt('追加する支払い手段の名前（例: 楽天カード）');
    if (!name || !name.trim()) return;
    const type = /pay|ペイ/i.test(name) ? 'qr' : /口座|引落|銀行/.test(name) ? 'bank' : /現金/.test(name) ? 'cash' : 'card';
    await store.addPaymentMethod(name, type);
    ctx.navigate('/settings');
  } }, '＋ 支払い手段を追加')));
  root.appendChild(pms);

  // ---- ホーム画面に追加 ----
  root.appendChild(h('h2', null, 'ホーム画面に追加'));
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'small' }, 'Safari で開いている場合は、次の手順でホーム画面に追加すると、アプリのように 1 タップで開けます。'),
    h('ol', { class: 'steps small' }, INSTALL_STEPS.map((s) => h('li', null, s))),
  ));

  // ---- データ ----
  root.appendChild(h('h2', null, 'データ'));
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'list-item' }, h('span', { class: 'grow' }, 'すべての記録を書き出す（JSON）'),
      h('button', { class: 'btn sm', type: 'button', 'data-testid': 'export', onClick: () => {
        const blob = new Blob([store.exportJson()], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `cashflow-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.appendChild(a); a.click(); a.remove();
      } }, '書き出す')),
    h('div', { class: 'list-item muted small' }, `記録 ${store.liveTransactions.length} 件 ・ バージョン ${ctx.config.version}`),
  ));

  return root;
}
