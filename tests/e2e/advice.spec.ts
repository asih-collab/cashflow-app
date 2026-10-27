import { expect, test } from './fixtures';
import { openApp, tapDigits } from './helpers';

async function record(page: import('@playwright/test').Page, amount: string, cat: string, income = false) {
  await page.goto('./#/add');
  await expect(page.getByTestId('cat-デート')).toBeVisible();
  if (income) await page.getByTestId('mode-income').tap();
  await tapDigits(page, amount);
  await page.getByTestId(`cat-${cat}`).tap();
  await page.getByTestId('save').tap();
  await expect(page.getByTestId('home')).toBeVisible();
}

test.describe('改善アドバイス（F23）', () => {
  test('赤字の見込みが出たらホームの「今月の気づき」に出て、サマリには全部出る。役に立った / 立たないを押せる', async ({ page }) => {
    // 暦月（1 日始まり）の 11/10。10 日で 9 万円 → 月末の見込み 27 万円、収入 10 万円 → 赤字の見込み
    await page.clock.install({ time: new Date('2026-11-10T12:00:00+09:00') });
    await openApp(page, '#/');
    await record(page, '100000', '給与', true);
    await record(page, '90000', '外食');

    const home = page.getByTestId('home-advice');
    await expect(home.getByTestId('advice').first()).toContainText('赤字');
    await expect(home.getByTestId('advice').first()).toHaveAttribute('data-rule', 'deficit_forecast');

    await page.goto('./#/summary');
    const list = page.getByTestId('sum-advice');
    const first = list.getByTestId('advice').first();
    await first.getByTestId('advice-yes').tap();
    await expect(first.getByTestId('advice-yes')).toHaveAttribute('aria-pressed', 'true');
    // 押し直すと上書き（1 件のまま）
    await first.getByTestId('advice-no').tap();
    await expect(first.getByTestId('advice-no')).toHaveClass(/on/);
    const saved = await page.evaluate(() => new Promise<number>((resolve) => {
      const req = indexedDB.open('cashflow');
      req.onsuccess = () => {
        const r = req.result.transaction('advice_feedback').objectStore('advice_feedback').getAll();
        r.onsuccess = () => resolve((r.result as { useful: boolean }[]).filter((x) => x.useful === false).length * 10 + r.result.length);
      };
    }));
    expect(saved).toBe(11); // 1 件だけ、「立たない」
  });

  test('記録が少ない月初は何も出さない（サマリには「特にない」）', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-01T12:00:00+09:00') });
    await openApp(page, '#/');
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('home-advice')).toHaveCount(0);
    await page.goto('./#/summary');
    await expect(page.getByTestId('sum-advice')).toContainText('特に気になる点はありません');
  });

  test('今日の気づき: 予算があればホームの上に「今日使えるのはあと◯円」が出て、使いすぎると注意に変わる', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-10T12:00:00+09:00') });
    await openApp(page, '#/budget');
    await page.getByTestId('budget-食費').fill('63000'); // 暦月 30 日、今日を含めて残り 21 日 → 1 日 3,000 円
    await page.getByTestId('budget-食費').blur();
    await page.goto('./#/');
    const daily = page.getByTestId('home-daily');
    await expect(daily.getByTestId('advice').first()).toContainText('今日使えるのは、あと ¥3,000');
    await record(page, '5000', '外食');
    await expect(page.getByTestId('home-daily').getByTestId('advice').first()).toContainText('目安を ¥2,000 超えています');
    await expect(page.getByTestId('home-daily').getByTestId('advice').first()).toHaveAttribute('data-rule', 'daily_allowance');
  });
});

