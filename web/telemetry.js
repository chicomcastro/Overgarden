"use strict";
/*
 * Lightweight gameplay telemetry. Records round lifecycle events to a local
 * ring buffer (localStorage) and, when an endpoint is configured, also beacons
 * them out — so the same instrumentation powers a local "stats" view now and a
 * real analytics backend once the game is deployed.
 *
 * No PII, no per-tick spam: a handful of events per round (start/end/unlock).
 * Disabled cleanly when localStorage is unavailable.
 */
const KEY = "overgarden.telemetry";
const MAX = 300; // ring buffer cap

export const Telemetry = {
  endpoint: null,
  enabled: true,

  init({ endpoint = null } = {}) { this.endpoint = endpoint; },

  track(event, props = {}) {
    if (!this.enabled) return;
    const e = { event, ts: Date.now(), ...props };
    this._store(e);
    this._beacon(e);
  },

  _store(e) {
    try {
      const all = this.all();
      all.push(e);
      if (all.length > MAX) all.splice(0, all.length - MAX);
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (_) {}
  },
  _beacon(e) {
    if (!this.endpoint) return;
    try {
      const body = JSON.stringify(e);
      if (navigator.sendBeacon) navigator.sendBeacon(this.endpoint, body);
      else fetch(this.endpoint, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
    } catch (_) {}
  },

  all() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (_) { return []; } },
  clear() { try { localStorage.removeItem(KEY); } catch (_) {} },

  // Aggregate round_end events into per-level + overall stats for the UI.
  summary() {
    const ends = this.all().filter((e) => e.event === "round_end");
    const byLevel = {};
    let totalPlays = 0, wins = 0;
    for (const e of ends) {
      const id = e.level || "—";
      const L = byLevel[id] || (byLevel[id] = { name: e.levelName || id, plays: 0, bestScore: 0, bestStars: 0, sumScore: 0, starHist: [0, 0, 0, 0] });
      L.plays++; totalPlays++;
      L.sumScore += e.score || 0;
      L.bestScore = Math.max(L.bestScore, e.score || 0);
      L.bestStars = Math.max(L.bestStars, e.stars || 0);
      L.starHist[e.stars || 0]++;
      if ((e.stars || 0) >= 1) wins++;
    }
    for (const id in byLevel) byLevel[id].avgScore = Math.round(byLevel[id].sumScore / byLevel[id].plays);
    return { totalPlays, wins, byLevel };
  },
};
