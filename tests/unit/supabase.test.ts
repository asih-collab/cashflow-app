import { describe, expect, it } from 'vitest';
import { SupabaseClient, SupabaseError, decodeJwt, isExpiringSoon } from '../../src/lib/supabase';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.sig`;
}

describe('SupabaseClient', () => {
  it('sendCode は /auth/v1/otp に apikey 付きで POST する', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const c = new SupabaseClient('https://x.supabase.co', 'pk', async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response('{}', { status: 200 });
    });
    await c.sendCode('a@example.com', 'https://app/');
    expect(calls[0]!.url).toBe('https://x.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fapp%2F');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.apikey).toBe('pk');
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ email: 'a@example.com', create_user: true });
  });
  it('verifyCode はセッションを返す', async () => {
    const token = jwt({ sub: 'u1', email: 'a@example.com', exp: 9999999999 });
    const c = new SupabaseClient('https://x.supabase.co', 'pk', async () =>
      new Response(JSON.stringify({ access_token: token, refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email: 'a@example.com' } })));
    const s = await c.verifyCode('a@example.com', ' 123456 ');
    expect(s.user).toEqual({ id: 'u1', email: 'a@example.com' });
    expect(s.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(isExpiringSoon(s)).toBe(false);
  });
  it('エラーは SupabaseError（status とメッセージ）', async () => {
    const c = new SupabaseClient('https://x.supabase.co', 'pk', async () =>
      new Response(JSON.stringify({ code: 429, msg: 'email rate limit exceeded' }), { status: 429 }));
    await expect(c.sendCode('a@example.com', '')).rejects.toMatchObject({ status: 429, message: 'email rate limit exceeded' });
    await expect(c.sendCode('a@example.com', '')).rejects.toBeInstanceOf(SupabaseError);
  });
  it('マジックリンクの URL ハッシュからセッションを作る', () => {
    const token = jwt({ sub: 'u1', email: 'a@example.com' });
    const s = SupabaseClient.sessionFromHash(`#access_token=${token}&refresh_token=rt&expires_in=3600&token_type=bearer&type=magiclink`);
    expect(s?.user).toEqual({ id: 'u1', email: 'a@example.com' });
    expect(s?.refresh_token).toBe('rt');
    expect(SupabaseClient.sessionFromHash('#/add')).toBeNull();
  });
  it('select はクエリを付け、upsert は merge-duplicates を指定する', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const c = new SupabaseClient('https://x.supabase.co', 'pk', async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response(init?.method === 'GET' ? '[{"id":"1"}]' : '', { status: init?.method === 'GET' ? 200 : 201 });
    });
    expect(await c.select('transactions', 'select=*', 'tok')).toEqual([{ id: '1' }]);
    await c.upsert('transactions', [{ id: '1' }], 'id', 'tok');
    expect(calls[1]!.url).toBe('https://x.supabase.co/rest/v1/transactions?on_conflict=id');
    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(headers.Prefer).toContain('merge-duplicates');
    expect(headers.Authorization).toBe('Bearer tok');
  });
  it('decodeJwt は壊れたトークンで空を返す', () => {
    expect(decodeJwt('x')).toEqual({});
  });
});
