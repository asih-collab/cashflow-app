import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../src/lib/db';
import { AppStore } from '../../src/lib/store';
import { SupabaseClient } from '../../src/lib/supabase';
import { Syncer, normalizeRemoteRow, type SessionStore } from '../../src/lib/sync';
import type { Session, Transaction } from '../../src/lib/types';
import { fakeServer, makeSession, type FakeServer } from './fakeSupabase';

function sessionStore(initial: Session | null): SessionStore & { value: Session | null } {
  const s = { value: initial, get: () => s.value, set: (v: Session | null) => { s.value = v; } };
  return s;
}

interface Device { db: Db; store: AppStore; syncer: Syncer; sessions: ReturnType<typeof sessionStore>; online: { value: boolean } }

async function device(server: FakeServer, name: string, session: Session | null = makeSession()): Promise<Device> {
  const db = new Db(new IDBFactory(), name);
  const sessions = sessionStore(session);
  const online = { value: true };
  const client = new SupabaseClient('https://x.supabase.co', 'pk', server.fetch);
  const store = new AppStore(db);
  const syncer = new Syncer(db, client, sessions, () => online.value, (t) => store.onPulled(t));
  store.attachSyncer(syncer);
  await store.init();
  return { db, store, syncer, sessions, online };
}

let server: FakeServer;
beforeEach(() => { server = fakeServer(); });

