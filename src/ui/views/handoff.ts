// マジックリンクを iPhone の Safari で開いたときの画面。
// ホーム画面に追加したアプリは Safari と保存領域が別なので、ログイン情報をコピーして引き継ぐ。

import { h } from '../dom';
import { icon } from '../icons';
import type { AppContext } from '../context';
import { encodeHandoff } from '../../lib/handoff';
import { toast } from '../toast';

export function renderHandoff(ctx: AppContext): HTMLElement {
  const s = ctx.pendingSession;
  const root = h('div', { 'data-testid': 'handoff' }, h('h1', null, 'ログインできました'));
  if (!s) {
    root.appendChild(h('div', { class: 'card' }, 'ログイン情報が見つかりません。', h('a', { href: '#/login' }, 'ログイン画面へ')));
    return root;
  }
  const blob = encodeHandoff(s);
  const box = h('textarea', { class: 'input', readonly: true, rows: '3', style: 'font-size:12px;word-break:break-all', 'data-testid': 'handoff-text' }, blob);

  const useHere = async () => {
    ctx.sessions.set(s);
    ctx.pendingSession = null;
    await ctx.syncer.resetCursors();
    toast('ログインしました。同期を始めます。');
    ctx.navigate('/');
    void ctx.syncer.sync();
  };

  root.appendChild(h('div', { class: 'card' },
    h('b', null, 'ホーム画面の「家計」アプリで使う場合'),
    h('ol', { class: 'steps small' },
      h('li', null, '下の「ログイン情報をコピー」を押す'),
      h('li', null, 'ホーム画面の「家計」アプリを開く'),
      h('li', null, 'ログイン画面の「貼り付けてログイン」の欄に貼り付けて、ボタンを押す'),
    ),
    h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'copy-handoff', onClick: async () => {
      try {
        await navigator.clipboard.writeText(blob);
        toast('コピーしました。ホーム画面の「家計」アプリを開いて貼り付けてください。', { durationMs: 6000 });
      } catch {
        box.style.display = '';
        box.focus();
        box.select();
        toast('自動でコピーできませんでした。下の文字列を長押しして「すべて選択」→「コピー」してください。', { durationMs: 8000 });
      }
    } }, 'ログイン情報をコピー'),
    h('div', { style: 'margin-top:8px' }, box),
  ));
  box.style.display = 'none';

  root.appendChild(h('div', { class: 'card' },
    h('b', null, 'このまま Safari で使う場合'),
    h('div', { class: 'muted small', style: 'margin:4px 0 10px' }, 'ホーム画面に追加していない場合はこちら。'),
    h('button', { class: 'btn big', type: 'button', 'data-testid': 'use-here', onClick: () => void useHere() }, 'このまま Safari で使う'),
  ));
  return root;
}
