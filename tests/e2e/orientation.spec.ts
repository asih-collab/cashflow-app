import { test, expect } from '@playwright/test';
import { openApp } from './helpers';

test.describe('画面の向き', () => {
  test('縦向きでは普通に使え、横向きにすると画面は組み替えず「縦向きで使ってください」だけが出る', async ({ page }) => {
    await openApp(page, '#/');
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('rotate-lock')).toBeHidden();
    await page.setViewportSize({ width: 852, height: 393 }); // iPhone の横向き
    await expect(page.getByTestId('rotate-lock')).toBeVisible();
    await expect(page.getByTestId('rotate-lock')).toContainText('縦向きで使ってください');
    await expect(page.getByTestId('home')).toBeHidden();
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(page.getByTestId('rotate-lock')).toBeHidden();
    await expect(page.getByTestId('home')).toBeVisible();
  });
});