describe('同期', () => {
  it('初期化でカテゴリと支払い手段が未送信キューに入り、同期で送られる', async () => {
    const d = await device(server, 'a');
    expect(await d.db.count('outbox')).toBeGreaterThan(0);
    const st = await d.syncer.sync();
    expect(st.status).toBe('idle');
    expect(st.pending).toBe(0);
    expect(server.tables.categories!.size).toBe(d.store.categories.length);
    expect(server.tables.payment_methods!.size).toBe(4);
  });

  it('記録は端末に即保存され、オフラインならキューに残り、復帰後に送られる', async () => {
    const d = await device(server, 'a');
    await d.syncer.sync();
    d.online.value = false;
    const cat = d.store.quickCategories[0]!;
    const t = await d.store.addTransaction({ amount: 1200, categoryId: cat.id });
    expect((await d.db.get<Transaction>('transactions', t.id))?.amount).toBe(1200);
    const st = await d.syncer.sync();
    expect(st.status).toBe('offline');
    expect(st.pending).toBeGreaterThan(0);
    expect(server.tables.transactions!.size).toBe(0);

    d.online.value = true;
    const st2 = await d.syncer.sync();
    expect(st2.status).toBe('idle');
    expect(st2.pending).toBe(0);
    expect(server.tables.transactions!.get(t.id)?.amount).toBe(1200);
    // カテゴリの使用回数も送られている
    expect(server.tables.categories!.get(cat.id)?.use_count).toBe(1);
    // 支払い手段の初期値（前回と同じ）も設定として送られている
    expect(server.tables.settings!.get('u1')?.last_payment_method_id).toBe(t.payment_method_id);
  });

  it('通信エラー（fetch 失敗）でもキューは消えない', async () => {
    const d = await device(server, 'a');
    const bad = new SupabaseClient('https://x.supabase.co', 'pk', async () => { throw new TypeError('Failed to fetch'); });
    const syncer = new Syncer(d.db, bad, d.sessions, () => true);
    const st = await syncer.sync();
    expect(st.status).toBe('offline');
    expect(await d.db.count('outbox')).toBeGreaterThan(0);
  });

  it('別の端末でログインすると同じデータが取れる（差分取得）', async () => {
    const a = await device(server, 'a');
    const cat = a.store.quickCategories.find((c) => c.name === 'デート')!;
    await a.store.addTransaction({ amount: 1200, categoryId: cat.id, date: '2026-09-10' });
    await a.store.addTransaction({ amount: 800, categoryId: cat.id, date: '2026-09-11' });
    await a.syncer.sync();

    const b = await device(server, 'b');
    await b.syncer.sync();
    expect(b.store.liveTransactions.map((t) => t.amount).sort((x, y) => x - y)).toEqual([800, 1200]);
    expect(b.store.categories.find((c) => c.name === 'デート')?.use_count).toBe(2);
    // 2 回目の同期は差分なし（カーソルが進んでいる）
    const before = server.calls.length;
    await b.syncer.sync();
    const gets = server.calls.slice(before).filter((c) => c.method === 'GET');
    expect(gets.length).toBe(6); // テーブルごとに 1 回ずつ、いずれも空
    expect(b.store.liveTransactions).toHaveLength(2);
  });

  it('衝突は updated_at が新しい方を採用（両端末で同じカテゴリ名を変えた場合）', async () => {
    const a = await device(server, 'a');
    await a.syncer.sync();
    const b = await device(server, 'b');
    await b.syncer.sync();
    const id = a.store.categories.find((c) => c.name === 'カフェ')!.id;

    await a.store.updateCategory(id, { name: '喫茶' });
    await new Promise((r) => setTimeout(r, 5));
    await b.store.updateCategory(id, { name: 'コーヒー' }); // こちらが新しい
    await a.syncer.sync();
    await b.syncer.sync();
    await a.syncer.sync();
    expect(server.tables.categories!.get(id)?.name).toBe('コーヒー');
    expect(a.store.categories.find((c) => c.id === id)?.name).toBe('コーヒー');
    expect(b.store.categories.find((c) => c.id === id)?.name).toBe('コーヒー');
  });

  it('削除は論理削除として同期され、他端末でも消える', async () => {
    const a = await device(server, 'a');
    const cat = a.store.quickCategories[0]!;
    const t = await a.store.addTransaction({ amount: 500, categoryId: cat.id });
    await a.syncer.sync();
    const b = await device(server, 'b');
    await b.syncer.sync();
    expect(b.store.liveTransactions).toHaveLength(1);
    await a.store.deleteTransaction(t.id);
    await a.syncer.sync();
    await b.syncer.sync();
    expect(b.store.liveTransactions).toHaveLength(0);
    expect(b.store.transactions[0]?.deleted_at).toBeTruthy();
  });

  it('トークン期限切れ（401）なら更新して再試行する', async () => {
    const d = await device(server, 'a', makeSession('expired-token'));
    server.validToken = 'tok';
    const st = await d.syncer.sync();
    expect(st.status).toBe('idle');
    expect(d.sessions.value?.access_token).toBe('tok-refreshed');
  });

  it('期限が近いトークンは先に更新する', async () => {
    const d = await device(server, 'a', makeSession('tok', 10));
    const st = await d.syncer.sync();
    expect(st.status).toBe('idle');
    expect(server.calls[0]!.path).toContain('/auth/v1/token');
  });

  it('更新もできなければログアウト状態になり、データは端末に残る', async () => {
    const d = await device(server, 'a', makeSession('expired-token'));
    server.refreshOk = false;
    const cat = d.store.quickCategories[0]!;
    await d.store.addTransaction({ amount: 300, categoryId: cat.id });
    const st = await d.syncer.sync();
    expect(st.status).toBe('signed_out');
    expect(d.sessions.value).toBeNull();
    expect(d.store.liveTransactions).toHaveLength(1);
    expect(await d.db.count('outbox')).toBeGreaterThan(0);
  });

  it('未ログインなら何も送らない', async () => {
    const d = await device(server, 'a', null);
    const st = await d.syncer.sync();
    expect(st.status).toBe('signed_out');
    expect(server.calls).toHaveLength(0);
  });

  it('送信中にさらに変更された行はキューに残る', async () => {
    const d = await device(server, 'a');
    await d.syncer.sync();
    const cat = d.store.quickCategories[0]!;
    const t = await d.store.addTransaction({ amount: 100, categoryId: cat.id });
    // 送信の途中で同じ行を更新する
    const origFetch = server.fetch;
    let injected = false;
    server.fetch = async (input, init) => {
      const res = await origFetch(input, init);
      if (!injected && String(input).includes('/rest/v1/transactions') && init?.method === 'POST') {
        injected = true;
        await d.store.deleteTransaction(t.id);
      }
      return res;
    };
    const client = new SupabaseClient('https://x.supabase.co', 'pk', (i, n) => server.fetch(i, n));
    const syncer = new Syncer(d.db, client, d.sessions, () => true);
    await syncer.sync();
    const outbox = await d.db.getAll<{ key: string }>('outbox');
    expect(outbox.some((e) => e.key === `transactions:${t.id}`)).toBe(true);
  });

  it('normalizeRemoteRow はサーバー専用列を除き、時刻を ISO に揃える', () => {
    const r = normalizeRemoteRow({ id: '1', user_id: 'u', synced_at: 'x', updated_at: '2026-09-28T10:00:00.123+00:00', deleted_at: null });
    expect(r).toEqual({ id: '1', updated_at: '2026-09-28T10:00:00.123Z', deleted_at: null });
  });

  it('固定費のルールは別の端末で同時に計上しても二重にならない', async () => {
    const a = await device(server, 'a');
    const rent = a.store.categories.find((c) => c.name === '家賃')!;
    await a.store.saveRule({ name: '家賃', amount: 100000, type: 'expense', category_id: rent.id, payment_method_id: null, day_of_month: 27, needs_review: false });
    await a.syncer.sync();
    const b = await device(server, 'b');
    await b.syncer.sync(); // ルールを取り込み、b でも計上処理が走る
    await b.syncer.sync();
    await a.syncer.sync();
    const rentTx = [...server.tables.transactions!.values()].filter((t) => t.recurring_rule_id);
    expect(rentTx).toHaveLength(1);
    expect(b.store.liveTransactions.filter((t) => t.source === 'recurring')).toHaveLength(1);
  });
});
