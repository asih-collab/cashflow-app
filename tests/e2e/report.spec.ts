import { test, expect } from '@playwright/test';
import { openApp, tapDigits } from './helpers';

test.describe('月終わりのふり返りと来月の見通し', () => {
  test('期間が終わるとホームに知らせが出て、ふり返り・アドバイス・来月の見込みと予算の案が見られる。案で来月の予算を入れられる', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-20T12:00:00+09:00') });
    await openApp(page, '#/settings');
    await page.getByTestId('month-start-day').selectOption('25');
    // 期間 10/25〜11/24 の記録
    for (const [date, amount, cat] of [['2026-11-02', '30000', '外食'], ['2026-11-10', '20000', '外食'], ['2026-11-12', '8000', 'カフェ']] as const) {
      await page.goto(`./#/add?date=${date}`);
      await tapDigits(page, amount);
      await page.getByTestId(`cat-${cat}`).tap();
      await page.getByTestId('save').tap();
      await expect(page.getByTestId('home')).toBeVisible();
    }
    await expect(page.getByTestId('report-banner')).toHaveCount(0); // まだ期間の途中

    // 期間が終わった（次の期間の 2 日目）
    await page.clock.setFixedTime(new Date('2026-11-26T12:00:00+09:00'));
    await page.reload();
    await expect(page.getByTestId('report-banner')).toContainText('10/25〜11/24のふり返りと来月の見通しができました');
    await page.getByTestId('report-banner').tap();
    await expect(page.getByTestId('report')).toBeVisible();
    await expect(page.getByTestId('report-actual')).toContainText('¥58,000');
    await expect(page.getByTestId('report-tips').getByTestId('advice').first()).toBeVisible();
    await expect(page.getByTestId('report-tips')).toContainText('12 月は忘年会'); // 来月（11/25〜12/24）の季節の情報
    await expect(page.getByTestId('report-line-食費')).toContainText('案 ¥58,000');
    await page.getByTestId('report-apply-budget').tap();
    await expect(page.getByTestId('report-line-食費')).toContainText('¥58,000');
    await expect(page.getByTestId('report-apply-budget')).toHaveCount(0);

    // 一度開いたらホームの知らせは消える。サマリからはいつでも開ける
    await page.goto('./#/');
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('report-banner')).toHaveCount(0);
    await page.goto('./#/summary');
    await expect(page.getByTestId('report-link')).toContainText('10/25〜11/24のふり返り');
  });
});
