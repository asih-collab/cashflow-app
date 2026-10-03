// Supabase の REST/Auth を真似る最小のフェイク。同期ロジックのテスト用。
import type { Session } from '../../src/lib/types';

export interface FakeServer {
  fetch: typeof fetch;
  tables: Record<string, Map<string, Record<string, unknown>>>;
  calls: { method: string; path: string; body?: unknown; auth?: string }[];
  clock: { now: number };
  validToken: string;
  refreshOk: boolean;
  failNext: number | null;
}

export function makeSession(token = 'tok', expiresInSec = 3600): Session {
  return { access_token: token, refresh_token: 'rt', expires_at: Math.floor(Date.now() / 1000) + expiresInSec, user: { id: 'u1', email: 'a@example.com' } };
}

export function fakeServer(): FakeServer {
  const tables: FakeServer['tables'] = { categories: new Map(), payment_methods: new Map(), transactions: new Map(), settings: new Map(), recurring_rules: new Map(), budgets: new Map() };
  const s: FakeServer = {
    tables, calls: [], clock: { now: Date.parse('2026-09-28T10:00:00Z') }, validToken: 'tok', refreshOk: true, failNext: null,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const auth = headers.Authorization?.replace('Bearer ', '');
      s.calls.push({ method, path: url.pathname + url.search, body, auth });
      if (s.failNext !== null) {
        const st = s.failNext; s.failNext = null;
        return new Response(JSON.stringify({ message: 'fail' }), { status: st });
      }
      if (url.pathname === '/auth/v1/token') {
        if (!s.refreshOk) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        s.validToken = 'tok-refreshed';
        return new Response(JSON.stringify({ access_token: s.validToken, refresh_token: 'rt2', expires_in: 3600, user: { id: 'u1', email: 'a@example.com' } }));
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        if (auth !== s.validToken) return new Response(JSON.stringify({ message: 'JWT expired' }), { status: 401 });
        const table = url.pathname.slice('/rest/v1/'.length);
        const t = tables[table]!;
        if (method === 'POST') {
          const key = url.searchParams.get('on_conflict') ?? 'id';
          s.clock.now += 1000;
          const synced = new Date(s.clock.now).toISOString();
          for (const row of body as Record<string, unknown>[]) {
            const k = key === 'user_id' ? 'u1' : String(row['id']);
            const old = t.get(k);
            if (old && String(row.updated_at) < String(old.updated_at)) continue; // reject_stale_update
            t.set(k, { ...old, ...row, user_id: 'u1', synced_at: synced });
          }
          return new Response('', { status: 201 });
        }
        const gt = url.searchParams.get('synced_at')?.replace('gt.', '') ?? '';
        const limit = Number(url.searchParams.get('limit') ?? 1000);
        const rows = [...t.values()].filter((r) => String(r.synced_at) > gt).sort((a, b) => String(a.synced_at).localeCompare(String(b.synced_at))).slice(0, limit);
        return new Response(JSON.stringify(rows));
      }
      return new Response('not found', { status: 404 });
    },
  };
  return s;
}
