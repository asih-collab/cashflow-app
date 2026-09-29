// 自動操作テスト共通の土台。COVERAGE=1 のときは、ブラウザで実際に動いた JS の範囲を
// coverage-raw/ に書き出す（集計は scripts/e2e-coverage.mjs）。
import { test as base, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

export const test = base.extend<{ autoCoverage: void }>({
  autoCoverage: [
    async ({ page }, use, testInfo) => {
      const on = !!process.env.COVERAGE;
      if (on) await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await use();
      if (on) {
        const cov = (await page.coverage.stopJSCoverage()).filter((e) => e.url.includes('/assets/'));
        mkdirSync('coverage-raw', { recursive: true });
        writeFileSync(`coverage-raw/${testInfo.testId}.json`, JSON.stringify(cov));
      }
    },
    { auto: true },
  ],
});
export { expect };
