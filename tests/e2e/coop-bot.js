"use strict";
/*
 * Co-op autoplayer — drives N player slots for headless balancing of co-op
 * tuning. Same heuristic as the solo bot, but it emits an `intent` per player
 * (not keyboard) and players claim plots so they divide labour instead of all
 * piling onto the same crop.
 *
 * Discrete actions (interact / menu nav / confirm) are pulsed with a per-player
 * cooldown so a held intent doesn't spam the action every tick.
 *
 * Injected by coop.mjs; attaches window.__OG_COOPBOT__.intents(OG) -> intent[].
 */
(function () {
  const ZERO = () => ({ mx: 0, my: 0, run: false, interact: false, drop: false, navL: false, navR: false, confirm: false });
  const state = {}; // per-player: { cd, navCd, wantSeed }

  function st(i) { return state[i] || (state[i] = { cd: 0, navCd: 0, wantSeed: 0 }); }

  window.__OG_COOPBOT__ = {
    reset() { for (const k in state) delete state[k]; },
    intents(OG) {
      const g = OG.game;
      if (!g) return [];
      const H = OG.HOLD, S = OG.STAGE;
      const reach = OG.TUNE.interactRadius * 0.7;
      const growing = (pl) => pl.stage >= S.SMALL && pl.stage < S.READY;
      const station = (t) => g.stations.find((s) => s.type === t);
      const orderNeed = (name) => g.orders.filter((o) => o.plant.name === name && o.need > 0).reduce((a, o) => a + o.need, 0);
      const claimed = new Set(); // plot indices taken by earlier players this tick
      const out = [];

      for (let i = 0; i < g.players.length; i++) {
        const p = g.players[i], s = st(i);
        if (s.cd > 0) s.cd--;
        if (s.navCd > 0) s.navCd--;
        const it = ZERO();
        const d2 = (x, y) => Math.hypot(p.x - x, p.y - y);

        // --- Seed menu: navigate to wanted plant, then confirm (pulsed). ---
        if (p.seedMenu.open) {
          if (s.navCd <= 0 && p.seedMenu.index !== s.wantSeed) {
            if (p.seedMenu.index < s.wantSeed) it.navR = true; else it.navL = true;
            s.navCd = 4;
          } else if (p.seedMenu.index === s.wantSeed && s.cd <= 0) {
            it.confirm = true; s.cd = 6;
          }
          out.push(it);
          continue;
        }

        // Nearest plot matching pred that isn't already claimed this tick.
        const pickPlot = (pred) => {
          let best = -1, bd = Infinity;
          for (let k = 0; k < g.plots.length; k++) {
            if (claimed.has(k) || !pred(g.plots[k])) continue;
            const d = d2(g.plots[k].x, g.plots[k].y);
            if (d < bd) { bd = d; best = k; }
          }
          return best;
        };

        // Move toward (x,y); when in reach, pulse interact. Returns true if acting.
        const go = (x, y) => {
          const d = d2(x, y);
          if (d > reach) {
            const dx = x - p.x, dy = y - p.y;
            it.mx = Math.abs(dx) < 6 ? 0 : Math.max(-1, Math.min(1, dx / 40));
            it.my = Math.abs(dy) < 6 ? 0 : Math.max(-1, Math.min(1, dy / 40));
            it.run = d > 200 && p.stamina > 25;
            return false;
          }
          if (s.cd <= 0) { it.interact = true; s.cd = 6; }
          return true;
        };
        const goPlot = (k) => { claimed.add(k); return go(g.plots[k].x, g.plots[k].y); };

        // --- Act on held item. ---
        if (p.holding === H.PLANT) { go(station("sales").x, station("sales").y); out.push(it); continue; }
        if (p.holding === H.TOOL) {
          const k = pickPlot((x) => x.stage === S.DIED); const k2 = k >= 0 ? k : pickPlot((x) => x.stage === S.VIRGIN);
          if (k2 >= 0) goPlot(k2); else if (s.cd <= 0) { it.drop = true; s.cd = 6; }
          out.push(it); continue;
        }
        if (p.holding === H.WATER) {
          const k = pickPlot((x) => growing(x) && (x.wilt > 0 || x.life < 0.6));
          if (k >= 0) goPlot(k); else if (s.cd <= 0) { it.drop = true; s.cd = 6; }
          out.push(it); continue;
        }
        if (p.holding === H.SEED) {
          const k = pickPlot((x) => x.stage === S.TREATED);
          if (k >= 0) goPlot(k); else if (s.cd <= 0) { it.drop = true; s.cd = 6; }
          out.push(it); continue;
        }

        // --- Hands empty: pick the highest-value task (unclaimed). ---
        const wilting = pickPlot((x) => growing(x) && x.wilt > 0);
        if (wilting >= 0) { claimed.add(wilting); go(station("water").x, station("water").y); out.push(it); continue; }
        const ready = pickPlot((x) => x.stage === S.READY && orderNeed(x.plant.name) > 0);
        if (ready >= 0) { goPlot(ready); out.push(it); continue; }
        const thirsty = pickPlot((x) => growing(x) && x.life < 0.5);
        if (thirsty >= 0) { claimed.add(thirsty); go(station("water").x, station("water").y); out.push(it); continue; }
        const dead = pickPlot((x) => x.stage === S.DIED);
        if (dead >= 0) { claimed.add(dead); go(station("tool").x, station("tool").y); out.push(it); continue; }

        // Build supply for the most urgent under-supplied order.
        const supply = (name) => g.plots.filter((x) => (growing(x) || x.stage === S.READY) && x.plant && x.plant.name === name).length;
        const unmet = g.orders.filter((o) => o.need > supply(o.plant.name)).sort((a, b) => a.timeLeft - b.timeLeft)[0];
        const treated = pickPlot((x) => x.stage === S.TREATED);
        const virgin = pickPlot((x) => x.stage === S.VIRGIN);
        if (unmet) {
          if (treated >= 0) { claimed.add(treated); s.wantSeed = OG.PLANTS.findIndex((q) => q.name === unmet.plant.name); go(station("seed").x, station("seed").y); out.push(it); continue; }
          if (virgin >= 0) { claimed.add(virgin); go(station("tool").x, station("tool").y); out.push(it); continue; }
        }
        if (treated >= 0) { claimed.add(treated); s.wantSeed = 0; go(station("seed").x, station("seed").y); out.push(it); continue; }
        if (virgin >= 0) { claimed.add(virgin); go(station("tool").x, station("tool").y); out.push(it); continue; }

        out.push(it); // idle
      }
      return out;
    },
  };
})();
