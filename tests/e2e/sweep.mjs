// Overgarden tuning sweep.
//
// Sweeps combinations of the balancing knobs that most affect throughput and
// runs the autoplayer bot across several seeds per combo, then ranks which
// combos land a competent player in the "fun" star band (default 1–2★).
//
// It mutates the live __OG__.TUNE/ORDER/ROUND objects in-page before each round
// (they're const bindings but mutable objects), so no rebuild is needed.
//
// Usage: node tests/e2e/sweep.mjs [--players N] [--seeds 1,2,3] [--target 1.5] [--out DIR]
import { chromium } from "playwright";
import http from "node:http";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, "../../web");

const argv = process.argv.slice(2);
const getArg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PLAYERS = parseInt(getArg("--players", "1"), 10);
const SEEDS = getArg("--seeds", "1,2,3").split(",").map((s) => parseInt(s, 10));
const TARGET = parseFloat(getArg("--target", "1.5")); // ideal avg stars (centre of fun band)
const BAND = [1, 2];                                  // fun band (inclusive)
const OUT = path.resolve(process.cwd(), getArg("--out", "tests/e2e/out/sweep"));

// ---- swept axes ------------------------------------------------------------
// Each axis is expressed relative to the shipped baseline so the grid stays
// meaningful even if defaults change. spawnScale > 1 = orders spawn slower.
const AXES = {
  spawnScale: [1.0, 1.5, 2.0],   // multiplies ORDER.spawnStart / spawnEnd
  timeBase: [22, 32, 42],        // ORDER.timeBase (seconds to fulfil)
  expirePenalty: [60, 30],       // ORDER.expirePenalty
};

function product() {
  let combos = [{}];
  for (const [key, vals] of Object.entries(AXES)) {
    const next = [];
    for (const c of combos) for (const v of vals) next.push({ ...c, [key]: v });
    combos = next;
  }
  return combos;
}

