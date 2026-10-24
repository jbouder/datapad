/**
 * Draws the PWA icons, the favicon.ico and the og image from the Datapad
 * mark (the same paths as `DatapadMark` and public/favicon.svg), with
 * Playwright's Chromium so the Oxanium wordmark renders exactly. Run after
 * changing the mark, then commit what it writes to public/:
 *
 *   npx tsx scripts/icons.ts    (or: node --experimental-strip-types)
 *
 * Every raster icon is a near-black tile with the mark in near-white, so
 * it reads on light and dark home screens alike; the maskable one keeps
 * the mark inside the central 60% safe zone.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'public');
const INK = '#f2f2f2';
const TILE = '#0a0a0a';

function mark(size: number, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect x="12" y="6" width="40" height="52" fill="none" stroke="${color}" stroke-width="6"/>
  <path d="M21 20h22M21 30h22M21 40h12" fill="none" stroke="${color}" stroke-width="5"/>
  <rect x="38" y="38" width="6" height="6" fill="${color}"/>
</svg>`;
}

/** A square tile, the mark at `scale` of its side. */
function tile(side: number, scale: number): string {
  return `<div style="width:${side}px;height:${side}px;background:${TILE};display:grid;place-items:center">${mark(Math.round(side * scale), INK)}</div>`;
}

const font = readFileSync(
  resolve(
    ROOT,
    'node_modules/@fontsource-variable/oxanium/files/oxanium-latin-wght-normal.woff2',
  ),
).toString('base64');

const og = `<div style="width:1200px;height:630px;background:${TILE};color:${INK};display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box;font-family:Oxanium">
  <div style="display:flex;align-items:center;gap:36px">${mark(132, INK)}<span style="font-size:120px;font-weight:700;letter-spacing:-0.02em">Datapad</span></div>
  <p style="font-size:40px;margin:40px 0 0;opacity:0.72;font-weight:500">Projects, tasks, notes, events and people.<br>Private, on your own Cloudflare account.</p>
</div>`;

const shots: { file: string; html: string; side: [number, number] }[] = [
  { file: 'icon-192.png', html: tile(192, 0.72), side: [192, 192] },
  { file: 'icon-512.png', html: tile(512, 0.72), side: [512, 512] },
  { file: 'icon-maskable-512.png', html: tile(512, 0.5), side: [512, 512] },
  { file: 'apple-touch-icon.png', html: tile(180, 0.66), side: [180, 180] },
  { file: 'favicon-32.png', html: tile(32, 0.86), side: [32, 32] },
  { file: 'og.png', html: og, side: [1200, 630] },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const pngs = new Map<string, Buffer>();
for (const { file, html, side } of shots) {
  await page.setViewportSize({ width: side[0], height: side[1] });
  await page.setContent(
    `<style>@font-face{font-family:Oxanium;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:200 800}html,body{margin:0}</style>${html}`,
  );
  await page.evaluate(() => document.fonts.ready);
  pngs.set(file, await page.screenshot({ type: 'png' }));
}
await browser.close();

for (const [file, png] of pngs) {
  if (file !== 'favicon-32.png') writeFileSync(resolve(OUT, file), png);
}

// favicon.ico: one 32×32 PNG in an ICO container (every browser reads it).
const png = pngs.get('favicon-32.png') as Buffer;
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // no palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18); // offset of the image
writeFileSync(resolve(OUT, 'favicon.ico'), Buffer.concat([header, png]));

console.log(`Wrote ${pngs.size} files to public/`);
