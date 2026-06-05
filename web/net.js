"use strict";
/*
 * Client networking for online co-op. Connects to the authoritative server,
 * sends this device's intent each frame, and turns incoming snapshots into a
 * sim-shaped render state (plants by name -> objects) that the existing
 * renderer can draw unchanged.
 *
 * The local client never steps the sim — the server is authoritative.
 */
import * as Sim from "./sim.js";

let STATIONS = null;
function stations() { if (!STATIONS) STATIONS = Sim.createState({ playerCount: 1 }).stations; return STATIONS; }
let _byName = null;
function plant(name) {
  if (!name) return null;
  if (!_byName) { _byName = new Map(); for (const p of Sim.PLANTS) _byName.set(p.name, p); }
  return _byName.get(name) || null;
}

const INTERP_DELAY = 120; // ms render lag for smoothing 15Hz snapshots
const lerp = (a, b, t) => a + (b - a) * t;

export const Net = {
  ws: null, url: null,
  room: null, slot: -1, host: false, count: 1, difficulty: 1,
  phase: "menu", // menu | lobby | playing | result
  slots: [], lastSnapshot: null, result: null, error: null,
  buffer: [], intentionalClose: false,
  on: {}, // callbacks: lobby, joined, snapshot, ended, error, close

  connect(url) {
    this.url = url; this.intentionalClose = false; this.buffer = [];
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => { if (this.on.error) this.on.error("conexão falhou"); reject(e); };
      ws.onclose = () => {
        const wasInGame = this.phase === "playing" || this.phase === "lobby";
        const intentional = this.intentionalClose;
        this.ws = null; this.phase = "menu";
        if (this.on.close) this.on.close({ intentional, wasInGame, room: this.room });
      };
      ws.onmessage = (ev) => this._recv(JSON.parse(ev.data));
    });
  },
  _send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  create(count, difficulty, levelId) { this._send({ t: "create", count, difficulty, levelId }); },
  join(room) { this._send({ t: "join", room: (room || "").toUpperCase() }); },
  setup(count, difficulty) { this._send({ t: "setup", count, difficulty }); },
  start() { this._send({ t: "start" }); },
  sendIntent(intent) { this._send({ t: "intent", intent }); },
  leave() { this.intentionalClose = true; this._send({ t: "leave" }); },
  close() { this.intentionalClose = true; if (this.ws) try { this.ws.close(); } catch (_) {} },

  _recv(m) {
    if (m.t === "joined") {
      this.room = m.room; this.slot = m.slot; this.host = m.host; this.count = m.count; this.difficulty = m.difficulty;
      this.phase = "lobby"; this.error = null;
      if (this.on.joined) this.on.joined(m);
    } else if (m.t === "lobby") {
      this.count = m.count; this.difficulty = m.difficulty; this.slots = m.slots; this.levelName = m.level;
      if (!m.started) this.phase = "lobby";
      if (this.on.lobby) this.on.lobby(m);
    } else if (m.t === "snapshot") {
      this.lastSnapshot = m.s; this.phase = m.s.over ? "result" : "playing";
      this.buffer.push({ t: (typeof performance !== "undefined" ? performance.now() : Date.now()), s: m.s });
      if (this.buffer.length > 16) this.buffer.shift();
      if (this.on.snapshot) this.on.snapshot(m.s);
    } else if (m.t === "ended") {
      this.result = m.result; this.phase = "result";
      if (this.on.ended) this.on.ended(m.result);
    } else if (m.t === "error") {
      this.error = m.msg; if (this.on.error) this.on.error(m.msg);
    } else if (m.t === "peer") {
      if (this.on.peer) this.on.peer(m);
    }
  },

  // Reconstruct a sim-shaped state so render() works. Interpolates positions
  // between the two snapshots straddling (now - INTERP_DELAY) for smoothness.
  renderState() {
    if (!this.lastSnapshot) return null;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) - INTERP_DELAY;
    let prev = null, base = this.lastSnapshot, alpha = 0;
    if (this.buffer.length >= 2) {
      let lo = null, hi = null;
      for (const b of this.buffer) { if (b.t <= now) lo = b; else { hi = b; break; } }
      if (lo && hi) { prev = lo.s; base = hi.s; alpha = (now - lo.t) / ((hi.t - lo.t) || 1); }
      else base = this.buffer[this.buffer.length - 1].s; // not enough lead: latest
    }
    const s = base;
    const pp = prev && prev.players, qp = prev && prev.plots, qo = prev && prev.orders;
    return {
      time: s.time, score: s.score, combo: s.combo, playerCount: s.playerCount,
      over: s.over, result: s.result, levelName: s.levelName, weather: s.weather,
      plantPool: s.plantPool ? s.plantPool.map(plant).filter(Boolean) : null,
      particles: [], floaters: [], shake: 0, anyMoving: false,
      stations: s.stations || stations(),
      players: s.players.map((p, i) => {
        const q = pp && pp[i];
        return { ...p, x: q ? lerp(q.x, p.x, alpha) : p.x, y: q ? lerp(q.y, p.y, alpha) : p.y, anim: q ? lerp(q.anim, p.anim, alpha) : p.anim, heldSeed: plant(p.heldSeed), heldPlant: plant(p.heldPlant) };
      }),
      plots: s.plots.map((pl, i) => {
        const q = qp && qp[i];
        const progress = q && q.stage === pl.stage ? lerp(q.progress, pl.progress, alpha) : pl.progress;
        const life = q ? lerp(q.life, pl.life, alpha) : pl.life;
        return { ...pl, progress, life, plant: plant(pl.plant) };
      }),
      orders: s.orders.map((o) => {
        const q = qo && qo.find((x) => x.id === o.id);
        return { ...o, timeLeft: q ? lerp(q.timeLeft, o.timeLeft, alpha) : o.timeLeft, plant: plant(o.plant) };
      }),
      events: this.lastSnapshot.events || [],
    };
  },
};
