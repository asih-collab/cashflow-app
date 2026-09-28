// Safari でマジックリンクを開いたあと、ホーム画面に追加したアプリ（別の保存領域）にログインを引き継ぐための文字列。
// 端末内のクリップボード経由で渡す。中身はトークンなので、本人の端末内だけで扱う前提。

import type { Session } from './types';

const PREFIX = 'cf1.';

export function encodeHandoff(s: Session): string {
  const json = JSON.stringify({ a: s.access_token, r: s.refresh_token, e: s.expires_at, u: s.user });
  return PREFIX + toBase64Url(json);
}

export function decodeHandoff(text: string): Session | null {
  const t = text.trim();
  if (!t.startsWith(PREFIX)) return null;
  try {
    const o = JSON.parse(fromBase64Url(t.slice(PREFIX.length))) as { a?: string; r?: string; e?: number; u?: Session['user'] };
    if (!o.a || !o.r) return null;
    return { access_token: o.a, refresh_token: o.r, expires_at: Number(o.e) || 0, user: o.u ?? { id: '', email: null } };
  } catch {
    return null;
  }
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
