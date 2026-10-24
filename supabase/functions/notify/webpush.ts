// Web プッシュの送信（RFC 8291 の aes128gcm 暗号化 + RFC 8292 の VAPID 署名）。
// 外部ライブラリを使わず WebCrypto だけで書く（Supabase の Edge Function（Deno）と、Node のテストの両方で動く）。

export interface PushTarget {
  endpoint: string;
  /** ブラウザの公開鍵（base64url、65 バイト） */
  p256dh: string;
  /** 認証用の秘密（base64url、16 バイト） */
  auth: string;
}

export interface VapidKeys {
  /** 公開鍵（base64url、65 バイトの raw）。ブラウザの applicationServerKey と同じ値 */
  publicKey: string;
  /** 秘密鍵（JWK） */
  privateJwk: JsonWebKey;
  /** 連絡先（mailto: か https:）。プッシュサービスが問題を連絡する先 */
  subject: string;
}

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** 新しい VAPID の鍵を作る（最初の 1 回だけ使う） */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicKey: b64urlEncode(raw), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
}

/** VAPID の署名（ES256 の JWT）。aud はプッシュサービスのオリジン */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: keys.subject })));
  const key = await crypto.subtle.importKey('jwk', { ...keys.privateJwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`)));
  return `vapid t=${header}.${payload}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

/** 本文を aes128gcm で暗号化する（レコード 1 つ）。salt と送信側の鍵はテスト用に渡せる */
export async function encryptPayload(
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  payload: Uint8Array<ArrayBuffer>,
  opts: { salt?: Uint8Array<ArrayBuffer>; senderKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const sender = opts.senderKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export interface PushResult {
  status: number;
  /** 購読が無効になった（端末で通知を切った・アプリを消した）。DB から消してよい */
  gone: boolean;
  body?: string;
}

/** 1 台に送る */
export async function sendWebPush(target: PushTarget, message: unknown, keys: VapidKeys, fetchImpl: typeof fetch = fetch): Promise<PushResult> {
  const body = await encryptPayload(target, enc.encode(JSON.stringify(message)));
  const res = await fetchImpl(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(6 * 3600),
      Urgency: 'normal',
    },
    body,
  });
  const text = res.ok ? undefined : await res.text().catch(() => '');
  return { status: res.status, gone: res.status === 404 || res.status === 410, body: text };
}
