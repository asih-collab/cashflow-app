// 通知（F09 の C・E）の端末側: 通知の許可 → 購読（Push API）→ Supabase に端末を登録。
// 実際の送信は Supabase の Edge Function `notify`（supabase/functions/notify）が毎日決まった時刻に行う。
// iPhone はホーム画面に追加したアプリでだけ通知を受け取れる（iOS 16.4 以降）。

import type { SupabaseClient } from './supabase';
import type { Syncer } from './sync';

export type PushSupport = 'ok' | 'needs-install' | 'unsupported';

export interface PushPrefs {
  reminder: boolean;
  review: boolean;
}

interface SubRow extends PushPrefs {
  endpoint: string;
}

export function pushSupport(standalone: boolean, ios: boolean): PushSupport {
  const hasApi = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (ios && !standalone) return 'needs-install';
  return hasApi ? 'ok' : 'unsupported';
}

export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('アプリの準備ができていません。いったん閉じて開き直してください');
  return reg;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker?.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** この端末の設定（サーバーにある行）。未登録なら null */
export async function loadPrefs(client: SupabaseClient, syncer: Syncer): Promise<PushPrefs | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const rows = await syncer.withAuth((t) => client.select<SubRow>('push_subscriptions', `select=endpoint,reminder,review&endpoint=eq.${encodeURIComponent(sub.endpoint)}`, t));
  return rows[0] ? { reminder: rows[0].reminder, review: rows[0].review } : null;
}

/** 通知をオンにする（許可を求め、購読し、サーバーに登録） */
export async function enablePush(client: SupabaseClient, syncer: Syncer, prefs: PushPrefs = { reminder: true, review: true }): Promise<PushPrefs> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? '通知が許可されていません。iPhone の「設定」→「通知」→「家計」で許可してください' : '通知の許可がまだです');
  const key = await syncer.withAuth((t) => client.rpc<string | null>('push_public_key', {}, t));
  if (!key) throw new Error('通知の準備（サーバー側）ができていません');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // 鍵が変わっていたら購読し直す
  const appKey = base64UrlToBytes(key);
  const curKey = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && curKey && curKey.join(',') !== appKey.join(',')) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  const j = sub.toJSON();
  await syncer.withAuth((t) => client.upsert('push_subscriptions', [{
    endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, reminder: prefs.reminder, review: prefs.review, updated_at: new Date().toISOString(),
  }], 'user_id,endpoint', t));
  return prefs;
}

export async function savePrefs(client: SupabaseClient, syncer: Syncer, prefs: PushPrefs): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const j = sub.toJSON();
  await syncer.withAuth((t) => client.upsert('push_subscriptions', [{
    endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, reminder: prefs.reminder, review: prefs.review, updated_at: new Date().toISOString(),
  }], 'user_id,endpoint', t));
}

export async function disablePush(client: SupabaseClient, syncer: Syncer): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await syncer.withAuth((t) => client.remove('push_subscriptions', `endpoint=eq.${encodeURIComponent(sub.endpoint)}`, t)).catch(() => {});
  await sub.unsubscribe();
}

export interface TestResult { sent: number; errors?: string[] }

export async function sendTestPush(client: SupabaseClient, syncer: Syncer): Promise<TestResult> {
  return syncer.withAuth((t) => client.invoke<TestResult>('notify', { kind: 'test' }, t));
}
