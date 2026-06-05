"use strict";
/*
 * In-page harness: starts a headless round, drives the bot, and accumulates
 * balancing metrics by diffing game state every tick. Runs inside the browser
 * so a full 150s round costs a handful of cross-process calls, not thousands.
 *
 * Injected by run.mjs; attaches window.__OG_HARNESS__.
 */
(function () {
  const DT = 1 / 30; // fixed timestep — deterministic round length
  let M = null;      // metrics accumulator
  let prev = null;   // previous-tick snapshot for event detection

  function snap(OG) {
    const g = OG.game, S = OG.STAGE;
    return {
      score: g.score,
      delivered: g.stats.delivered,
      expired: g.stats.expired,
      px: g.player.x, py: g.player.y,
      plots: g.plots.map((p) => ({ stage: p.stage, life: p.life })),
      growing: (st) => st >= S.SMALL && st < S.READY,
    };
  }

  function init(OG) {
    const g = OG.game;
    M = {
      ticks: 0,
      deaths: 0, waters: 0, harvests: 0, treats: 0, plants: 0,
      distance: 0, idleTicks: 0,
      hold: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, // ticks per HOLD state
      maxCombo: 0,
      activeOrdersSum: 0,
      series: [],
    };
    prev = snap(OG);
    sample(OG, true); // t=0 baseline
  }

  function sample(OG, force) {
    const g = OG.game, S = OG.STAGE;
    const elapsed = (g.duration || OG.ROUND.duration) - g.time;
    const last = M.series[M.series.length - 1];
    if (!force && last && elapsed - last.t < 1) return; // ~1s cadence
    const grow = g.plots.filter((p) => p.stage >= S.SMALL && p.stage < S.READY);
    const avgLife = grow.length ? grow.reduce((a, p) => a + p.life, 0) / grow.length : 1;
    M.series.push({
      t: +elapsed.toFixed(1),
      score: g.score,
      orders: g.orders.length,
      combo: g.combo,
      growing: grow.length,
      ready: g.plots.filter((p) => p.stage === S.READY).length,
      dead: g.plots.filter((p) => p.stage === S.DIED).length,
      avgLife: +avgLife.toFixed(3),
      stamina: Math.round(g.player.stamina),
    });
  }

  function observe(OG) {
    const g = OG.game, S = OG.STAGE;
    const cur = snap(OG);
    M.ticks++;
    M.distance += Math.hypot(cur.px - prev.px, cur.py - prev.py);
    if (!g.player.moving) M.idleTicks++;
    M.hold[g.player.holding] = (M.hold[g.player.holding] || 0) + 1;
    if (g.combo > M.maxCombo) M.maxCombo = g.combo;
    M.activeOrdersSum += g.orders.length;

    for (let i = 0; i < cur.plots.length; i++) {
      const a = prev.plots[i], b = cur.plots[i];
      if (a.stage !== S.DIED && b.stage === S.DIED) M.deaths++;
      if (a.stage === S.VIRGIN && b.stage === S.TREATED) M.treats++;
      if (a.stage === S.TREATED && b.stage === S.SMALL) M.plants++;
      if (a.stage === S.READY && b.stage === S.VIRGIN) M.harvests++;
      const grow = b.stage >= S.SMALL && b.stage < S.READY;
      if (grow && b.life - a.life > 0.3) M.waters++; // life reset by watering
    }
    prev = cur;
  }

  window.__OG_HARNESS__ = {
    start({ players = 1, seed = null, levelId = null } = {}) {
      window.__OG__.startHeadless({ players, seed, levelId });
      init(window.__OG__);
      return true;
    },
    // Advance ticks until game.time <= untilTime (or the round ends).
    run({ untilTime = 0, render = false } = {}) {
      const OG = window.__OG__, BOT = window.__OG_BOT__;
      let guard = 20000;
      while (OG.gameState === "playing" && OG.game.time > untilTime && guard-- > 0) {
        BOT.decide(OG);
        OG.tick(DT, render);
        if (OG.gameState === "playing") { observe(OG); sample(OG, false); }
      }
      return { state: OG.gameState, time: OG.game ? OG.game.time : 0 };
    },
    metrics() {
      const OG = window.__OG__, g = OG.game;
      const goals = OG.starGoals ? OG.starGoals() : OG.ROUND.stars;
      const s = g.score;
      const stars = s >= goals[2] ? 3 : s >= goals[1] ? 2 : s >= goals[0] ? 1 : 0;
      const t = Math.max(1, M.ticks);
      return {
        summary: {
          score: s, stars,
          delivered: g.stats.delivered,
          expired: g.stats.expired,
          ordersSpawned: g.orderId - 1,
          deaths: M.deaths, waters: M.waters, harvests: M.harvests,
          treats: M.treats, plants: M.plants,
          maxCombo: M.maxCombo,
          idlePct: +(100 * M.idleTicks / t).toFixed(1),
          distance: Math.round(M.distance),
          avgActiveOrders: +(M.activeOrdersSum / t).toFixed(2),
          holdPct: {
            nothing: +(100 * M.hold[0] / t).toFixed(1),
            seed: +(100 * M.hold[1] / t).toFixed(1),
            water: +(100 * M.hold[2] / t).toFixed(1),
            tool: +(100 * M.hold[3] / t).toFixed(1),
            plant: +(100 * M.hold[4] / t).toFixed(1),
          },
        },
        series: M.series,
      };
    },
  };
})();
