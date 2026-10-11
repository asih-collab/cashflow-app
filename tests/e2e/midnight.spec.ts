import { expect, test } from './fixtures';
import { tapDigits } from './helpers';

test.describe('日付をまたいだとき', () => {
  test('前日に開いた記録画面のまま翌日に保存しても、保存した日の日付で記録される', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-10T23:58:00+09:00') });
    await page.addInitScript(() => localStorage.setItem('cf.onboarded', '1'));
    await page.goto('./#/add');
    await expect(page.getByTestId('cat-デート')).toBeVisible();
    await tapDigits(page, '1500');
    await page.getByTestId('cat-外食').tap();
    // 日付が変わってから保存
    await page.clock.setSystemTime(new Date('2026-10-11T00:05:00+09:00'));
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('recent-row').first()).toContainText('10/11');
  });

  test('日付を自分で変えた場合は、その日付で記録される', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-10T23:58:00+09:00') });
    await page.addInitScript(() => localStorage.setItem('cf.onboarded', '1'));
    await page.goto('./#/add');
    await tapDigits(page, '800');
    await page.getByTestId('cat-カフェ').tap();
    await page.locator('details summary').tap();
    await page.getByTestId('date').fill('2026-10-08');
    await page.clock.setSystemTime(new Date('2026-10-11T00:05:00+09:00'));
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('recent-row').first()).toContainText('10/08');
  });

  test('アプリに戻ったとき日付が変わっていれば、ホームの「今日」が描き直される', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-10T22:00:00+09:00') });
    await page.addInitScript(() => localStorage.setItem('cf.onboarded', '1'));
    await page.goto('./#/');
    await expect(page.getByTestId('home')).toContainText('OCT 10');
    await page.clock.setSystemTime(new Date('2026-10-11T08:00:00+09:00'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByTestId('home')).toContainText('OCT 11');
  });
});
