// 初回起動時の案内: ホーム画面に追加 + ログイン

import { h } from '../dom';
import type { AppContext } from '../context';
import { INSTALL_STEPS, isIOS, isStandalone } from '../install';

export const ONBOARDED_KEY = 'cf.onboarded';

export function showOnboarding(ctx: AppContext): void {
  const box = h('div', { class: 'box' },
    h('h1', null, 'ようこそ'),
    h('p', null, '支払ったらすぐ、金額 → カテゴリ → 保存 の 3 タップで記録します。開けば今月いくら使ったかが見えます。'),
  );
  if (isIOS() && !isStandalone()) {
    box.appendChild(h('div', { class: 'card' },
      h('b', null, 'まず、ホーム画面に追加してください'),
      h('div', { class: 'muted small' }, 'アプリのように 1 タップで開けるようになり、あとで通知も受け取れます。'),
      h('ol', { class: 'steps small' }, INSTALL_STEPS.map((s) => h('li', null, s))),
    ));
  }
  box.appendChild(h('div', { class: 'card' },
    h('b', null, 'ログインすると自動でバックアップされます'),
    h('div', { class: 'muted small' }, 'メールアドレスだけでログインできます（パスワードなし）。あとから設定画面でもできます。'),
  ));
  const done = (to: string) => { localStorage.setItem(ONBOARDED_KEY, '1'); overlay.remove(); if (to) ctx.navigate(to); };
  box.appendChild(h('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:8px' },
    h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'onboard-login', onClick: () => done('/login') }, 'ログインする'),
    h('button', { class: 'btn big', type: 'button', 'data-testid': 'onboard-skip', onClick: () => done('') }, 'あとで（まず記録してみる）'),
  ));
  const overlay = h('div', { class: 'overlay', 'data-testid': 'onboarding' }, box);
  document.body.appendChild(overlay);
}
