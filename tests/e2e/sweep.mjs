// Overgarden tuning sweep.
//
// Sweeps combinations of balancing knobs and runs the autoplayer bot across
// several seeds per combo, then ranks which combos land a competent player in
// the "fun" star band (default 1–2★) and reports the achievable score ceiling.
//
// Two modes (--mode):
//   order      (default) — order pacing: spawn rate, deadline, expire penalty
//   production           — crop economy: growth speed, life duration (watering)
//
// It mutates the live __OG__.TUNE/ORDER/ROUND objects in-page before each round
// (const bindings, mutable objects), so no rebuild is needed.
//
// Usage: node tests/e2e/sweep.mjs [--mode order|production] [--players N]
//        [--seeds 1,2,3] [--target 1.5] [--out DIR]
import { chromium } from "playwright";
import http from "node:http";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, "../../web");

const argv = process.argv.slice(2);
const getArg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const MODE = getArg("--mode", "order");
const PLAYERS = parseInt(getArg("--players", "1"), 10);
const SEEDS = getArg("--seeds", "1,2,3").split(",").map((s) => parseInt(s, 10));
const TARGET = parseFloat(getArg("--target", "1.5")); // ideal avg stars (centre of fun band)
const BAND = [1, 2];                                  // fun band (inclusive)
const OUT = path.resolve(process.cwd(), getArg("--out", `tests/e2e/out/sweep-${MODE}`));

// ---- sweep modes -----------------------------------------------------------
// Axis value arrays list the shipped baseline FIRST, so the ranking can prefer
// the least-disruptive combo on ties. Scale axes multiply the baseline value.
const MODES = {
  order: {
    title: "pacing de pedidos",
    axes: { spawnScale: [1.0, 1.5, 2.0], timeBase: [22, 32, 42], expirePenalty: [60, 30] },
    headers: ["spawn×", "timeBase", "expirePen"],
    patch: (c, b) => ({
      ORDER: {
        spawnStart: +(b.ORDER.spawnStart * c.spawnScale).toFixed(2),
        spawnEnd: +(b.ORDER.spawnEnd * c.spawnScale).toFixed(2),
        timeBase: c.timeBase,
        expirePenalty: c.expirePenalty,
      },
    }),
    label: (c) => `spawn×${c.spawnScale} time=${c.timeBase} pen=${c.expirePenalty}`,
    rec: (r, b) => `\`spawnScale ${r.spawnScale}\` · \`ORDER.timeBase ${r.timeBase}\` · \`ORDER.expirePenalty ${r.expirePenalty}\``,
  },
  production: {
    title: "economia de cultivo (crescimento + vida)",
    // growthScale < 1 = matura mais rápido; lifeScale > 1 = seca mais devagar
    // (menos idas ao poço, dá pra cuidar de mais canteiros).
    axes: { growthScale: [1.0, 0.75, 0.5], lifeScale: [1.0, 1.5, 2.0] },
    headers: ["growth×", "life×", "(growthBase)", "(lifeBase)"],
    extra: (c, b) => [+(b.TUNE.growthBase * c.growthScale).toFixed(3), +(b.TUNE.lifeBase * c.lifeScale).toFixed(3)],
    patch: (c, b) => ({
      TUNE: {
        growthBase: +(b.TUNE.growthBase * c.growthScale).toFixed(3),
        lifeBase: +(b.TUNE.lifeBase * c.lifeScale).toFixed(3),
      },
    }),
    label: (c) => `growth×${c.growthScale} life×${c.lifeScale}`,
    rec: (r, b) => `\`growthScale ${r.growthScale}\` (TUNE.growthBase ${+(b.TUNE.growthBase * r.growthScale).toFixed(3)}) · \`lifeScale ${r.lifeScale}\` (TUNE.lifeBase ${+(b.TUNE.lifeBase * r.lifeScale).toFixed(3)})`,
  },
};

const M = MODES[MODE];
if (!M) { console.error(`Modo desconhecido: ${MODE}. Use 'order' ou 'production'.`); process.exit(1); }
const AXIS_KEYS = Object.keys(M.axes);

