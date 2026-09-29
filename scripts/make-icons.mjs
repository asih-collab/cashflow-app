// アイコン PNG を生成する（Chromium で SVG を描画）。一度作ってコミットしておく。
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

import { readFileSync } from 'node:fs';
const font = readFileSync(new URL('../public/fonts/Anton-Regular.woff2', import.meta.url)).toString('base64');
const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <style>@font-face{font-family:'A';src:url(data:font/woff2;base64,${font}) format('woff2');}</style>
    <radialGradient id="g" cx="78%" cy="85%" r="75%"><stop offset="0" stop-color="#ff5b24" stop-opacity="0.55"/><stop offset="1" stop-color="#ff5b24" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100" height="100" rx="${pad ? 0 : 22}" fill="#0a0a0b"/>
  <rect width="100" height="100" rx="${pad ? 0 : 22}" fill="url(#g)"/>
  <text x="50" y="${pad ? 70 : 74}" font-family="'A', Impact, sans-serif" font-size="${pad ? 54 : 64}" fill="#f3f0e9" text-anchor="middle">¥</text>
  <rect x="${pad ? 30 : 26}" y="${pad ? 78 : 82}" width="${pad ? 40 : 48}" height="3" fill="#ff5b24"/>
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
