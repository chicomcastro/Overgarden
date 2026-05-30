// Overgarden e2e balancing harness.
//
// Launches the web build in headless Chromium, lets the autoplayer bot play
// full rounds across several deterministic seeds, then emits:
//   - out/screenshots/*.png  — visual evidence (start / mid / late / result)
//   - out/score-over-time.svg — score curves vs star thresholds
//   - out/metrics.json        — full per-run metrics + aggregate + tuning snapshot
//   - out/report.md           — human report embedding the above
//   - out/summary.md          — short table for the PR comment
//
// Usage: node tests/e2e/run.mjs [--players N] [--seeds 1,2,3] [--out DIR]
import { chromium } from "playwright";
import http from "node:http";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, "../../web");

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const PLAYERS = parseInt(getArg("--players", "1"), 10);
const SEEDS = getArg("--seeds", "1,2,3,4,5").split(",").map((s) => parseInt(s, 10));
const OUT = path.resolve(process.cwd(), getArg("--out", "tests/e2e/out"));
const EVIDENCE_SEED = SEEDS[0];

// ---- tiny static server ----------------------------------------------------
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".wav": "audio/wav",
  ".mp3": "audio/mpeg", ".svg": "image/svg+xml",
};
function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split("?")[0]);
      const rel = url === "/" ? "/index.html" : url;
      const file = path.join(WEB_DIR, path.normalize(rel));
      if (!file.startsWith(WEB_DIR)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---- one round -------------------------------------------------------------
async function playRound(browser, base, seed, withEvidence) {
  const page = await browser.newPage({ viewport: { width: 980, height: 700 } });
  await page.goto(`${base}/index.html?debug&seed=${seed}`);
  await page.waitForFunction(() => window.__OG__ && window.__OG__.assetsReady(), null, { timeout: 30000 });
  await page.addScriptTag({ path: path.join(HERE, "bot.js") });
  await page.addScriptTag({ path: path.join(HERE, "harness.js") });
  await page.evaluate(({ players, seed }) => window.__OG_HARNESS__.start({ players, seed }), { players: PLAYERS, seed });

  const shots = [];
  if (withEvidence) {
    const dir = path.join(OUT, "screenshots");
    const duration = await page.evaluate(() => window.__OG__.ROUND.duration);
    const checkpoints = [
      { label: "01_start", at: 5 },
      { label: "02_mid", at: Math.round(duration * 0.5) },
      { label: "03_late", at: Math.round(duration * 0.92) },
    ];
    for (const cp of checkpoints) {
      await page.evaluate((untilTime) => window.__OG_HARNESS__.run({ untilTime, render: true }), duration - cp.at);
      const file = path.join(dir, `${cp.label}.png`);
      await page.locator("#game").screenshot({ path: file });
      shots.push(file);
    }
    await page.evaluate(() => window.__OG_HARNESS__.run({ untilTime: 0, render: true }));
    const resultFile = path.join(dir, "04_result.png");
    await page.locator("#game-wrapper").screenshot({ path: resultFile });
    shots.push(resultFile);
  } else {
    await page.evaluate(() => window.__OG_HARNESS__.run({ untilTime: 0, render: false }));
  }

  const metrics = await page.evaluate(() => window.__OG_HARNESS__.metrics());
  const tuning = await page.evaluate(() => ({ TUNE: window.__OG__.TUNE, ROUND: window.__OG__.ROUND, ORDER: window.__OG__.ORDER }));
  await page.close();
  return { seed, ...metrics, tuning, shots: shots.map((f) => path.relative(OUT, f)) };
}

// ---- aggregate helpers -----------------------------------------------------
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function aggregate(runs) {
  const score = runs.map((r) => r.summary.score);
  const starDist = [0, 0, 0, 0];
  for (const r of runs) starDist[r.summary.stars]++;
  const avg = (key) => +mean(runs.map((r) => r.summary[key])).toFixed(2);
  return {
    runs: runs.length,
    score: { mean: Math.round(mean(score)), median: Math.round(median(score)), min: Math.min(...score), max: Math.max(...score) },
    starDistribution: { "0": starDist[0], "1": starDist[1], "2": starDist[2], "3": starDist[3] },
    avgStars: +mean(runs.map((r) => r.summary.stars)).toFixed(2),
    delivered: avg("delivered"), expired: avg("expired"), ordersSpawned: avg("ordersSpawned"),
    deaths: avg("deaths"), waters: avg("waters"), harvests: avg("harvests"),
    maxCombo: Math.max(...runs.map((r) => r.summary.maxCombo)),
    idlePct: avg("idlePct"), avgActiveOrders: avg("avgActiveOrders"),
  };
}

// ---- SVG score-over-time chart --------------------------------------------
function buildChart(runs, tuning) {
  const W = 760, H = 360, pad = { l: 56, r: 16, t: 16, b: 36 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const duration = tuning.ROUND.duration;
  const maxScore = Math.max(tuning.ROUND.stars[2] * 1.1, ...runs.flatMap((r) => r.series.map((s) => s.score)));
  const x = (t) => pad.l + (t / duration) * iw;
  const y = (s) => pad.t + ih - (s / maxScore) * ih;
  const colors = ["#2e8b57", "#c0392b", "#2980b9", "#8e44ad", "#d68910", "#16a085"];

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fbfdf7" stroke="#dfe6da"/>`);
  // star threshold lines
  tuning.ROUND.stars.forEach((s, i) => {
    const yy = y(s).toFixed(1);
    parts.push(`<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="#e0b341" stroke-dasharray="4 4"/>`);
    parts.push(`<text x="${W - pad.r - 2}" y="${(y(s) - 4).toFixed(1)}" font-size="11" fill="#b8860b" text-anchor="end">${"★".repeat(i + 1)} ${s}</text>`);
  });
  // axes
  parts.push(`<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + ih}" stroke="#9aa39a"/>`);
  parts.push(`<line x1="${pad.l}" y1="${pad.t + ih}" x2="${W - pad.r}" y2="${pad.t + ih}" stroke="#9aa39a"/>`);
  for (let t = 0; t <= duration; t += 30) {
    parts.push(`<text x="${x(t).toFixed(1)}" y="${H - 12}" font-size="11" fill="#5a635a" text-anchor="middle">${t}s</text>`);
  }
  parts.push(`<text x="14" y="${(pad.t + ih / 2).toFixed(1)}" font-size="11" fill="#5a635a" transform="rotate(-90 14 ${(pad.t + ih / 2).toFixed(1)})" text-anchor="middle">score</text>`);
  // score lines
  runs.forEach((r, i) => {
    const pts = r.series.map((s) => `${x(s.t).toFixed(1)},${y(s.score).toFixed(1)}`).join(" ");
    parts.push(`<polyline points="${pts}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="2" opacity="0.85"/>`);
    parts.push(`<text x="${W - pad.r - 4}" y="${(pad.t + 14 + i * 14).toFixed(1)}" font-size="11" fill="${colors[i % colors.length]}" text-anchor="end">seed ${r.seed}: ${r.summary.score} (${"★".repeat(r.summary.stars) || "—"})</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

// ---- report ----------------------------------------------------------------
const DIFF_LABEL = { 1: "Fácil", 2: "Médio", 3: "Difícil", 4: "Insano" };

function summaryTable(agg) {
  return [
    `| métrica | valor |`,
    `| --- | --- |`,
    `| Runs (seeds) | ${agg.runs} |`,
    `| Score médio / mediano | **${agg.score.mean}** / ${agg.score.median} |`,
    `| Score min–max | ${agg.score.min} – ${agg.score.max} |`,
    `| Estrelas (média) | ${"★".repeat(Math.round(agg.avgStars)) || "—"} (${agg.avgStars}) |`,
    `| Distribuição ★ (0/1/2/3) | ${agg.starDistribution["0"]}/${agg.starDistribution["1"]}/${agg.starDistribution["2"]}/${agg.starDistribution["3"]} |`,
    `| Pedidos entregues / perdidos | ${agg.delivered} / ${agg.expired} |`,
    `| Pedidos gerados (média) | ${agg.ordersSpawned} |`,
    `| Plantas mortas (média) | ${agg.deaths} |`,
    `| Regas / colheitas (média) | ${agg.waters} / ${agg.harvests} |`,
    `| Combo máx | ${agg.maxCombo} |`,
    `| Pedidos ativos (média) | ${agg.avgActiveOrders} |`,
    `| Tempo parado | ${agg.idlePct}% |`,
  ].join("\n");
}

function buildReport(runs, agg, tuning) {
  const lines = [];
  lines.push(`# Overgarden — Relatório de balanceamento (e2e)`);
  lines.push("");
  lines.push(`Bot autoplayer · dificuldade **${DIFF_LABEL[PLAYERS] || PLAYERS}** · ${runs.length} seeds · round de ${tuning.ROUND.duration}s.`);
  lines.push("");
  lines.push(`## Resumo`);
  lines.push("");
  lines.push(summaryTable(agg));
  lines.push("");
  lines.push(`### Como ler para rebalancear`);
  lines.push(`- **Sempre 0★** → muito difícil (ou metas \`ROUND.stars\` altas demais). **Sempre 3★** → fácil demais.`);
  lines.push(`- **Mortes altas / regas baixas** → \`TUNE.lifeBase\`/\`wiltGrace\` apertados ou velocidade insuficiente p/ cobrir o mapa.`);
  lines.push(`- **Pedidos perdidos altos** → \`ORDER.timeBase\`/\`diffTime\` curtos ou \`spawn*\` rápidos demais.`);
  lines.push(`- **Tempo parado alto** → bot sem tarefa: provável folga (pode apertar o tuning).`);
  lines.push("");
  lines.push(`## Score ao longo do round`);
  lines.push("");
  lines.push(`![score-over-time](./score-over-time.svg)`);
  lines.push("");
  lines.push(`## Evidência visual (seed ${EVIDENCE_SEED})`);
  lines.push("");
  const ev = runs.find((r) => r.seed === EVIDENCE_SEED);
  for (const shot of ev?.shots || []) lines.push(`![${shot}](./${shot})`);
  lines.push("");
  lines.push(`## Por seed`);
  lines.push("");
  lines.push(`| seed | score | ★ | entreg. | perd. | mortas | regas | colh. | combo máx | parado% |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const r of runs) {
    const s = r.summary;
    lines.push(`| ${r.seed} | ${s.score} | ${s.stars} | ${s.delivered} | ${s.expired} | ${s.deaths} | ${s.waters} | ${s.harvests} | ${s.maxCombo} | ${s.idlePct} |`);
  }
  lines.push("");
  lines.push(`## Tuning avaliado`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(tuning, null, 2));
  lines.push("```");
  return lines.join("\n");
}

function buildSummary(agg, tuning) {
  const lines = [];
  lines.push(`### 🌾 Overgarden — balanceamento e2e (${DIFF_LABEL[PLAYERS] || PLAYERS}, ${agg.runs} seeds)`);
  lines.push("");
  lines.push(summaryTable(agg));
  lines.push("");
  lines.push(`Metas de estrela: ${tuning.ROUND.stars.join(" / ")} · round ${tuning.ROUND.duration}s.`);
  lines.push(`Evidências visuais (PNGs), gráfico SVG e \`metrics.json\` no artifact **overgarden-e2e** deste run.`);
  return lines.join("\n");
}

// ---- main ------------------------------------------------------------------
async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, "screenshots"), { recursive: true });

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  const runs = [];
  for (const seed of SEEDS) {
    const r = await playRound(browser, base, seed, seed === EVIDENCE_SEED);
    console.log(`seed ${seed}: score=${r.summary.score} stars=${r.summary.stars} delivered=${r.summary.delivered} expired=${r.summary.expired} deaths=${r.summary.deaths}`);
    runs.push(r);
  }

  await browser.close();
  server.close();

  const tuning = runs[0].tuning;
  const agg = aggregate(runs);

  await writeFile(path.join(OUT, "score-over-time.svg"), buildChart(runs, tuning));
  await writeFile(path.join(OUT, "metrics.json"), JSON.stringify({ players: PLAYERS, seeds: SEEDS, generatedAt: new Date().toISOString(), aggregate: agg, tuning, runs }, null, 2));
  await writeFile(path.join(OUT, "report.md"), buildReport(runs, agg, tuning));
  await writeFile(path.join(OUT, "summary.md"), buildSummary(agg, tuning));

  console.log(`\nAggregate: score mean=${agg.score.mean} median=${agg.score.median} | stars 0/1/2/3 = ${agg.starDistribution["0"]}/${agg.starDistribution["1"]}/${agg.starDistribution["2"]}/${agg.starDistribution["3"]} | avgStars=${agg.avgStars}`);
  console.log(`Wrote report to ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
