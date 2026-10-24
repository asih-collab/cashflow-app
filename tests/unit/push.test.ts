import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, concat, encryptPayload, generateVapidKeys, sendWebPush, vapidAuthorization } from '../../supabase/functions/notify/webpush';
import { isLastDayOfPeriod, jstDate, messageFor, usersToNotify } from '../../supabase/functions/notify/logic';
import { periodFor } from '../../src/lib/period';

const enc = new TextEncoder();

/** ブラウザ側の受け取り（RFC 8291 の復号）をテストのために再現する */
async function makeBrowser() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const hkdf = async (salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  async function decrypt(body: Uint8Array<ArrayBuffer>): Promise<string> {
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
    expect(rs).toBe(4096);
    const idlen = body[20]!;
    const asPublic = body.slice(21, 21 + idlen);
    const cipher = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, kp.privateKey, 256));
    const ikm = await hkdf(auth, secret, concat(enc.encode('WebPush: info\0'), pub, asPublic), 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
    expect(plain[plain.length - 1]).toBe(2); // 最後のレコードの区切り
    return new TextDecoder().decode(plain.slice(0, -1));
  }
  return { p256dh: b64urlEncode(pub), auth: b64urlEncode(auth), decrypt };
}

describe('Web プッシュの暗号化（RFC 8291）と署名（RFC 8292）', () => {
  it('base64url の往復', () => {
    const b = crypto.getRandomValues(new Uint8Array(33));
    expect(b64urlDecode(b64urlEncode(b))).toEqual(b);
    expect(b64urlEncode(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('暗号化した本文をブラウザ側の鍵で復号すると元に戻る', async () => {
    const br = await makeBrowser();
    const body = await encryptPayload(br, enc.encode('{"title":"テスト"}'));
    expect(await br.decrypt(body)).toBe('{"title":"テスト"}');
  });

  it('VAPID の JWT は公開鍵で検証でき、aud はプッシュサービスのオリジン', async () => {
    const k = await generateVapidKeys();
    expect(b64urlDecode(k.publicKey)).toHaveLength(65);
    const h = await vapidAuthorization('https://web.push.apple.com/abc/def', { ...k, subject: 'https://example.com/' }, 1_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(k.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2]!)));
    expect(claims).toEqual({ aud: 'https://web.push.apple.com', exp: 1_000_000 + 12 * 3600, sub: 'https://example.com/' });
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(k.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(m[3]!), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });

  it('送信: ヘッダーが揃い、410 なら購読を消してよいと返す', async () => {
    const br = await makeBrowser();
    const k = await generateVapidKeys();
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response('', { status: seen.length === 1 ? 201 : 410 });
    }) as unknown as typeof fetch;
    const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', ...br };
    expect(await sendWebPush(target, { title: 'a' }, { ...k, subject: 'https://example.com/' }, fake)).toMatchObject({ status: 201, gone: false });
    expect(await sendWebPush(target, { title: 'a' }, { ...k, subject: 'https://example.com/' }, fake)).toMatchObject({ status: 410, gone: true });
    const hd = seen[0]!.init.headers as Record<string, string>;
    expect(hd['Content-Encoding']).toBe('aes128gcm');
    expect(hd.TTL).toBeTruthy();
    expect(hd.Authorization).toMatch(/^vapid t=/);
    expect(JSON.parse(await br.decrypt(seen[0]!.init.body as Uint8Array<ArrayBuffer>))).toEqual({ title: 'a' });
  });
});

describe('通知の判定（日本時間）', () => {
  it('日本時間の日付: UTC 15:00 は翌日', () => {
    expect(jstDate(new Date('2026-10-24T14:59:00Z'))).toBe('2026-10-24');
    expect(jstDate(new Date('2026-10-24T15:00:00Z'))).toBe('2026-10-25');
  });
  it('予算期間の最終日はアプリの期間の区切りと一致する', () => {
    for (const sd of [1, 10, 25, 28]) {
      for (let i = 0; i < 400; i++) {
        const d = new Date(2026, 0, 1 + i);
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        expect(isLastDayOfPeriod(date, sd), `${date} sd=${sd}`).toBe(periodFor(d, sd).end === date);
      }
    }
  });
  it('リマインドは今日の手入力が 0 件の人だけ、振り返りは期間の最終日の人だけ', () => {
    const c = [
      { user_id: 'a', manualCount: 0, monthStartDay: 25 },
      { user_id: 'b', manualCount: 3, monthStartDay: 1 },
    ];
    expect(usersToNotify('reminder', '2026-10-24', c)).toEqual(['a']);
    expect(usersToNotify('review', '2026-10-24', c)).toEqual(['a']);
    expect(usersToNotify('review', '2026-10-31', c)).toEqual(['b']);
    expect(usersToNotify('test', '2026-10-31', c)).toEqual(['a', 'b']);
  });
  it('通知の文面と開く画面', () => {
    expect(messageFor('reminder').url).toBe('#/add');
    expect(messageFor('review').url).toBe('#/summary');
  });
});
