import { expect, test } from './fixtures';
import { openApp, tapDigits } from './helpers';

test.describe('クイック記録（F01）とホーム（F02）', () => {
  test('起動すると記録画面が出て、金額 → カテゴリ → 保存 の 3 ステップで記録できる', async ({ page }) => {
    const t0 = Date.now();
    await openApp(page);
    await expect(page.getByTestId('add')).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(3000); // ローカル環境の目安（実機は Service Worker で 1 秒以内を狙う）

    await tapDigits(page, '1200'); // 1. 金額
    await expect(page.getByTestId('amount')).toHaveText('¥1,200');
    await page.getByTestId('cat-デート').tap(); // 2. カテゴリ
    await expect(page.getByTestId('save')).toHaveText('デート ¥1,200 を保存');
    await page.getByTestId('save').tap(); // 3. 保存

    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('デート ¥1,200 を記録');
    await expect(page.getByTestId('variable-total')).toHaveText('¥1,200');
    await expect(page.getByTestId('breakdown-row').first()).toContainText('デート');
    await expect(page.getByTestId('breakdown-row').first()).toContainText('¥1,200');
  });

  test('初期の並びはデート・外食・食料品…で、使うと並びが変わる', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('cat-デート')).toBeVisible();
    const names = await page.getByTestId('categories').locator('button').allTextContents();
    expect(names.slice(0, 5)).toEqual(['デート', '外食', '食料品', 'コンビニ', 'カフェ']);

    for (let i = 0; i < 2; i++) {
      await page.goto('./#/add');
      await tapDigits(page, '500');
      await page.getByTestId('cat-コンビニ').tap();
      await page.getByTestId('save').tap();
      await expect(page.getByTestId('home')).toBeVisible();
    }
    await page.goto('./#/add');
    await expect(page.getByTestId('cat-デート')).toBeVisible();
    const after = await page.getByTestId('categories').locator('button').allTextContents();
    expect(after[0]).toBe('コンビニ');
  });

  test('記録は開き直しても消えない（IndexedDB）。取り消しと削除もできる', async ({ page }) => {
    await openApp(page);
    await tapDigits(page, '3000');
    await page.getByTestId('cat-外食').tap();
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('variable-total')).toHaveText('¥3,000');

    await page.reload();
    await page.goto('./#/');
    await expect(page.getByTestId('variable-total')).toHaveText('¥3,000');

    // 2 件目を取り消す
    await page.goto('./#/add');
    await tapDigits(page, '800');
    await page.getByTestId('cat-カフェ').tap();
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('variable-total')).toHaveText('¥3,800');
    await page.getByTestId('toast').getByRole('button', { name: '取り消す' }).tap();
    await expect(page.getByTestId('variable-total')).toHaveText('¥3,000');

    // 最近の記録から削除
    await page.getByTestId('recent-row').first().getByRole('button', { name: '削除' }).tap();
    await expect(page.getByTestId('variable-total')).toHaveText('¥0');
  });

  test('「その他…」から全カテゴリを選べる。0 円やカテゴリ未選択では保存できない', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('save')).toBeDisabled();
    await tapDigits(page, '00');
    await expect(page.getByTestId('amount')).toHaveText('¥0');
    await tapDigits(page, '250');
    await expect(page.getByTestId('save')).toBeDisabled();
    await page.getByTestId('cat-more').tap();
    await page.getByTestId('all-cat-美容院').tap();
    await expect(page.getByTestId('save')).toBeEnabled();
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('breakdown-row').first()).toContainText('美容院');
  });

  test('詳細を開いて日付と支払い手段を変えられ、次回は前回の支払い手段が初期値になる', async ({ page }) => {
    await openApp(page);
    await tapDigits(page, '1500');
    await page.getByTestId('cat-デート').tap();
    await page.locator('details summary').tap();
    await page.getByTestId('date').fill('2020-01-15'); // 期間外の日付
    await page.getByTestId('payment-method').selectOption({ label: 'PayPay' });
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('variable-total')).toHaveText('¥0'); // 今月ではないので合計に入らない
    await page.goto('./#/add');
    await expect(page.getByTestId('payment-method')).toHaveValue(/.+/);
    const selected = await page.getByTestId('payment-method').locator('option:checked').textContent();
    expect(selected).toBe('PayPay');
  });

  test('ショートカット用の URL（#/add?amount=1200&cat=デート）で値が入る', async ({ page }) => {
    await openApp(page, '#/add?amount=1200&cat=デート');
    await expect(page.getByTestId('amount')).toHaveText('¥1,200');
    await expect(page.getByTestId('save')).toHaveText('デート ¥1,200 を保存');
  });

  test('「カテゴリを選んだらすぐ保存」を有効にすると 2 タップで記録できる', async ({ page }) => {
    await openApp(page, '#/settings');
    await page.getByTestId('save-on-tap').check();
    await page.goto('./#/add');
    await tapDigits(page, '900');
    await page.getByTestId('cat-外食').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('variable-total')).toHaveText('¥900');
  });

  test('初回起動ではホーム画面追加とログインの案内が出る', async ({ page }) => {
    await openApp(page, '', { onboarded: false });
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await expect(page.getByTestId('onboarding')).toContainText('ホーム画面に追加');
    await page.getByTestId('onboard-skip').tap();
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
    await expect(page.getByTestId('add')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
  });

  test('収入に切り替えて記録でき、ホームに収入として出る（変動費には入らない）', async ({ page }) => {
    await openApp(page, '#/add');
    await page.getByTestId('mode-income').tap();
    await expect(page.getByTestId('cat-給与')).toBeVisible();
    await expect(page.getByTestId('cat-デート')).toHaveCount(0);
    await tapDigits(page, '300000');
    await page.getByTestId('cat-給与').tap();
    await expect(page.getByTestId('save')).toHaveText('給与 +¥300,000 を保存');
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('収入として記録');
    await expect(page.getByTestId('income-total')).toHaveText('+¥300,000');
    await expect(page.getByTestId('variable-total')).toHaveText('¥0');
    await expect(page.getByTestId('recent-row').first()).toContainText('+¥300,000');
    // 次に開いたときは支出に戻っている
    await page.goto('./#/add');
    await expect(page.getByTestId('cat-デート')).toBeVisible();
  });

  test('支出と収入を切り替えると、選んでいたカテゴリは外れる', async ({ page }) => {
    await openApp(page, '#/add');
    await tapDigits(page, '500');
    await page.getByTestId('cat-デート').tap();
    await page.getByTestId('mode-income').tap();
    await expect(page.getByTestId('save')).toBeDisabled();
    await page.getByTestId('mode-expense').tap();
    await expect(page.getByTestId('cat-デート')).toHaveAttribute('aria-pressed', 'false');
  });
});
