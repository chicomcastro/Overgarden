// Overgarden — authoritative co-op server.
//
// Rooms each hold one authoritative Sim state, stepped at a fixed tick from the
// intents clients send. Snapshots are broadcast to all clients, which render
// them. Portable: a plain Node + `ws` process (Fly/Render/Railway); the room
// logic is host-agnostic so it can be ported to e.g. Cloudflare DO later.
//
// Protocol (JSON):
//   C->S: {t:"create",count,difficulty} {t:"join",room} {t:"start"}
//         {t:"intent",intent} {t:"setup",count,difficulty} {t:"leave"}
//   S->C: {t:"joined",room,slot,count,difficulty,host} {t:"lobby",...}
//         {t:"snapshot",seq,s} {t:"ended",result} {t:"error",msg} {t:"peer",...}
import { WebSocketServer } from "ws";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as Sim from "../web/sim.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "8787", 10);
const TICK_HZ = 30, DT = 1 / TICK_HZ, BROADCAST_EVERY = 2; // ~15Hz snapshots

// Plant data (name+rarity drive gameplay; sprite fields ride along, unused here).
const atlas = JSON.parse(await readFile(path.resolve(HERE, "../web/assets/atlas.json"), "utf8"));
Sim.setPlants(Sim.buildPlants(atlas));

// Campaign levels, so the host can pick a stage for the online round.
const LEVELS = JSON.parse(await readFile(path.resolve(HERE, "../web/assets/levels.json"), "utf8")).levels || [];
const LEVEL_BY_ID = new Map(LEVELS.map((l) => [l.id, l]));

const rooms = new Map();
const code = () => { let c = ""; for (let i = 0; i < 4; i++) c += "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]; return c; };

function makeRoom(count, difficulty, levelId) {
  let room;
  do { room = code(); } while (rooms.has(room));
  const level = LEVEL_BY_ID.get(levelId) || null;
  const r = { room, count: Math.max(1, Math.min(4, count)), difficulty: Math.max(1, Math.min(4, difficulty)), level, clients: new Map(), intents: {}, state: null, started: false, seq: 0, tickN: 0, timer: null };
  rooms.set(room, r);
  return r;
}

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
function broadcast(r, msg) { for (const ws of r.clients.values()) send(ws, msg); }

function freeSlot(r) { for (let i = 0; i < r.count; i++) if (!r.clients.has(i)) return i; return -1; }

function lobby(r) {
  broadcast(r, { t: "lobby", room: r.room, count: r.count, difficulty: r.difficulty, level: r.level ? r.level.name : null, started: r.started, slots: [...r.clients.keys()].sort() });
}

// Serialize the minimal state clients need to render (plants by name).
function serialize(st) {
  return {
    time: st.time, score: st.score, combo: st.combo, over: st.over, result: st.result,
    goals: Sim.starGoals(st), playerCount: st.playerCount, weather: st.weather,
    levelName: st.levelName, plantPool: st.plantPool.map((p) => p.name),
    stations: st.stations.map((x) => ({ type: x.type, x: x.x, y: x.y, label: x.label, icon: x.icon })),
    players: st.players.map((p) => ({ index: p.index, color: p.color, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, facing: p.facing, moving: p.moving, holding: p.holding, heldSeed: p.heldSeed ? p.heldSeed.name : null, heldPlant: p.heldPlant ? p.heldPlant.name : null, stamina: Math.round(p.stamina), anim: Math.round(p.anim * 100) / 100, seedMenu: { open: p.seedMenu.open, index: p.seedMenu.index } })),
    plots: st.plots.map((pl) => ({ x: pl.x, y: pl.y, stage: pl.stage, progress: Math.round(pl.progress * 1000) / 1000, life: Math.round(pl.life * 1000) / 1000, wilt: Math.round(pl.wilt * 100) / 100, plant: pl.plant ? pl.plant.name : null })),
    orders: st.orders.map((o) => ({ id: o.id, need: o.need, qty: o.qty, timeLeft: Math.round(o.timeLeft * 100) / 100, maxTime: o.maxTime, plant: o.plant.name, boss: o.boss || false })),
    events: st.events.slice(),
  };
}

function startRoom(r) {
  if (r.started) return;
  r.state = Sim.createState({ playerCount: r.count, difficulty: r.difficulty, seed: (Math.random() * 1e9) | 0, level: r.level });
  r.started = true; r.tickN = 0;
  lobby(r);
  r.timer = setInterval(() => {
    const st = r.state;
    const intents = [];
    for (let i = 0; i < r.count; i++) intents[i] = r.intents[i] || Sim.ZERO_INTENT();
    Sim.step(st, intents, DT);
    // Edges fire once: clear them after applying.
    for (let i = 0; i < r.count; i++) { const it = r.intents[i]; if (it) { it.interact = it.drop = it.confirm = it.navL = it.navR = false; } }
    r.tickN++;
    if (r.tickN % BROADCAST_EVERY === 0 || st.over) {
      broadcast(r, { t: "snapshot", seq: r.seq++, s: serialize(st) });
      st.events.length = 0;
    }
    if (st.over) { clearInterval(r.timer); r.timer = null; broadcast(r, { t: "ended", result: st.result }); }
  }, 1000 / TICK_HZ);
}

function leave(ws) {
  const r = ws._room && rooms.get(ws._room);
  if (!r) return;
  r.clients.delete(ws._slot);
  delete r.intents[ws._slot];
  broadcast(r, { t: "peer", left: ws._slot });
  if (r.clients.size === 0) { if (r.timer) clearInterval(r.timer); rooms.delete(r.room); }
  else lobby(r);
}

const wss = new WebSocketServer({ port: PORT });
wss.on("connection", (ws) => {
  ws.on("message", (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.t === "create") {
      const r = makeRoom(m.count || 1, m.difficulty || 1, m.levelId);
      r.clients.set(0, ws); ws._room = r.room; ws._slot = 0;
      send(ws, { t: "joined", room: r.room, slot: 0, count: r.count, difficulty: r.difficulty, host: true });
      lobby(r);
    } else if (m.t === "join") {
      const r = rooms.get((m.room || "").toUpperCase());
      if (!r) return send(ws, { t: "error", msg: "Sala não encontrada" });
      const slot = freeSlot(r); // mid-game join allowed (drop-in / reconnect)
      if (slot < 0) return send(ws, { t: "error", msg: "Sala cheia" });
      r.clients.set(slot, ws); ws._room = r.room; ws._slot = slot;
      send(ws, { t: "joined", room: r.room, slot, count: r.count, difficulty: r.difficulty, host: false, started: r.started });
      lobby(r);
    } else if (m.t === "setup") {
      const r = rooms.get(ws._room);
      if (r && ws._slot === 0 && !r.started) { if (m.count) r.count = Math.max(1, Math.min(4, m.count)); if (m.difficulty) r.difficulty = Math.max(1, Math.min(4, m.difficulty)); lobby(r); }
    } else if (m.t === "start") {
      const r = rooms.get(ws._room);
      if (r && ws._slot === 0) startRoom(r);
    } else if (m.t === "intent") {
      const r = rooms.get(ws._room);
      if (r && m.intent) r.intents[ws._slot] = m.intent;
    } else if (m.t === "leave") {
      leave(ws);
    }
  });
  ws.on("close", () => leave(ws));
  ws.on("error", () => {});
});

console.log(`Overgarden co-op server on ws://0.0.0.0:${PORT}`);
