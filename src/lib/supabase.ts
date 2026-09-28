// Supabase の Auth（メールのコード / マジックリンク）と REST（PostgREST）を fetch だけで扱う最小クライアント。
// 外部ライブラリを増やさない方針（05 の 4.4）のため自前で持つ。

import type { Session } from './types';

export class SupabaseError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

type Fetch = typeof fetch;

export class SupabaseClient {
  constructor(
    readonly url: string,
    readonly key: string,
    private readonly fetchImpl: Fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(path: string, init: RequestInit & { token?: string; expectJson?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {
      apikey: this.key,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (init.token) headers['Authorization'] = `Bearer ${init.token}`;
    const res = await this.fetchImpl(`${this.url}${path}`, { ...init, headers });
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const b = (body ?? {}) as Record<string, unknown>;
      const msg = String(b.msg ?? b.message ?? b.error_description ?? b.error ?? `HTTP ${res.status}`);
      throw new SupabaseError(msg, res.status, typeof b.error_code === 'string' ? b.error_code : typeof b.code === 'string' ? b.code : undefined);
    }
    return body as T;
  }

  // ---- Auth -------------------------------------------------------------

  /** ログイン用のメール（マジックリンク。文面にコードがあればコードも使える）を送る */
  async sendCode(email: string, redirectTo: string): Promise<void> {
    const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    await this.call(`/auth/v1/otp${q}`, {
      method: 'POST',
      body: JSON.stringify({ email, create_user: true, gotrue_meta_security: {} }),
    });
  }

  /** メールのコードでログインする */
  async verifyCode(email: string, code: string): Promise<Session> {
    const r = await this.call<RawSession>('/auth/v1/verify', {
      method: 'POST',
      body: JSON.stringify({ type: 'email', email, token: code.trim() }),
    });
    return toSession(r);
  }

  /** マジックリンクを開いたときの URL（#access_token=...）からセッションを作る */
  static sessionFromHash(hash: string): Session | null {
    const h = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!h.includes('access_token=')) return null;
    const p = new URLSearchParams(h);
    const access_token = p.get('access_token');
    const refresh_token = p.get('refresh_token');
    if (!access_token || !refresh_token) return null;
    const expires_at = Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + (Number(p.get('expires_in')) || 3600);
    const claims = decodeJwt(access_token);
    return {
      access_token,
      refresh_token,
      expires_at,
      user: { id: String(claims.sub ?? ''), email: typeof claims.email === 'string' ? claims.email : null },
    };
  }

  async refresh(session: Session): Promise<Session> {
    const r = await this.call<RawSession>('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    return toSession(r);
  }

  async signOut(session: Session): Promise<void> {
    try {
      await this.call('/auth/v1/logout?scope=global', { method: 'POST', token: session.access_token });
    } catch {
      // 端末側のセッションを消せれば十分
    }
  }

  // ---- REST -------------------------------------------------------------

  async select<T>(table: string, query: string, token: string): Promise<T[]> {
    const rows = await this.call<T[] | null>(`/rest/v1/${table}?${query}`, { method: 'GET', token });
    return rows ?? [];
  }

  async upsert(table: string, rows: unknown[], onConflict: string, token: string): Promise<void> {
    if (rows.length === 0) return;
    await this.call(`/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      token,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
  }
}

interface RawSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id: string; email?: string | null };
}

function toSession(r: RawSession): Session {
  const expires_at = r.expires_at ?? Math.floor(Date.now() / 1000) + (r.expires_in ?? 3600);
  const claims = decodeJwt(r.access_token);
  return {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at,
    user: {
      id: r.user?.id ?? String(claims.sub ?? ''),
      email: r.user?.email ?? (typeof claims.email === 'string' ? claims.email : null),
    },
  };
}

export function decodeJwt(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      Array.from(atob(b64), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function isExpiringSoon(s: Session, marginSec = 60): boolean {
  return s.expires_at - marginSec <= Math.floor(Date.now() / 1000);
}
