// Renders src/icons/*.png from the SVG below. Run once after changing it.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs>
  <rect width="128" height="128" rx="30" fill="url(#g)"/>
  <rect x="50" y="24" width="28" height="50" rx="14" fill="#fff"/>
  <path d="M36 60a28 28 0 0 0 56 0" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
  <path d="M64 88v14" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
  <path d="M100 40c5 6 5 18 0 24M108 32c9 11 9 29 0 40" fill="none" stroke="#c7d2fe" stroke-width="5" stroke-linecap="round"/>
</svg>`;

await mkdir('src/icons', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="${size}" height="${size}">`);
  await page.screenshot({ path: `src/icons/${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
