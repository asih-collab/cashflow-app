import { defineConfig, devices } from '@playwright/test';

// iPhone サイズのビューポートで主要操作を確認する。WebKit は環境に無いため Chromium で iPhone の画面サイズ・UA を再現する。
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/cashflow-app/',
    trace: 'retain-on-failure',
    ...devices['iPhone 14'],
    browserName: 'chromium',
    defaultBrowserType: 'chromium',
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort --mode e2e',
    url: 'http://127.0.0.1:4173/cashflow-app/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
