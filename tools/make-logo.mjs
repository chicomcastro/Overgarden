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

// Hero vignette — a small flat garden scene to fill the menu's top space and
// give the screen identity (transparent so it sits on the dark menu).
const hero = `
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="460" viewBox="0 0 760 460">
  <defs>
    <linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7bbf4a"/><stop offset="1" stop-color="#4f8a32"/></linearGradient>
    <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5d34"/><stop offset="1" stop-color="#6b4a2b"/></linearGradient>
    <linearGradient id="hleaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe48a"/><stop offset="1" stop-color="#eebb45"/></linearGradient>
  </defs>
  <!-- sun + clouds -->
  <circle cx="132" cy="112" r="58" fill="#ffe07a"/>
  <g fill="#dfe9d2" opacity="0.45"><ellipse cx="600" cy="92" rx="72" ry="26"/><ellipse cx="664" cy="104" rx="46" ry="22"/><ellipse cx="548" cy="104" rx="40" ry="20"/></g>
  <!-- hill + soil -->
  <path d="M-20 332 Q 380 250 780 332 L 780 480 L -20 480 Z" fill="url(#hill)"/>
  <ellipse cx="380" cy="374" rx="312" ry="48" fill="url(#soil)"/>
  <!-- carrot -->
  <g transform="translate(214,346)">
    <path d="M-24 8 L24 8 L0 80 Z" fill="#e8893f" stroke="#9c531f" stroke-width="5" stroke-linejoin="round"/>
    <g fill="#5fa83a" stroke="#3f6b2c" stroke-width="4" stroke-linejoin="round">
      <path d="M0 10 C-6 -26, -24 -34, -36 -30 C-30 -10, -14 6, 0 10 Z"/>
      <path d="M0 10 C6 -26, 24 -34, 36 -30 C30 -10, 14 6, 0 10 Z"/>
      <path d="M0 10 C-3 -30, 0 -44, 0 -44 C3 -30, 3 -14, 0 10 Z"/>
    </g>
  </g>
  <!-- sprout -->
  <g transform="translate(346,350)">
    <path d="M0 60 C-4 20, -4 4, 0 -24" stroke="#3f6b2c" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M0 16 C-40 22, -64 -2, -64 -44 C-18 -44, 4 -16, 0 16 Z" fill="url(#hleaf)" stroke="#3f6b2c" stroke-width="6" stroke-linejoin="round"/>
    <path d="M0 8 C40 14, 64 -10, 64 -52 C18 -52, -4 -24, 0 8 Z" fill="url(#hleaf)" stroke="#3f6b2c" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="0" cy="-42" r="13" fill="#ffe48a" stroke="#3f6b2c" stroke-width="6"/>
  </g>
  <!-- tomato bush -->
  <g transform="translate(486,360)">
    <ellipse cx="0" cy="-22" rx="56" ry="46" fill="#54923a" stroke="#3f6b2c" stroke-width="5"/>
    <circle cx="-20" cy="-12" r="12" fill="#d8483a" stroke="#9c2f25" stroke-width="3"/>
    <circle cx="18" cy="-30" r="12" fill="#e0584a" stroke="#9c2f25" stroke-width="3"/>
    <circle cx="8" cy="6" r="11" fill="#d8483a" stroke="#9c2f25" stroke-width="3"/>
  </g>
  <!-- corn -->
  <g transform="translate(602,352)">
    <ellipse cx="0" cy="-28" rx="20" ry="50" fill="#f0c44e" stroke="#bd8a26" stroke-width="4"/>
    <path d="M0 22 C-26 16, -34 -12, -28 -42 C-8 -22, -2 -2, 0 22 Z" fill="#5fa83a" stroke="#3f6b2c" stroke-width="4" stroke-linejoin="round"/>
    <path d="M0 22 C26 16, 34 -12, 28 -42 C8 -22, 2 -2, 0 22 Z" fill="#5fa83a" stroke="#3f6b2c" stroke-width="4" stroke-linejoin="round"/>
  </g>
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
await render(hero, 760, 460, "ui_hero.png", true);
await browser.close();
console.log("Pronto.");
