import { expect, test } from './fixtures';
import { openApp, tapDigits } from './helpers';

test.describe('設定とカテゴリ管理（F04）', () => {
  test('カテゴリの名前を変えられ、非表示にすると記録画面から消える', async ({ page }) => {
    await openApp(page, '#/categories');
    page.once('dialog', (d) => d.accept('喫茶店'));
    await page.getByTestId('edit-カフェ').tap();
    await expect(page.getByTestId('edit-喫茶店')).toBeVisible();

    await page.getByTestId('toggle-飲み会').tap();
    await expect(page.getByTestId('edit-飲み会')).toContainText('非表示');

    page.once('dialog', (d) => d.accept('ランチ'));
    await page.getByTestId('add-under-食費').tap();
    await expect(page.getByTestId('edit-ランチ')).toBeVisible();

    await page.goto('./#/add');
    await expect(page.getByTestId('cat-喫茶店')).toBeVisible();
    await expect(page.getByTestId('cat-飲み会')).toHaveCount(0);
  });

  test('「今月」の始まりの日を給料日基準にできる', async ({ page }) => {
    await openApp(page, '#/settings');
    await page.getByTestId('month-start-day').selectOption('25');
    await page.goto('./#/');
    await expect(page.getByTestId('period-label')).toContainText('〜');
  });

  test('開いたときの画面をホームにできる', async ({ page }) => {
    await openApp(page, '#/settings');
    await page.getByTestId('start-screen').selectOption('home');
    await page.goto('./');
    await page.reload();
    await expect(page.getByTestId('home')).toBeVisible();
  });

  test('支払い手段を追加・名前変更できる', async ({ page }) => {
    await openApp(page, '#/settings');
    page.once('dialog', (d) => d.accept('楽天カード'));
    await page.getByTestId('add-pm').tap();
    await expect(page.getByTestId('pm-楽天カード')).toBeVisible();
    page.once('dialog', (d) => d.accept('メインカード'));
    await page.getByTestId('pm-クレジットカード').tap();
    await expect(page.getByTestId('pm-メインカード')).toBeVisible();
    await page.goto('./#/add');
    await tapDigits(page, '1');
    const options = await page.getByTestId('payment-method').locator('option').allTextContents();
    expect(options).toContain('楽天カード');
    expect(options).toContain('メインカード');
  });
});
