// Render the app icons from scripts/icons.svg (run once; the PNGs are committed).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('./icons.svg', import.meta.url), 'utf8');
const out = new URL('../public/icons/', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const [name, size, rx] of [['icon-192.png', 192, 96], ['icon-512.png', 512, 96], ['maskable-512.png', 512, 0], ['apple-touch-icon.png', 180, 0]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg.replace('PADRX', rx).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out + name, omitBackground: true });
}
await browser.close();
console.log('icons written');
