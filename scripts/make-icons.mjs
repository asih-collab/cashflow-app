// アイコン PNG を生成する（Chromium で SVG を描画）。一度作ってコミットしておく。
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${pad ? 0 : 22}" fill="#1f6feb"/>
  <text x="50" y="66" font-family="-apple-system, 'Hiragino Sans', sans-serif" font-size="${pad ? 40 : 46}" font-weight="700" fill="#fff" text-anchor="middle">¥</text>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const [name, size, pad] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-512-maskable.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, pad)}</body></html>`);
  const buf = await page.locator('svg').screenshot({ omitBackground: true });
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), buf);
  console.log('wrote', name);
}
await browser.close();
