// 同期（F10）。端末内 IndexedDB を正とし、変更を Supabase に送る。起動時と復帰時に差分を取得する。
// 衝突は updated_at が新しい方を採用。未送信の変更は outbox に残し、通信復帰後に送る。

import type { Db } from './db';
import { SupabaseClient, SupabaseError, isExpiringSoon } from './supabase';
import type { Session, SyncTable } from './types';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'signed_out' | 'unconfigured';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  pending: number;
  error: string | null;
}

export interface OutboxEntry {
  key: string;
  table: SyncTable;
  id: string;
  updated_at: string;
}

export interface SessionStore {
  get(): Session | null;
  set(s: Session | null): void;
}

const TABLES: SyncTable[] = ['categories', 'payment_methods', 'transactions', 'settings'];
const PAGE = 1000;
const TS_FIELDS = ['created_at', 'updated_at', 'deleted_at'];

export function outboxKey(table: SyncTable, id: string): string {
  return `${table}:${id}`;
}

export function normalizeRemoteRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  delete out.user_id;
  delete out.synced_at;
  for (const f of TS_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && v) out[f] = new Date(v).toISOString();
  }
  return out as T;
}

export class SignedOutError extends Error {}

export class Syncer {
  private state: SyncState = { status: 'idle', lastSyncedAt: null, pending: 0, error: null };
  private listeners = new Set<(s: SyncState) => void>();
  private inFlight: Promise<SyncState> | null = null;
  private again = false;

  constructor(
    private readonly db: Db,
    private readonly client: SupabaseClient | null,
    private readonly sessions: SessionStore,
    private readonly isOnline: () => boolean = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    private readonly onPulled: (tables: SyncTable[]) => Promise<void> | void = () => {},
  ) {}

  getState(): SyncState {
    return this.state;
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  async refreshPending(): Promise<number> {
    const n = await this.db.count('outbox');
    this.set({ pending: n });
    return n;
  }

  async markDirty(table: SyncTable, id: string, updated_at: string): Promise<void> {
    const e: OutboxEntry = { key: outboxKey(table, id), table, id, updated_at };
    await this.db.put('outbox', e);
    await this.refreshPending();
  }

  /** 同期を 1 回行う。実行中なら終了後にもう 1 回走らせる */
  sync(): Promise<SyncState> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.inFlight;
  }

  private async run(): Promise<SyncState> {
    await this.refreshPending();
    if (!this.client) {
      this.set({ status: 'unconfigured', error: null });
      return this.state;
    }
    if (!this.sessions.get()) {
      this.set({ status: 'signed_out', error: null });
      return this.state;
    }
    if (!this.isOnline()) {
      this.set({ status: 'offline', error: null });
      return this.state;
    }
    this.set({ status: 'syncing', error: null });
    try {
      await this.push();
      const pulled = await this.pull();
      if (pulled.length) await this.onPulled(pulled);
      const last = new Date().toISOString();
      await this.db.put('meta', last, 'lastSyncedAt');
      this.set({ status: 'idle', lastSyncedAt: last, error: null });
    } catch (e) {
      if (e instanceof SignedOutError) {
        this.sessions.set(null);
        this.set({ status: 'signed_out', error: null });
      } else if (!this.isOnline() || (e instanceof TypeError)) {
        // fetch の失敗（通信断）は TypeError になる
        this.set({ status: 'offline', error: null });
      } else {
        this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    await this.refreshPending();
    return this.state;
  }

  async loadLastSyncedAt(): Promise<void> {
    const v = await this.db.get<string>('meta', 'lastSyncedAt');
    this.set({ lastSyncedAt: v ?? null });
  }

  // ---- token ------------------------------------------------------------

  private async token(): Promise<string> {
    let s = this.sessions.get();
    if (!s) throw new SignedOutError();
    if (isExpiringSoon(s)) {
      s = await this.doRefresh(s);
    }
    return s.access_token;
  }

  private async doRefresh(s: Session): Promise<Session> {
    try {
      const n = await this.client!.refresh(s);
      this.sessions.set(n);
      return n;
    } catch (e) {
      if (e instanceof SupabaseError && (e.status === 400 || e.status === 401 || e.status === 403)) throw new SignedOutError();
      throw e;
    }
  }

  private async withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.token());
    } catch (e) {
      if (e instanceof SupabaseError && e.status === 401) {
        const s = this.sessions.get();
        if (!s) throw new SignedOutError();
        const n = await this.doRefresh(s);
        return fn(n.access_token);
      }
      throw e;
    }
  }

  // ---- push -------------------------------------------------------------

  private async push(): Promise<void> {
    const entries = await this.db.getAll<OutboxEntry>('outbox');
    if (entries.length === 0) return;
    for (const table of TABLES) {
      const mine = entries.filter((e) => e.table === table);
      if (mine.length === 0) continue;
      const rows: Record<string, unknown>[] = [];
      const pushed: OutboxEntry[] = [];
      for (const e of mine) {
        const row = await this.db.get<Record<string, unknown>>(table, table === 'settings' ? 'me' : e.id);
        if (!row) {
          await this.db.delete('outbox', e.key);
          continue;
        }
        rows.push(row);
        pushed.push({ ...e, updated_at: String(row.updated_at) });
      }
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const chunkEntries = pushed.slice(i, i + 200);
        await this.withAuth((t) => this.client!.upsert(table, chunk, table === 'settings' ? 'user_id' : 'id', t));
        for (const e of chunkEntries) {
          const cur = await this.db.get<OutboxEntry>('outbox', e.key);
          // 送信中にさらに変更された行は残す
          if (cur && cur.updated_at === e.updated_at) await this.db.delete('outbox', e.key);
        }
      }
    }
  }

  // ---- pull -------------------------------------------------------------

  private async pull(): Promise<SyncTable[]> {
    const changed: SyncTable[] = [];
    for (const table of TABLES) {
      const cursorKey = `cursor:${table}`;
      let cursor = (await this.db.get<string>('meta', cursorKey)) ?? '1970-01-01T00:00:00Z';
      for (;;) {
        const q = `select=*&synced_at=gt.${encodeURIComponent(cursor)}&order=synced_at.asc,${table === 'settings' ? 'user_id' : 'id'}.asc&limit=${PAGE}`;
        const rows = await this.withAuth((t) => this.client!.select<Record<string, unknown>>(table, q, t));
        if (rows.length === 0) break;
        let applied = 0;
        for (const raw of rows) {
          const synced = String(raw.synced_at);
          if (synced > cursor) cursor = synced;
          const remote = normalizeRemoteRow(raw);
          const key = table === 'settings' ? 'me' : String(remote.id);
          const local = await this.db.get<Record<string, unknown>>(table, key);
          if (local && String(local.updated_at) >= String(remote.updated_at)) continue;
          if (table === 'settings') await this.db.put(table, remote, 'me');
          else await this.db.put(table, remote);
          applied++;
        }
        await this.db.put('meta', cursor, cursorKey);
        if (applied > 0 && !changed.includes(table)) changed.push(table);
        if (rows.length < PAGE) break;
      }
    }
    return changed;
  }

  /** ログアウト時などに同期カーソルを消す（次回は全件取得） */
  async resetCursors(): Promise<void> {
    for (const t of TABLES) await this.db.delete('meta', `cursor:${t}`);
  }
}
