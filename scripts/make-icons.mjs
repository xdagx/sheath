// Renders the SVG brand mark into the PNG sizes required by the manifest.
// Usage: node scripts/make-icons.mjs   (needs Playwright + Chromium available)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(`${process.env.npm_config_prefix ?? '/usr/local'}/lib/node_modules/playwright`);
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1fb6ff"/><stop offset="1" stop-color="#6b5cff"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#g)"/>
  <g stroke="#fff" stroke-width="4.5" stroke-linecap="round"><path d="M20 20 44 44M44 20 20 44"/></g>
  <g fill="#fff">
    <circle cx="20" cy="20" r="5"/><circle cx="44" cy="20" r="5"/>
    <circle cx="20" cy="44" r="5"/><circle cx="44" cy="44" r="5"/>
    <circle cx="32" cy="32" r="6" fill="#0d1b3a" stroke="#fff" stroke-width="3"/>
  </g>
</svg>`;

mkdirSync('public/icons', { recursive: true });
const browser = await playwright.chromium.launch();
const page = await browser.newPage();
// Chrome Web Store: the 128px icon should be 96x96 artwork with 16px transparent padding;
// toolbar / management-page sizes use the full canvas.
for (const size of [16, 32, 48, 128]) {
  const art = size === 128 ? 96 : size;
  const pad = (size - art) / 2;
  await page.setViewportSize({ width: size, height: size });
  // the 128px store icon crops the SVG's 2-unit margin so the tile fills the full 96px art box
  const art128 = size === 128 ? svg.replace('viewBox="0 0 64 64"', 'viewBox="2 2 60 60"') : svg;
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><div style="padding:${pad}px">${art128.replace('<svg ', `<svg width="${art}" height="${art}" style="display:block" `)}</div></body></html>`,
  );
  await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written');
