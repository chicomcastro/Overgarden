// Online co-op integration test: boots the authoritative server + serves the
// web build, opens two headless clients, and asserts that create/join/start,
// authoritative sync, server-side continuation after a disconnect, and mid-game
// drop-in all work. Exits non-zero on failure (used by CI and `npm run test:net`).
import { chromium } from "playwright";
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../web");
const SERVER = path.resolve(HERE, "../../server/server.mjs");
const PORT = 8821;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".wav": "audio/wav", ".mp3": "audio/mpeg" };
const fails = [];
function check(name, ok) { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) fails.push(name); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const httpSrv = http.createServer(async (q, s) => {
  try { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(WEB, u === "/" ? "/index.html" : u); const b = await readFile(f); s.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); s.end(b); }
  catch { s.writeHead(404).end(); }
});
await new Promise((r) => httpSrv.listen(0, "127.0.0.1", r));
const httpBase = `http://127.0.0.1:${httpSrv.address().port}`;
const gameSrv = spawn("node", [SERVER], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await sleep(900);
const wsUrl = `ws://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const A = await browser.newPage();
  const B = await browser.newPage();
  for (const p of [A, B]) { await p.goto(`${httpBase}/index.html?debug`); await p.waitForFunction(() => window.__OG__ && window.__OG__.assetsReady(), null, { timeout: 30000 }); }

  // Host creates a room on a chosen campaign stage (Horta Dupla: 6 plots).
  const room = await A.evaluate(async (u) => { await window.__OG_NET__.connectCreate(u, 2, 1, "horta-dupla"); await new Promise((r) => setTimeout(r, 150)); return window.__OG_NET__.state().room; }, wsUrl);
  check("host creates room (4-char code)", typeof room === "string" && room.length === 4);

  await B.evaluate(async (a) => window.__OG_NET__.connectJoin(a.u, a.room), { u: wsUrl, room });
  await sleep(200);
  check("guest joins room", await B.evaluate(() => window.__OG_NET__.state().room) === room);

  await A.evaluate(() => window.__OG_NET__.start());
  await A.waitForFunction(() => window.__OG_NET__.state().phase === "playing", null, { timeout: 8000 });
  await B.waitForFunction(() => window.__OG_NET__.state().phase === "playing", null, { timeout: 8000 });
  check("both clients enter play", true);

  const lvl = await B.evaluate(() => { const s = window.__OG_NET__.state().snapshot; return { name: s.levelName, plots: s.plots.length }; });
  check("host's chosen level propagates online (Horta Dupla, 6 plots)", lvl.name === "Horta Dupla" && lvl.plots === 6);

  await A.keyboard.down("d"); await B.keyboard.down("ArrowLeft");
  await sleep(700);
  await A.keyboard.up("d"); await B.keyboard.up("ArrowLeft");
  await sleep(300);
  const pa = await A.evaluate(() => window.__OG_NET__.state().snapshot.players.map((p) => Math.round(p.x)));
  const pb = await B.evaluate(() => window.__OG_NET__.state().snapshot.players.map((p) => Math.round(p.x)));
  check("authoritative state identical on both clients", JSON.stringify(pa) === JSON.stringify(pb));
  check("P0 moved right and P1 moved left", pa[0] > 490 && pa[1] < 470);

  const t1 = await A.evaluate(() => window.__OG_NET__.state().snapshot.time);
  await B.evaluate(() => window.__OG_NET__.Net.ws.close());
  await sleep(1100);
  const t2 = await A.evaluate(() => window.__OG_NET__.state().snapshot.time);
  check("server keeps running after a client disconnects", t1 > t2);

  await B.evaluate(async (a) => { window.__OG_NET__.Net.on.snapshot = () => {}; await window.__OG_NET__.connectJoin(a.u, a.room); }, { u: wsUrl, room });
  await sleep(600);
  const bs = await B.evaluate(() => window.__OG_NET__.state());
  check("mid-game drop-in / reconnect works", bs.phase === "playing" && !!bs.snapshot);
} finally {
  await browser.close(); httpSrv.close(); gameSrv.kill();
}

if (fails.length) { console.error(`\n${fails.length} check(s) failed: ${fails.join(", ")}`); process.exit(1); }
console.log("\nAll online checks passed.");
