import { expect, test } from './fixtures';
import { loginViaCode, mockSupabase, openApp, tapDigits } from './helpers';

test.describe('ログイン（F10）と同期', () => {
  test('メールのコードでログインでき、記録が Supabase に送られる', async ({ page }) => {
    const be = await mockSupabase(page);
    await openApp(page);
    await loginViaCode(page);
    expect(be.otpSent).toEqual(['me@example.com']);
    await expect(page.getByTestId('sync-status')).toContainText('同期済み');
    await expect.poll(() => be.tables.categories!.size).toBeGreaterThan(10);

    await page.goto('./#/add');
    await tapDigits(page, '1200');
    await page.getByTestId('cat-デート').tap();
    await page.getByTestId('save').tap();
    await expect.poll(() => [...be.tables.transactions!.values()].map((t) => t.amount)).toEqual([1200]);

    await page.goto('./#/settings');
    await expect(page.getByTestId('account-email')).toHaveText('me@example.com');
  });

  test('コードが違うとエラーになる', async ({ page }) => {
    await mockSupabase(page);
    await openApp(page, '#/login');
    await page.getByTestId('email').fill('me@example.com');
    await page.getByTestId('send-code').tap();
    await page.getByTestId('code').fill('999999');
    await expect(page.getByTestId('login-message')).toContainText('コードが違うか、期限切れです');
  });

  test('オフラインで記録しても消えず、復帰後に送られる', async ({ page, context }) => {
    const be = await mockSupabase(page);
    await openApp(page);
    await loginViaCode(page);
    await expect(page.getByTestId('sync-status')).toContainText('同期済み');

    await context.setOffline(true);
    await page.goto('./#/add');
    await tapDigits(page, '2500');
    await page.getByTestId('cat-外食').tap();
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('variable-total')).toHaveText('¥2,500');
    await expect(page.getByTestId('sync-status')).toContainText('未送信 ');
    expect(be.tables.transactions!.size).toBe(0);

    await context.setOffline(false);
    await expect.poll(() => be.tables.transactions!.size, { timeout: 10_000 }).toBe(1);
    await expect(page.getByTestId('sync-status')).toContainText('同期済み');
    await expect(page.getByTestId('sync-status')).not.toContainText('未送信');
  });

  test('マジックリンクの URL で開いてもログインできる（iPhone 以外や、ホーム画面に追加したアプリ）', async ({ page }) => {
    await mockSupabase(page);
    const { TEST_JWT } = await import('./helpers');
    await page.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
    await openApp(page, `#access_token=${TEST_JWT}&refresh_token=rt&expires_in=3600&token_type=bearer&type=magiclink`);
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('sync-status')).toContainText('同期済み');
  });

  test('iPhone の Safari でマジックリンクを開くと引き継ぎ画面が出て、貼り付けでホーム画面アプリにログインできる', async ({ page, context }) => {
    await mockSupabase(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { TEST_JWT } = await import('./helpers');
    // Safari（ホーム画面に追加していない）で着地
    await openApp(page, `#access_token=${TEST_JWT}&refresh_token=rt&expires_in=3600&token_type=bearer&type=magiclink`);
    await expect(page.getByTestId('handoff')).toBeVisible();
    await page.getByTestId('copy-handoff').tap();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.startsWith('cf1.')).toBe(true);
    // Safari 側にはまだログインが保存されていない
    expect(await page.evaluate(() => localStorage.getItem('cf.session'))).toBeNull();

    // ホーム画面のアプリ側（保存領域が別）で貼り付け
    const p2 = await context.newPage();
    await p2.addInitScript(() => localStorage.setItem('cf.onboarded', '1'));
    await mockSupabase(p2);
    await p2.goto('./#/login');
    await p2.getByTestId('email').fill('me@example.com');
    await p2.getByTestId('send-code').tap();
    await p2.getByTestId('step2').locator('summary').tap();
    await p2.getByTestId('handoff-input').fill(copied);
    await p2.getByTestId('handoff-login').tap();
    await expect(p2.getByTestId('home')).toBeVisible();
    await expect(p2.getByTestId('sync-status')).toContainText('同期済み');
  });

  test('引き継ぎ画面で「このまま Safari で使う」を選ぶとその場でログインする', async ({ page }) => {
    await mockSupabase(page);
    const { TEST_JWT } = await import('./helpers');
    await openApp(page, `#access_token=${TEST_JWT}&refresh_token=rt&expires_in=3600&token_type=bearer&type=magiclink`);
    await page.getByTestId('use-here').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('sync-status')).toContainText('同期済み');
  });

  test('貼り付けた内容が違うとエラーになる', async ({ page }) => {
    await mockSupabase(page);
    await openApp(page, '#/login');
    await page.getByTestId('email').fill('me@example.com');
    await page.getByTestId('send-code').tap();
    await page.getByTestId('step2').locator('summary').tap();
    await page.getByTestId('handoff-input').fill('てきとう');
    await page.getByTestId('handoff-login').tap();
    await expect(page.getByTestId('login-message')).toContainText('違うようです');
  });

  test('別の端末（新しいプロファイル）でログインすると同じ記録が見える', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const be = await mockSupabase(p1);
    await openApp(p1);
    await loginViaCode(p1);
    await p1.goto('./#/add');
    await tapDigits(p1, '4000');
    await p1.getByTestId('cat-デート').tap();
    await p1.getByTestId('save').tap();
    await expect.poll(() => be.tables.transactions!.size).toBe(1);
    await ctx1.close();

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    // 同じフェイクのデータを使う
    await p2.route('https://supabase.test/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const json = (status: number, data: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (url.pathname === '/auth/v1/otp') return json(200, {});
      if (url.pathname === '/auth/v1/verify') {
        const { TEST_JWT } = await import('./helpers');
        return json(200, { access_token: TEST_JWT, refresh_token: 'rt', expires_in: 3600, user: { id: 'u1', email: 'me@example.com' } });
      }
      if (req.method() === 'POST') return route.fulfill({ status: 201, body: '', headers: { 'access-control-allow-origin': '*' } });
      const table = url.pathname.slice('/rest/v1/'.length);
      const gt = url.searchParams.get('synced_at')?.replace('gt.', '') ?? '';
      return json(200, [...be.tables[table]!.values()].filter((r) => String(r.synced_at) > gt));
    });
    await openApp(p2);
    await loginViaCode(p2);
    await expect(p2.getByTestId('variable-total')).toHaveText('¥4,000');
    await ctx2.close();
  });
});
