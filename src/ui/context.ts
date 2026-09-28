import type { AppConfig } from '../lib/config';
import type { AppStore } from '../lib/store';
import type { SupabaseClient } from '../lib/supabase';
import type { Syncer, SessionStore } from '../lib/sync';

export interface AppContext {
  config: AppConfig;
  store: AppStore;
  syncer: Syncer;
  sessions: SessionStore;
  client: SupabaseClient | null;
  navigate(path: string): void;
  /** 記録画面で入力中かどうか（更新時のリロード判断に使う） */
  busy: { entering: boolean };
  /** 現在表示中のルート */
  route?: Route;
  /** マジックリンクで Safari に着地したが、まだ保存していないセッション（引き継ぎ画面で使う） */
  pendingSession?: import('../lib/types').Session | null;
}

export interface Route {
  path: string;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [p, q] = raw.split('?');
  const path = (p ?? '/').replace(/\/+$/, '') || '/';
  return { path, params: new URLSearchParams(q ?? '') };
}
