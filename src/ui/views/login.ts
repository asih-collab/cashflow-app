// ログイン（F10）: メールアドレスを入れると 6 桁のコード付きメールが届く。コードを入れてログイン。
// マジックリンクを押した場合も同じメールで動く（ホーム画面追加後は Safari と保存領域が分かれるため、コード入力を主にする）。

import { h } from '../dom';
import { icon } from '../icons';
import type { AppContext } from '../context';
import { SupabaseError } from '../../lib/supabase';
import { toast } from '../toast';
import { decodeHandoff } from '../../lib/handoff';
import { isIOS, isStandalone } from '../install';

const EMAIL_KEY = 'cf.loginEmail';

export function renderLogin(ctx: AppContext): HTMLElement {
  const root = h('div', { 'data-testid': 'login' },
    h('div', { class: 'row' }, h('a', { href: '#/settings', style: 'text-decoration:none;display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, 'ログイン')),
  );
  if (!ctx.client) {
    root.appendChild(h('div', { class: 'banner warn' }, '同期先（Supabase）の設定がこのビルドに入っていません。端末内のみで動きます。'));
    return root;
  }
  const client = ctx.client;
  const savedEmail = localStorage.getItem(EMAIL_KEY) ?? '';
  const emailInput = h('input', { class: 'input', type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'メールアドレス', value: savedEmail, 'data-testid': 'email' });
  const sendBtn = h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'send-code' }, 'ログイン用のメールを送る');
  const msg = h('div', { class: 'small muted', style: 'margin-top:8px', 'data-testid': 'login-message' });

  const standalone = isIOS() && isStandalone();
  const pasteInput = h('textarea', { class: 'input', rows: '2', placeholder: 'cf1. で始まる文字列', style: 'font-size:13px', 'data-testid': 'handoff-input', autocomplete: 'off' });
  const pasteBtn = h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'handoff-login' }, '貼り付けてログイン');
  const codeInput = h('input', { class: 'input code-input', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '000000', maxlength: '8', 'data-testid': 'code' });
  const verifyBtn = h('button', { class: 'btn big', type: 'button', 'data-testid': 'verify-code' }, 'コードでログイン');
  const step2 = h('div', { class: 'card', style: 'display:none', 'data-testid': 'step2' },
    h('div', null, h('b', null, 'メールが届いたら、中のリンクを押してください。')),
    standalone
      ? h('div', { class: 'muted small', style: 'margin:4px 0 10px' }, 'リンクは Safari で開きます。そこに出る「ログイン情報をコピー」を押してから、このアプリに戻って下の欄に貼り付けてください。')
      : h('div', { class: 'muted small', style: 'margin:4px 0 10px' }, 'リンクを押すとそのままログインできます。届かないときは迷惑メールも確認してください。'),
    h('label', { class: 'field' }, h('span', null, 'Safari でコピーしたログイン情報'), pasteInput),
    pasteBtn,
    h('details', { style: 'margin-top:12px' },
      h('summary', { class: 'small muted' }, 'メールにコードが書かれている場合'),
      h('label', { class: 'field', style: 'margin-top:8px' }, h('span', null, 'コード'), codeInput),
      verifyBtn,
    ),
  );

  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'small muted', style: 'margin-bottom:10px' }, 'パスワードはありません。メールアドレスを入れると、ログイン用のリンクがメールで届きます。'),
    h('div', { class: 'small muted', style: 'margin-bottom:10px' }, '記録はこのアプリの管理者が用意した Supabase に保存されます。他の利用者からは見えませんが、管理者は閲覧できます。登録できるのは、管理者が許可したメールアドレスだけです。'),
    h('label', { class: 'field' }, h('span', null, 'メールアドレス'), emailInput),
    sendBtn,
    msg,
  ));
  root.appendChild(step2);

  sendBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email.includes('@')) { msg.textContent = 'メールアドレスを入力してください。'; return; }
    sendBtn.disabled = true;
    msg.textContent = '送信中…';
    try {
      await client.sendCode(email, location.origin + location.pathname);
      localStorage.setItem(EMAIL_KEY, email);
      msg.textContent = `${email} にメールを送りました。`;
      step2.style.display = '';
      codeInput.focus();
    } catch (e) {
      msg.textContent = friendlyAuthError(e);
    } finally {
      sendBtn.disabled = false;
    }
  });

  async function finish(session: import('../../lib/types').Session): Promise<void> {
    ctx.sessions.set(session);
    await ctx.syncer.resetCursors();
    toast('ログインしました。同期を始めます。');
    ctx.navigate('/');
    void ctx.syncer.sync();
  }

  pasteBtn.addEventListener('click', async () => {
    const s = decodeHandoff(pasteInput.value);
    if (!s) { msg.textContent = '貼り付けた内容が違うようです。Safari の「ログイン情報をコピー」を押してから貼り付けてください。'; return; }
    pasteBtn.disabled = true;
    try {
      // 引き継いだトークンで更新し、有効か確かめる
      const fresh = await client.refresh(s);
      await finish(fresh);
    } catch (e) {
      msg.textContent = friendlyAuthError(e);
      pasteBtn.disabled = false;
    }
  });

  verifyBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const code = codeInput.value.replace(/\D/g, '');
    if (code.length < 6) { msg.textContent = 'コードを入力してください。'; return; }
    verifyBtn.disabled = true;
    try {
      await finish(await client.verifyCode(email, code));
    } catch (e) {
      msg.textContent = friendlyAuthError(e);
      verifyBtn.disabled = false;
    }
  });

  if (savedEmail && ctx.route?.params.get('step') === '2') step2.style.display = '';
  return root;
}

export function friendlyAuthError(e: unknown): string {
  if (e instanceof SupabaseError) {
    const m = e.message.toLowerCase();
    if (e.status === 429 || m.includes('rate limit')) return 'メールの送信回数の上限に達しました。1 時間ほど待ってからもう一度お試しください。';
    if (m.includes('signup not allowed') || m.includes('database error saving new user') || m.includes('signups not allowed')) return 'このメールアドレスは登録できません（本人専用のため）。';
    if (m.includes('expired') || m.includes('invalid') || m.includes('token has expired')) return 'コードが違うか、期限切れです。もう一度メールを送ってください。';
    return `エラー: ${e.message}`;
  }
  if (e instanceof TypeError) return '通信できません。電波のある場所でもう一度お試しください。';
  return `エラー: ${e instanceof Error ? e.message : String(e)}`;
}
