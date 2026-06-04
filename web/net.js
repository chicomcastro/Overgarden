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

export const Net = {
  ws: null, url: null,
  room: null, slot: -1, host: false, count: 1, difficulty: 1,
  phase: "menu", // menu | lobby | playing | result
  slots: [], lastSnapshot: null, result: null, error: null,
  on: {}, // callbacks: lobby, joined, snapshot, ended, error, close

  connect(url) {
    this.url = url;
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => { if (this.on.error) this.on.error("conexão falhou"); reject(e); };
      ws.onclose = () => { this.phase = "menu"; this.ws = null; if (this.on.close) this.on.close(); };
      ws.onmessage = (ev) => this._recv(JSON.parse(ev.data));
    });
  },
  _send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  create(count, difficulty) { this._send({ t: "create", count, difficulty }); },
  join(room) { this._send({ t: "join", room: (room || "").toUpperCase() }); },
  setup(count, difficulty) { this._send({ t: "setup", count, difficulty }); },
  start() { this._send({ t: "start" }); },
  sendIntent(intent) { this._send({ t: "intent", intent }); },
  leave() { this._send({ t: "leave" }); },

  _recv(m) {
    if (m.t === "joined") {
      this.room = m.room; this.slot = m.slot; this.host = m.host; this.count = m.count; this.difficulty = m.difficulty;
      this.phase = "lobby"; this.error = null;
      if (this.on.joined) this.on.joined(m);
    } else if (m.t === "lobby") {
      this.count = m.count; this.difficulty = m.difficulty; this.slots = m.slots;
      if (!m.started) this.phase = "lobby";
      if (this.on.lobby) this.on.lobby(m);
    } else if (m.t === "snapshot") {
      this.lastSnapshot = m.s; this.phase = m.s.over ? "result" : "playing";
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

  // Reconstruct a sim-shaped state from the latest snapshot so render() works.
  renderState() {
    const s = this.lastSnapshot;
    if (!s) return null;
    return {
      time: s.time, score: s.score, combo: s.combo, playerCount: s.playerCount,
      over: s.over, result: s.result,
      particles: [], floaters: [], shake: 0, anyMoving: false,
      stations: stations(),
      players: s.players.map((p) => ({ ...p, heldSeed: plant(p.heldSeed), heldPlant: plant(p.heldPlant) })),
      plots: s.plots.map((pl) => ({ ...pl, plant: plant(pl.plant) })),
      orders: s.orders.map((o) => ({ ...o, plant: plant(o.plant) })),
      events: s.events || [],
    };
  },
};
