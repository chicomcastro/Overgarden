// Asset cohesion pass — re-palette the "outlier" art (character + items) onto
// the palette used by the already-cohesive pixel-art crops/tiles, and harden
// edges (drop the painterly anti-aliasing) so everything reads as one style.
// Also strips item_bag's baked background and downsizes the oversized logo.
//
// Uses the bundled Chromium (playwright) purely as a PNG decoder/encoder — no
// new deps. Dimensions and the atlas are left untouched (crops/tiles unchanged).
//
//   node tools/repalette.mjs            # process in place
//   node tools/repalette.mjs --dry      # report palette only, write nothing
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMG = path.resolve(HERE, "../web/assets/img");
const DRY = process.argv.includes("--dry");

// Sheets that already define the cohesive pixel-art style (left untouched).
const SOURCE = ["Plants_1.png", "Plants_2.png", "tile_grass.png", "tile_soil.png", "tile_fence.png"];
// Outliers: edge-hardened + snapped to the shared palette (keep their own hues).
const TARGET = [
  "char_idle_down.png", "char_idle_up.png", "char_idle_left.png", "char_idle_right.png",
  "char_walk_down.png", "char_walk_up.png", "char_walk_left.png", "char_walk_right.png",
  "char_hold_down.png", "char_hold_up.png", "char_hold_left.png", "char_hold_right.png",
  "item_shovel.png", "item_water.png", "item_seed.png", "item_bag.png",
];
const ALPHA_T = 110;     // edge hardening threshold
const PALETTE_N = 64;    // representative colors kept

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();

// Decode a PNG to {w,h,data:[...rgba]} via a canvas.
async function decode(file) {
  const b64 = (await readFile(path.join(IMG, file))).toString("base64");
  return page.evaluate(async (durl) => {
    const im = new Image(); im.src = durl; await im.decode();
    const c = new OffscreenCanvas(im.width, im.height); const x = c.getContext("2d");
    x.imageSmoothingEnabled = false; x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, im.width, im.height);
    return { w: im.width, h: im.height, data: Array.from(d.data) };
  }, "data:image/png;base64," + b64);
}
async function encode(file, w, h, data) {
  const b64 = await page.evaluate(async (o) => {
    const c = new OffscreenCanvas(o.w, o.h); const x = c.getContext("2d");
    const img = new ImageData(new Uint8ClampedArray(o.data), o.w, o.h);
    x.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: "image/png" });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  }, { w, h, data });
  await writeFile(path.join(IMG, file), Buffer.from(b64, "base64"));
}

// --- build a SHARED palette from all sheets, so outlier hues (skin/hair/cloth)
// survive while the whole game draws from one reduced color set ---
const counts = new Map();
for (const f of [...SOURCE, ...TARGET]) {
  const { data } = await decode(f);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = (data[i] >> 3) + "," + (data[i + 1] >> 3) + "," + (data[i + 2] >> 3); // 5-bit buckets
    const e = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; counts.set(key, e);
  }
}
const palette = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, PALETTE_N)
  .map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]);
console.log(`Paleta compartilhada: ${palette.length} cores de ${SOURCE.length + TARGET.length} sheets.`);
if (DRY) { console.log(palette.map((c) => `rgb(${c.join(",")})`).join("  ")); await browser.close(); process.exit(0); }

function nearest([r, g, b]) {
  let best = palette[0], bd = Infinity;
  for (const c of palette) {
    // luma-weighted distance reads better than raw RGB
    const dr = (r - c[0]) * 0.5, dg = (g - c[1]) * 0.7, db = (b - c[2]) * 0.4;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// --- process the outliers ---
for (const f of TARGET) {
  const { w, h, data } = await decode(f);
  // item_bag: strip the baked background = most common opaque color on the
  // outer border ring (corners may be transparent, so don't sample them).
  if (f === "item_bag.png") {
    const ring = new Map();
    const add = (x, y) => { const j = (y * w + x) * 4; if (data[j + 3] > 180) { const k = data[j] + "," + data[j + 1] + "," + data[j + 2]; ring.set(k, (ring.get(k) || 0) + 1); } };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, 1); add(x, h - 1); add(x, h - 2); }
    for (let y = 0; y < h; y++) { add(0, y); add(1, y); add(w - 1, y); add(w - 2, y); }
    let bgKey = null, bn = 0; for (const [k, n] of ring) if (n > bn) { bn = n; bgKey = k; }
    if (bgKey) {
      const bg = bgKey.split(",").map(Number);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 150 && Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 95) data[i + 3] = 0;
      }
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < ALPHA_T) { data[i + 3] = 0; continue; }
    data[i + 3] = 255;
    const [r, g, b] = nearest([data[i], data[i + 1], data[i + 2]]);
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
  await encode(f, w, h, data);
  console.log("  re-paletizado:", f);
}

// --- shrink the oversized logo ---
{
  const b64 = (await readFile(path.join(IMG, "ui_logo.png"))).toString("base64");
  const out = await page.evaluate(async (durl) => {
    const im = new Image(); im.src = durl; await im.decode();
    const s = 512 / Math.max(im.width, im.height);
    const c = new OffscreenCanvas(Math.round(im.width * s), Math.round(im.height * s));
    const x = c.getContext("2d"); x.drawImage(im, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: "image/png" });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let str = ""; for (let i = 0; i < buf.length; i++) str += String.fromCharCode(buf[i]);
    return btoa(str);
  }, "data:image/png;base64," + b64);
  await writeFile(path.join(IMG, "ui_logo.png"), Buffer.from(out, "base64"));
  console.log("  logo reduzido para <=512px");
}

await browser.close();
console.log("Pronto.");
