import { expect, type Page, type Route } from '@playwright/test';

export const SUPABASE = 'https://supabase.test';

/** オンボーディングを済ませた状態で開く */
export async function openApp(page: Page, hash = '', opts: { onboarded?: boolean } = {}): Promise<void> {
  await page.addInitScript((onboarded) => {
    if (onboarded) localStorage.setItem('cf.onboarded', '1');
  }, opts.onboarded ?? true);
  await page.goto(`./${hash}`);
}

export async function tapDigits(page: Page, digits: string): Promise<void> {
  for (const d of digits) await page.getByTestId('keypad').locator(`[data-key="${d}"]`).tap();
}

function jwt(payload: Record<string, unknown>): string {
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.sig`;
}
export const TEST_JWT = jwt({ sub: 'u1', email: 'me@example.com', exp: 9999999999 });

export interface FakeBackend {
  tables: Record<string, Map<string, Record<string, unknown>>>;
  requests: { method: string; path: string; body?: unknown }[];
  otpSent: string[];
}

/** Supabase のフェイク（page.route）。認証と REST の最小限 */
export async function mockSupabase(page: Page): Promise<FakeBackend> {
  const be: FakeBackend = { tables: { categories: new Map(), payment_methods: new Map(), transactions: new Map(), settings: new Map() }, requests: [], otpSent: [] };
  let clock = Date.parse('2026-09-28T10:00:00Z');
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    be.requests.push({ method, path: url.pathname + url.search, body });
    const json = (status: number, data: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.pathname === '/auth/v1/otp') { be.otpSent.push(body.email); return json(200, {}); }
    if (url.pathname === '/auth/v1/verify') {
      if (body.token !== '123456') return json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      return json(200, { access_token: TEST_JWT, refresh_token: 'rt', expires_in: 3600, token_type: 'bearer', user: { id: 'u1', email: body.email } });
    }
    if (url.pathname === '/auth/v1/logout') return json(204, {});
    if (url.pathname === '/auth/v1/token') {
      if (body.refresh_token !== 'rt') return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      return json(200, { access_token: TEST_JWT, refresh_token: 'rt', expires_in: 3600, token_type: 'bearer', user: { id: 'u1', email: 'me@example.com' } });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (req.headers()['authorization'] !== `Bearer ${TEST_JWT}`) return json(401, { message: 'JWT expired' });
      const table = url.pathname.slice('/rest/v1/'.length);
      const t = be.tables[table]!;
      if (method === 'POST') {
        const key = url.searchParams.get('on_conflict') ?? 'id';
        clock += 1000;
        const synced = new Date(clock).toISOString();
        for (const row of body as Record<string, unknown>[]) {
          const k = key === 'user_id' ? 'u1' : String(row['id']);
          t.set(k, { ...t.get(k), ...row, user_id: 'u1', synced_at: synced });
        }
        return route.fulfill({ status: 201, body: '', headers: { 'access-control-allow-origin': '*' } });
      }
      const gt = url.searchParams.get('synced_at')?.replace('gt.', '') ?? '';
      const rows = [...t.values()].filter((r) => String(r.synced_at) > gt);
      return json(200, rows);
    }
    return json(404, { message: 'not found' });
  };
  await page.route(`${SUPABASE}/**`, handler);
  return be;
}

export async function loginViaCode(page: Page): Promise<void> {
  await page.goto('./#/login');
  await page.getByTestId('email').fill('me@example.com');
  await page.getByTestId('send-code').tap();
  await expect(page.getByTestId('step2')).toBeVisible();
  await page.getByTestId('code').fill('123456');
  await expect(page.getByTestId('home')).toBeVisible();
}