// ---- static server ---------------------------------------------------------
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
  await page.addScriptTag({ path: path.join(HERE, "bot.js") });
  await page.addScriptTag({ path: path.join(HERE, "harness.js") });

  // Capture shipped baseline (for relative axes) and report-against tuning.
  const baseline = await page.evaluate(() => ({ ORDER: { ...window.__OG__.ORDER }, ROUND: { ...window.__OG__.ROUND } }));

  const combos = product();
  console.log(`Sweeping ${combos.length} combos × ${SEEDS.length} seeds (dificuldade ${PLAYERS})…\n`);

  const results = [];
  for (const combo of combos) {
    const patch = {
      ORDER: {
        spawnStart: +(baseline.ORDER.spawnStart * combo.spawnScale).toFixed(2),
        spawnEnd: +(baseline.ORDER.spawnEnd * combo.spawnScale).toFixed(2),
        timeBase: combo.timeBase,
        expirePenalty: combo.expirePenalty,
      },
    };
    const runs = [];
    for (const seed of SEEDS) {
      const m = await page.evaluate(({ patch, players, seed }) => {
        Object.assign(window.__OG__.ORDER, patch.ORDER);
        window.__OG_HARNESS__.start({ players, seed });
        window.__OG_HARNESS__.run({ untilTime: 0, render: false });
        return window.__OG_HARNESS__.metrics().summary;
      }, { patch, players: PLAYERS, seed });
      runs.push(m);
    }
    const agg = {
      ...combo,
      meanScore: Math.round(mean(runs.map((r) => r.score))),
      avgStars: +mean(runs.map((r) => r.stars)).toFixed(2),
      delivered: +mean(runs.map((r) => r.delivered)).toFixed(1),
      expired: +mean(runs.map((r) => r.expired)).toFixed(1),
      deaths: +mean(runs.map((r) => r.deaths)).toFixed(1),
    };
    agg.inBand = agg.avgStars >= BAND[0] && agg.avgStars <= BAND[1];
    results.push(agg);
    console.log(`spawn×${combo.spawnScale} time=${combo.timeBase} pen=${combo.expirePenalty} -> score=${agg.meanScore} stars=${agg.avgStars} exp=${agg.expired}${agg.inBand ? "  ✓band" : ""}`);
  }

  await browser.close();
  server.close();

  // Rank: in-band first, then closeness to TARGET, then higher score, then the
  // smallest deviation from shipped defaults (least disruptive change).
  const dev = (c) => Math.abs(c.spawnScale - 1) + Math.abs(c.timeBase - baseline.ORDER.timeBase) / 10 + Math.abs(c.expirePenalty - baseline.ORDER.expirePenalty) / 30;
  const ranked = [...results].sort((a, b) =>
    (b.inBand - a.inBand) ||
    (Math.abs(a.avgStars - TARGET) - Math.abs(b.avgStars - TARGET)) ||
    (b.meanScore - a.meanScore) ||
    (dev(a) - dev(b))
  );

  const md = [];
  md.push(`# Tuning sweep — dificuldade ${PLAYERS} (${SEEDS.length} seeds/combo)`);
  md.push("");
  md.push(`Faixa-alvo: **${BAND[0]}–${BAND[1]}★** (ideal ${TARGET}). Metas de estrela: ${baseline.ROUND.stars.join(" / ")} · round ${baseline.ROUND.duration}s.`);
  md.push(`Baseline atual: spawn ${baseline.ORDER.spawnStart}→${baseline.ORDER.spawnEnd}s, timeBase ${baseline.ORDER.timeBase}s, expirePenalty ${baseline.ORDER.expirePenalty}.`);
  md.push("");
  const rec = ranked[0];

  // Achievable ceiling: best mean score any combo reached. If the lowest star
  // threshold sits above it, no tuning of the order knobs alone can earn a star
  // — the thresholds must come down (or production must speed up / go co-op).
  const ceiling = Math.max(...results.map((r) => r.meanScore));
  const suggestedStars = [Math.round(ceiling * 0.5), Math.round(ceiling * 0.8), Math.round(ceiling * 1.05)];

  md.push(`## Teto de score`);
  md.push(`Maior score médio alcançado no sweep: **${ceiling}**. Meta de 1★ atual: **${baseline.ROUND.stars[0]}**.`);
  if (ceiling < baseline.ROUND.stars[0]) {
    md.push(`> ⚠️ O teto está **abaixo** da meta de 1★ — nenhum ajuste de spawn/prazo/penalidade sozinho dá estrela a um jogador solo.`);
    md.push(`> Sugestão de metas alinhadas ao teto: \`ROUND.stars = [${suggestedStars.join(", ")}]\` (≈50% / 80% / 105% do teto), ou acelerar produção (crescimento/poço) ou co-op.`);
  } else {
    md.push(`Metas \`ROUND.stars\` parecem alcançáveis; foque no ranking de combos abaixo.`);
  }
  md.push("");
  md.push(`## Recomendação`);
  md.push(rec.inBand
    ? `\`spawnScale ${rec.spawnScale}\` · \`timeBase ${rec.timeBase}\` · \`expirePenalty ${rec.expirePenalty}\` → **${rec.avgStars}★** (score ${rec.meanScore}, ${rec.expired} pedidos perdidos).`
    : `Nenhum combo entrou na faixa ${BAND[0]}–${BAND[1]}★. Melhor aproximação: \`spawnScale ${rec.spawnScale}\` · \`timeBase ${rec.timeBase}\` · \`expirePenalty ${rec.expirePenalty}\` → ${rec.avgStars}★. Considere também baixar \`ROUND.stars\` ou ampliar o sweep.`);
  md.push("");
  md.push(`## Ranking`);
  md.push(`| # | spawn× | timeBase | expirePen | score méd | ★ méd | entreg | perdidos | mortas | faixa |`);
  md.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  ranked.forEach((r, i) => md.push(`| ${i + 1} | ${r.spawnScale} | ${r.timeBase} | ${r.expirePenalty} | ${r.meanScore} | ${r.avgStars} | ${r.delivered} | ${r.expired} | ${r.deaths} | ${r.inBand ? "✅" : ""} |`));

  await writeFile(path.join(OUT, "sweep.json"), JSON.stringify({ players: PLAYERS, seeds: SEEDS, target: TARGET, band: BAND, baseline, axes: AXES, ceiling, suggestedStars, ranked }, null, 2));
  await writeFile(path.join(OUT, "sweep.md"), md.join("\n"));
  console.log(`\nWrote sweep report to ${OUT}`);
  console.log(rec.inBand
    ? `Recommended: spawnScale=${rec.spawnScale} timeBase=${rec.timeBase} expirePenalty=${rec.expirePenalty} (${rec.avgStars}★)`
    : `No combo in band; best ${rec.avgStars}★ at spawnScale=${rec.spawnScale} timeBase=${rec.timeBase} expirePenalty=${rec.expirePenalty}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
