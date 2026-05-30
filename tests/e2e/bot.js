"use strict";
/*
 * Overgarden autoplayer — a heuristic bot that "plays" a headless round so the
 * e2e harness can produce comparable balancing data and visual evidence.
 *
 * It drives the game through the SAME input path a human uses: it sets the
 * exposed `keys` / `justPressed` maps each frame, then the harness advances one
 * deterministic tick. Movement therefore happens at real game speed, so the
 * data reflects whether a competent player can physically keep up with the
 * current tuning — which is exactly what we want to rebalance against.
 *
 * The policy is intentionally simple and stable (not optimal): consistency
 * matters more than skill so that score deltas between tuning changes are
 * attributable to the tuning, not to bot variance.
 *
 * Injected into the page by run.mjs; attaches window.__OG_BOT__.
 */
(function () {
  const MOVE_KEYS = ["w", "a", "s", "d", "shift", "e", "q"];

  const bot = {
    wantSeedIndex: 0,

    // Reset every frame; held movement keys must be re-asserted each tick
    // because tick() only clears the one-shot justPressed map.
    _clear(OG) {
      for (const k of MOVE_KEYS) OG.keys[k] = false;
    },
    _press(OG, k) {
      OG.keys[k] = true;
      OG.justPressed[k] = true;
    },
    _moveToward(OG, p, tx, ty, run) {
      if (ty - p.y < -6) OG.keys.w = true;
      else if (ty - p.y > 6) OG.keys.s = true;
      if (tx - p.x < -6) OG.keys.a = true;
      else if (tx - p.x > 6) OG.keys.d = true;
      if (run && p.stamina > 25) OG.keys.shift = true;
    },

    decide(OG) {
      const g = OG.game;
      if (!g || OG.gameState !== "playing" || g.paused) return;
      this._clear(OG);
      const P = g.player;
      const H = OG.HOLD, S = OG.STAGE;

      // --- Seed menu: navigate to the wanted plant, then select it. ---
      if (g.seedMenu.open) {
        if (g.seedMenu.index < this.wantSeedIndex) this._press(OG, "d");
        else if (g.seedMenu.index > this.wantSeedIndex) this._press(OG, "a");
        else this._press(OG, "e");
        return;
      }

      const station = (type) => g.stations.find((s) => s.type === type);
      const d2 = (x, y) => Math.hypot(P.x - x, P.y - y);
      const growing = (pl) => pl.stage >= S.SMALL && pl.stage < S.READY;
      const reach = OG.TUNE.interactRadius * 0.7;

      // Pick the nearest plot matching a predicate.
      const pickPlot = (pred) => {
        let best = null, bd = Infinity;
        for (const pl of g.plots) {
          if (!pred(pl)) continue;
          const d = d2(pl.x, pl.y);
          if (d < bd) { bd = d; best = pl; }
        }
        return best;
      };

      const orderNeed = (name) =>
        g.orders.filter((o) => o.plant.name === name && o.need > 0)
          .reduce((a, o) => a + o.need, 0);

      // Go to a fixed point; interact (press e) once within reach. Far => run.
      const goTo = (x, y, prep) => {
        if (d2(x, y) > reach) { this._moveToward(OG, P, x, y, d2(x, y) > 200); }
        else { if (prep) prep(); this._press(OG, "e"); }
      };
      const goToPlot = (pl, prep) => goTo(pl.x, pl.y, prep);

      // --- Act on what we're already holding (finish the sub-goal). ---
      if (P.holding === H.PLANT) { goTo(station("sales").x, station("sales").y); return; }
      if (P.holding === H.TOOL) {
        // Reclaim dead plots first — they block capacity until cleared.
        const pl = pickPlot((x) => x.stage === S.DIED) || pickPlot((x) => x.stage === S.VIRGIN);
        if (pl) goToPlot(pl); else this._press(OG, "q");
        return;
      }
      if (P.holding === H.WATER) {
        const pl = pickPlot((x) => growing(x) && (x.wilt > 0 || x.life < 0.6));
        if (pl) goToPlot(pl); else this._press(OG, "q");
        return;
      }
      if (P.holding === H.SEED) {
        const pl = pickPlot((x) => x.stage === S.TREATED);
        if (pl) goToPlot(pl); else this._press(OG, "q");
        return;
      }

      // --- Hands empty: choose the highest-value thing to start. ---
      // Cap concurrent crops to what one runner can keep watered, so the bot
      // doesn't over-plant and let everything wilt — a skilled player paces.
      const GROW_CAP = 1;
      const growingCount = g.plots.filter(growing).length;

      // 1) Rescue a wilting plant (reversible, but about to die) — top priority.
      const wilting = pickPlot((x) => growing(x) && x.wilt > 0);
      if (wilting) { goTo(station("water").x, station("water").y); return; }

      // 2) Harvest a ready plant that an order wants (turns into a delivery).
      const ready = pickPlot((x) => x.stage === S.READY && orderNeed(x.plant.name) > 0);
      if (ready) { goToPlot(ready); return; }

      // 3) Preventive watering of the thirstiest crop before it wilts.
      const thirsty = pickPlot((x) => growing(x) && x.life < 0.5);
      if (thirsty) { goTo(station("water").x, station("water").y); return; }

      // 4) Clear a dead plot to free capacity (needs the tool).
      const dead = pickPlot((x) => x.stage === S.DIED);
      if (dead) { goTo(station("tool").x, station("tool").y); return; }

      // 5) Build supply for the most urgent order lacking grown stock — but only
      //    up to the cap, so we can sustain watering.
      const supply = (name) =>
        g.plots.filter((x) => (growing(x) || x.stage === S.READY) && x.plant && x.plant.name === name).length;
      const unmet = g.orders
        .filter((o) => o.need > supply(o.plant.name))
        .sort((a, b) => a.timeLeft - b.timeLeft)[0];
      const treated = pickPlot((x) => x.stage === S.TREATED);
      const virgin = pickPlot((x) => x.stage === S.VIRGIN);

      if (growingCount < GROW_CAP && unmet) {
        if (treated) {
          this.wantSeedIndex = OG.PLANTS.findIndex((p) => p.name === unmet.plant.name);
          goTo(station("seed").x, station("seed").y);
          return;
        }
        if (virgin) { goTo(station("tool").x, station("tool").y); return; }
      }

      // 6) Idle: prime one treated plot so planting is instant when an order lands.
      if (growingCount < GROW_CAP && !treated && virgin) {
        goTo(station("tool").x, station("tool").y);
      }
    },
  };

  window.__OG_BOT__ = bot;
})();
