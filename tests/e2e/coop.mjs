// Co-op balancing harness.
//
// Drives N bot players across player counts 1..4 and reports team score, star
// distribution and load (expired orders, deaths, idle) per count — so the COOP
// scaling in game.js (spawn rate, concurrent orders, star goals) can be tuned
// against real multi-player throughput.
//
// Usage: node tests/e2e/coop.mjs [--difficulty 1] [--seeds 1,2,3,4,5]
//        [--counts 1,2,3,4] [--out DIR]
import { chromium } from "playwright";
import http from "node:http";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, "../../web");

const argv = process.argv.slice(2);
const getArg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIFFICULTY = parseInt(getArg("--difficulty", "1"), 10);
const SEEDS = getArg("--seeds", "1,2,3,4,5").split(",").map((s) => parseInt(s, 10));
const COUNTS = getArg("--counts", "1,2,3,4").split(",").map((s) => parseInt(s, 10));
const OUT = path.resolve(process.cwd(), getArg("--out", "tests/e2e/out/coop"));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".wav": "audio/wav", ".mp3": "audio/mpeg" };
function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(WEB_DIR, path.normalize(url === "/" ? "/index.html" : url));
      if (!file.startsWith(WEB_DIR)) return void res.writeHead(403).end();
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(`${base}/index.html?debug`);
  await page.waitForFunction(() => window.__OG__ && window.__OG__.assetsReady(), null, { timeout: 30000 });
  await page.addScriptTag({ path: path.join(HERE, "coop-bot.js") });

  const coopConst = await page.evaluate(() => window.__OG__.COOP);
  console.log(`Co-op balancing — dificuldade ${DIFFICULTY}, seeds ${SEEDS.join(",")}\nCOOP atual: ${JSON.stringify(coopConst)}\n`);

  const rows = [];
  for (const count of COUNTS) {
    const runs = [];
    for (const seed of SEEDS) {
      const m = await page.evaluate(({ count, difficulty, seed }) => {
        const OG = window.__OG__, BOT = window.__OG_COOPBOT__;
        OG.startHeadlessCoop({ count, difficulty, seed }); BOT.reset();
        const dt = 1 / 30; let deaths = 0, idle = 0, ticks = 0, guard = 20000;
        const prev = OG.game.plots.map((p) => p.stage);
        while (OG.gameState === "playing" && OG.game.time > 0 && guard-- > 0) {
          OG.setBotIntents(BOT.intents(OG));
          OG.tick(dt, false);
          if (OG.gameState !== "playing") break;
          const g = OG.game;
          for (let k = 0; k < g.plots.length; k++) {
            if (prev[k] !== OG.STAGE.DIED && g.plots[k].stage === OG.STAGE.DIED) deaths++;
            prev[k] = g.plots[k].stage;
          }
          ticks++;
          let mv = 0; for (const p of g.players) if (p.moving) mv++;
          idle += (g.players.length - mv) / g.players.length;
        }
        const g = OG.game, goals = OG.starGoals(), s = g.score;
        const stars = s >= goals[2] ? 3 : s >= goals[1] ? 2 : s >= goals[0] ? 1 : 0;
        return { score: s, stars, goals, delivered: g.stats.delivered, expired: g.stats.expired, spawned: g.orderId - 1, deaths, idlePct: +(100 * idle / Math.max(1, ticks)).toFixed(1) };
      }, { count, difficulty: DIFFICULTY, seed });
      runs.push(m);
    }
    const agg = {
      count,
      goals: runs[0].goals,
      meanScore: Math.round(mean(runs.map((r) => r.score))),
      maxScore: Math.max(...runs.map((r) => r.score)),
      avgStars: +mean(runs.map((r) => r.stars)).toFixed(2),
      delivered: +mean(runs.map((r) => r.delivered)).toFixed(1),
      expired: +mean(runs.map((r) => r.expired)).toFixed(1),
      spawned: +mean(runs.map((r) => r.spawned)).toFixed(1),
      deaths: +mean(runs.map((r) => r.deaths)).toFixed(1),
      idlePct: +mean(runs.map((r) => r.idlePct)).toFixed(1),
    };
    rows.push(agg);
    console.log(`${count}p -> score=${agg.meanScore} (max ${agg.maxScore}) stars=${agg.avgStars} goals=${agg.goals.join("/")} deliv=${agg.delivered} exp=${agg.expired}/${agg.spawned} deaths=${agg.deaths} idle=${agg.idlePct}%`);
  }

  await browser.close();
  server.close();

  // Suggested starScale so each count keeps the SAME difficulty feel relative to
  // its achievable ceiling as solo (starScale[N] = ceiling_N / ceiling_1).
  const ceil1 = rows.find((r) => r.count === 1)?.maxScore || rows[0].maxScore;
  const md = [];
  md.push(`# Co-op balancing — dificuldade ${DIFFICULTY} (${SEEDS.length} seeds/contagem)`);
  md.push("");
  md.push(`COOP avaliado: \`${JSON.stringify(coopConst)}\``);
  md.push("");
  md.push(`| jogadores | score méd | max | ★ méd | metas | entreg | perdidos/gerados | mortas | parado% | starScale sugerido |`);
  md.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const r of rows) {
    const sugg = +(r.maxScore / ceil1).toFixed(2);
    md.push(`| ${r.count} | ${r.meanScore} | ${r.maxScore} | ${r.avgStars} | ${r.goals.join("/")} | ${r.delivered} | ${r.expired}/${r.spawned} | ${r.deaths} | ${r.idlePct} | ${sugg} |`);
  }
  md.push("");
  md.push(`**Leitura:** \`starScale\` sugerido = teto_N / teto_solo (mantém o mesmo feel relativo).`);
  md.push(`Muitos **perdidos** ⇒ baixar \`spawnScale\`/subir \`concurrentBonus\` cedo demais; **idle alto** ⇒ pode acelerar spawn.`);

  await writeFile(path.join(OUT, "coop.json"), JSON.stringify({ difficulty: DIFFICULTY, seeds: SEEDS, coop: coopConst, rows, suggestedStarScale: rows.map((r) => +(r.maxScore / ceil1).toFixed(2)) }, null, 2));
  await writeFile(path.join(OUT, "coop.md"), md.join("\n"));
  console.log(`\nSuggested starScale (teto_N/teto_solo): [${rows.map((r) => +(r.maxScore / ceil1).toFixed(2)).join(", ")}]`);
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
