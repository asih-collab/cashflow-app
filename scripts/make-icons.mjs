// アイコン PNG を生成する（Chromium で SVG を描画）。一度作ってコミットしておく。
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

import { readFileSync } from 'node:fs';
const font = readFileSync(new URL('../public/fonts/InstrumentSerif-Regular.woff2', import.meta.url)).toString('base64');
const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <style>@font-face{font-family:'IS';src:url(data:font/woff2;base64,${font}) format('woff2');}</style>
    <radialGradient id="g" cx="30%" cy="20%" r="90%"><stop offset="0" stop-color="#3a4a5a"/><stop offset="1" stop-color="#17181c"/></radialGradient>
    <radialGradient id="a" cx="75%" cy="80%" r="50%"><stop offset="0" stop-color="#b9673f" stop-opacity="0.8"/><stop offset="1" stop-color="#b9673f" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100" height="100" rx="${pad ? 0 : 22}" fill="url(#g)"/>
  <rect width="100" height="100" rx="${pad ? 0 : 22}" fill="url(#a)"/>
  <ellipse cx="52" cy="50" rx="44" ry="18" transform="rotate(-24 52 50)" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="0.8"/>
  <text x="50" y="${pad ? 68 : 70}" font-family="'IS', 'Hiragino Mincho ProN', Georgia, serif" font-size="${pad ? 52 : 60}" fill="#f4f1ea" text-anchor="middle">¥</text>
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