function product() {
  let combos = [{}];
  for (const [key, vals] of Object.entries(M.axes)) {
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

  const baseline = await page.evaluate(() => ({
    ORDER: { ...window.__OG__.ORDER }, ROUND: { ...window.__OG__.ROUND }, TUNE: { ...window.__OG__.TUNE },
  }));

  const combos = product();
  console.log(`Sweep [${MODE}: ${M.title}] — ${combos.length} combos × ${SEEDS.length} seeds (dificuldade ${PLAYERS})…\n`);

  const results = [];
  for (const combo of combos) {
    const patch = M.patch(combo, baseline);
    const runs = [];
    for (const seed of SEEDS) {
      const m = await page.evaluate(({ patch, players, seed }) => {
        if (patch.ORDER) Object.assign(window.__OG__.ORDER, patch.ORDER);
        if (patch.TUNE) Object.assign(window.__OG__.TUNE, patch.TUNE);
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
    console.log(`${M.label(combo)} -> score=${agg.meanScore} stars=${agg.avgStars} exp=${agg.expired} deaths=${agg.deaths}${agg.inBand ? "  ✓band" : ""}`);
  }

  await browser.close();
  server.close();

  // Rank: in-band first, then closeness to TARGET, higher score, and finally the
  // least-disruptive combo (axis values nearest the shipped baseline = index 0).
  const dev = (c) => AXIS_KEYS.reduce((s, k) => s + M.axes[k].indexOf(c[k]), 0);
  const ranked = [...results].sort((a, b) =>
    (b.inBand - a.inBand) ||
    (Math.abs(a.avgStars - TARGET) - Math.abs(b.avgStars - TARGET)) ||
    (b.meanScore - a.meanScore) ||
    (dev(a) - dev(b))
  );
  const rec = ranked[0];
  const baselineCombo = results.find((r) => AXIS_KEYS.every((k) => r[k] === M.axes[k][0]));

  const ceiling = Math.max(...results.map((r) => r.meanScore));
  const suggestedStars = [Math.round(ceiling * 0.5), Math.round(ceiling * 0.8), Math.round(ceiling * 1.05)];

  // ---- report --------------------------------------------------------------
  const md = [];
  md.push(`# Tuning sweep — modo \`${MODE}\` (${M.title})`);
  md.push("");
  md.push(`Dificuldade ${PLAYERS} · ${SEEDS.length} seeds/combo · faixa-alvo **${BAND[0]}–${BAND[1]}★** (ideal ${TARGET}).`);
  md.push(`Metas de estrela: ${baseline.ROUND.stars.join(" / ")} · round ${baseline.ROUND.duration}s.`);
  if (baselineCombo) md.push(`**Baseline atual** (sem mudança): score **${baselineCombo.meanScore}** · ${baselineCombo.avgStars}★ · ${baselineCombo.expired} perdidos · ${baselineCombo.deaths} mortas.`);
  md.push("");

  md.push(`## Recomendação`);
  if (rec.inBand) {
    const gain = baselineCombo ? ` (baseline: ${baselineCombo.meanScore} / ${baselineCombo.avgStars}★)` : "";
    md.push(`${M.rec(rec, baseline)} → **${rec.avgStars}★**, score ${rec.meanScore}, ${rec.expired} perdidos${gain}.`);
  } else {
    md.push(`Nenhum combo entrou na faixa ${BAND[0]}–${BAND[1]}★. Melhor aproximação: ${M.rec(rec, baseline)} → ${rec.avgStars}★ (score ${rec.meanScore}). Considere combinar com o outro modo ou baixar \`ROUND.stars\`.`);
  }
  md.push("");

  md.push(`## Teto de score`);
  md.push(`Maior score médio no sweep: **${ceiling}** (baseline ${baselineCombo ? baselineCombo.meanScore : "?"}). Meta de 1★: **${baseline.ROUND.stars[0]}**.`);
  if (ceiling < baseline.ROUND.stars[0]) {
    md.push(`> ⚠️ Teto abaixo de 1★. Sugestão de metas: \`ROUND.stars = [${suggestedStars.join(", ")}]\`, ou combinar com o modo \`order\`/co-op.`);
  }
  md.push("");

  const head = ["#", ...M.headers, "score méd", "★ méd", "entreg", "perdidos", "mortas", "faixa"];
  md.push(`## Ranking`);
  md.push(`| ${head.join(" | ")} |`);
  md.push(`| ${head.map(() => "---").join(" | ")} |`);
  ranked.forEach((r, i) => {
    const extra = M.extra ? M.extra(r, baseline) : [];
    const cells = [i + 1, ...AXIS_KEYS.map((k) => r[k]), ...extra, r.meanScore, r.avgStars, r.delivered, r.expired, r.deaths, r.inBand ? "✅" : ""];
    md.push(`| ${cells.join(" | ")} |`);
  });

  await writeFile(path.join(OUT, "sweep.json"), JSON.stringify({ mode: MODE, players: PLAYERS, seeds: SEEDS, target: TARGET, band: BAND, baseline, axes: M.axes, ceiling, suggestedStars, baselineCombo, ranked }, null, 2));
  await writeFile(path.join(OUT, "sweep.md"), md.join("\n"));
  console.log(`\nWrote sweep report to ${OUT}`);
  console.log(rec.inBand
    ? `Recommended [${MODE}]: ${M.label(rec)} -> ${rec.avgStars}★ (score ${rec.meanScore}, baseline ${baselineCombo ? baselineCombo.meanScore : "?"})`
    : `No combo in band; best ${rec.avgStars}★ at ${M.label(rec)} (score ${rec.meanScore})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
