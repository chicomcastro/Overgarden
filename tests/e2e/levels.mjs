// Per-level balancing tool for the campaign.
//
// Runs the autoplayer bot across every stage in web/assets/levels.json over
// several seeds and reports the score distribution per level, plus a SUGGESTED
// set of star goals derived from measured bot throughput. The bot is a
// deliberately conservative player (one crop at a time), so it's a low-ish
// baseline — humans/co-op beat it — which makes for friendly campaign goals.
//
// Usage: node tests/e2e/levels.mjs [--seeds 1,2,3,4,5] [--apply]
//   --apply  rewrites levels.json with the suggested goals.
import { chromium } from "playwright";
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, "../../web");
const LEVELS_PATH = path.join(WEB_DIR, "assets/levels.json");

const argv = process.argv.slice(2);
const getArg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SEEDS = getArg("--seeds", "1,2,3,4,5").split(",").map((s) => parseInt(s, 10));
const APPLY = argv.includes("--apply");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" };
function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(WEB_DIR, path.normalize(url === "/" ? "/index.html" : url));
      if (!file.startsWith(WEB_DIR)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r10 = (x) => Math.max(10, Math.round(x / 10) * 10);

// Friendly campaign curve from the conservative bot baseline:
//   ★1 = most runs clear it · ★2 ≈ a solid bot run · ★3 ≈ bot's best (humans beat it).
function suggestGoals(scores) {
  const md = median(scores), mx = Math.max(...scores);
  let s1 = r10(md * 0.6);          // ★1: most runs clear it (gentle entry)
  let s2 = r10(((md + mx) / 2) * 0.95); // ★2: a solid run
  let s3 = r10(mx);                // ★3: the bot's best — humans beat the bot, so reachable
  if (s2 <= s1) s2 = s1 + 20;
  if (s3 <= s2) s3 = s2 + 30;
  return [s1, s2, s3];
}

async function playLevel(browser, base, levelId, seed) {
  const page = await browser.newPage({ viewport: { width: 980, height: 700 } });
  await page.goto(`${base}/index.html?debug&seed=${seed}`);
  await page.waitForFunction(() => window.__OG__ && window.__OG__.assetsReady(), null, { timeout: 30000 });
  await page.addScriptTag({ path: path.join(HERE, "bot.js") });
  await page.addScriptTag({ path: path.join(HERE, "harness.js") });
  await page.evaluate((a) => window.__OG_HARNESS__.start({ seed: a.seed, levelId: a.levelId }), { seed, levelId });
  await page.evaluate(() => window.__OG_HARNESS__.run({ untilTime: 0, render: false }));
  const m = await page.evaluate(() => window.__OG_HARNESS__.metrics());
  await page.close();
  return m.summary;
}

async function main() {
  const data = JSON.parse(await readFile(LEVELS_PATH, "utf8"));
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  console.log(`Bot por fase · seeds ${SEEDS.join(",")}\n`);
  console.log("fase".padEnd(14), "dif", "dur", " mean  med  min  max", " entreg/perd", " atual→sugerido");
  const updates = [];
  for (const lv of data.levels) {
    const scores = [], deliv = [], exp = [];
    for (const seed of SEEDS) {
      const s = await playLevel(browser, base, lv.id, seed);
      scores.push(s.score); deliv.push(s.delivered); exp.push(s.expired);
    }
    const sug = suggestGoals(scores);
    updates.push({ id: lv.id, stars: sug });
    const row = [
      lv.name.padEnd(14),
      String(lv.difficulty ?? "-").padStart(3),
      String(lv.duration).padStart(3),
      `${Math.round(mean(scores))}`.padStart(5) + `${Math.round(median(scores))}`.padStart(5) + `${Math.min(...scores)}`.padStart(5) + `${Math.max(...scores)}`.padStart(5),
      `  ${mean(deliv).toFixed(1)}/${mean(exp).toFixed(1)}`.padEnd(12),
      ` [${lv.stars.join("/")}] → [${sug.join("/")}]`,
    ];
    console.log(row.join(" "));
  }

  await browser.close();
  server.close();

  if (APPLY) {
    for (const u of updates) { const lv = data.levels.find((l) => l.id === u.id); lv.stars = u.stars; }
    await writeFile(LEVELS_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log(`\nAplicado: metas sugeridas escritas em ${path.relative(process.cwd(), LEVELS_PATH)}`);
  } else {
    console.log(`\n(dry-run — rode com --apply pra escrever as metas sugeridas)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
