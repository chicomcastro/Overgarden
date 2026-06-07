// Generates the app launcher icon (PWA/apple) and the in-app wordmark from SVG,
// rendered to PNG via the bundled Chromium (no deps). Re-run after tweaking:
//   node tools/make-logo.mjs
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const IMG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/assets/img");

// Launcher icon — full-bleed so the OS mask can round it (maskable-safe: the
// sprout stays well within the centre 80%). Green field + gold sprout + soil.
const icon = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a5430"/>
      <stop offset="1" stop-color="#6aa544"/>
    </linearGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe48a"/>
      <stop offset="1" stop-color="#eebb45"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- soil -->
  <ellipse cx="256" cy="378" rx="158" ry="52" fill="#6b4a2b"/>
  <ellipse cx="256" cy="368" rx="158" ry="52" fill="#825a35"/>
  <!-- stem -->
  <path d="M256 372 C248 312, 248 286, 256 232" stroke="#3f6b2c" stroke-width="20" fill="none" stroke-linecap="round"/>
  <!-- leaves (mirrored teardrops) -->
  <path d="M256 300 C190 308, 150 270, 150 206 C222 206, 258 244, 256 300 Z" fill="url(#leaf)" stroke="#3f6b2c" stroke-width="8" stroke-linejoin="round"/>
  <path d="M256 286 C322 294, 362 256, 362 192 C290 192, 254 230, 256 286 Z" fill="url(#leaf)" stroke="#3f6b2c" stroke-width="8" stroke-linejoin="round"/>
  <!-- bud -->
  <circle cx="256" cy="206" r="20" fill="#ffe48a" stroke="#3f6b2c" stroke-width="8"/>
</svg>`;

// In-app wordmark — transparent, gold with a dark outline + shadow.
const wordmark = `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="260" viewBox="0 0 900 260">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe9a0"/>
      <stop offset="0.55" stop-color="#f7d774"/>
      <stop offset="1" stop-color="#e0ad3c"/>
    </linearGradient>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="8" stdDeviation="0" flood-color="#1a2417" flood-opacity="0.55"/>
    </filter>
  </defs>
  <!-- little sprout accent over the wordmark -->
  <g transform="translate(450 44)">
    <path d="M0 26 C0 6, -14 -6, -30 -8 C-30 12, -16 26, 0 26 Z" fill="#9bd36a" stroke="#3f6b2c" stroke-width="4" stroke-linejoin="round"/>
    <path d="M0 26 C0 6, 14 -6, 30 -8 C30 12, 16 26, 0 26 Z" fill="#9bd36a" stroke="#3f6b2c" stroke-width="4" stroke-linejoin="round"/>
  </g>
  <text x="450" y="196" text-anchor="middle"
    font-family="'Trebuchet MS','Verdana',sans-serif" font-size="150" font-weight="900"
    letter-spacing="-2"
    fill="url(#gold)" stroke="#3f2d12" stroke-width="9" paint-order="stroke" filter="url(#ds)">Overgarden</text>
</svg>`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
async function render(svg, w, h, file, transparent) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset=utf8><style>html,body{margin:0;padding:0}</style>${svg}`);
  const buf = await page.screenshot({ omitBackground: !!transparent });
  await writeFile(path.join(IMG, file), buf);
  await page.close();
  console.log("  escrito:", file, `${w}x${h}`);
}
await render(icon, 512, 512, "app_icon.png", false);
await render(wordmark, 900, 260, "ui_wordmark.png", true);
await browser.close();
console.log("Pronto.");
