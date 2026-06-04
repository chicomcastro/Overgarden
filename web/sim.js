"use strict";
/*
 * Overgarden — pure simulation core (no DOM / canvas / audio).
 *
 * Runs identically in the browser (game.js renders it) and in Node (the
 * authoritative co-op server steps it). All gameplay randomness goes through a
 * per-state seedable RNG so rooms/headless runs are reproducible. Side effects
 * a renderer cares about (sounds, FX bursts) are pushed onto `state.events`;
 * the simulation itself never touches the DOM.
 *
 * ESM module: `import * as Sim from "./sim.js"` (browser) / "../web/sim.js" (server).
 */

export const HOLD = { NOTHING: 0, SEED: 1, WATER: 2, TOOL: 3, PLANT: 4 };
export const STAGE = { VIRGIN: 1, TREATED: 2, SMALL: 3, MEDIUM: 4, GREAT: 5, READY: 6, DIED: 7 };
export const DIFFICULTY_MULT = [4, 3, 2, 1];
export const WORLD = { w: 960, h: 600 };

export const TUNE = {
  normalSpeed: 175, runSpeed: 320, maxStamina: 100, runDrain: 48, walkRegen: 14, idleRegen: 26,
  growthBase: 1.1, lifeBase: 1.3, wiltGrace: 3.0, decayRampMin: 0.6, decayRampMax: 1.3, interactRadius: 72,
};
export const ROUND = { duration: 150, stars: [90, 200, 380] };
export const ORDER = {
  maxConcurrent: 4, baseReward: 70, unitReward: 10, expirePenalty: 60,
  spawnStart: 8, spawnEnd: 4, timeBase: 22, timePerRarity: 9,
  diffTime: [1.5, 1.2, 1.0, 0.8], diffSpawn: [1.3, 1.1, 0.95, 0.8], comboWindow: 12,
};
export const COOP = { spawnScale: [1, 0.72, 0.58, 0.5], concurrentBonus: [0, 2, 3, 4], starScale: [1, 1.8, 2.1, 2.6] };
export const PLAYER_COLORS = ["#ffd24a", "#4ea8ff", "#ff6b6b", "#74e36b"];
export const PLAYER_SPAWN = [[0, 30], [-70, 30], [70, 30], [0, 96]];
export const ZERO_INTENT = () => ({ mx: 0, my: 0, run: false, interact: false, drop: false, navL: false, navR: false, confirm: false });

// Plants list (name + rarity drive gameplay; main/stages ride along for the
// client renderer and are ignored by the server).
export let PLANTS = [];
export function setPlants(list) { PLANTS = list; }
export function buildPlants(atlas) {
  return Object.entries(atlas.plantData)
    .map(([name, d]) => ({ name, rarity: d.rarity, main: d.main, stages: d.stages }))
    .sort((a, b) => a.rarity - b.rarity || a.name.localeCompare(b.name));
}

// Seedable RNG (mulberry32). Module fallback for legacy callers; per-state when
// createState is given a seed (required for independent server rooms).
let _seedRng = null;
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedRng(seed) { _seedRng = makeRng(seed); }
function rng(s) { return s._rng ? s._rng() : (_seedRng ? _seedRng() : Math.random()); }

// ---------------------------------------------------------------------------
function ev(s, snd) { s.events.push(snd); }

export function createState({ playerCount = 1, difficulty = 1, seed = null } = {}) {
  playerCount = Math.max(1, Math.min(4, playerCount));
  difficulty = Math.max(1, Math.min(4, difficulty));
  const plots = [];
  const cols = 3, rows = 2, startX = 300, startY = 215, gapX = 130, gapY = 150;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    plots.push({ x: startX + c * gapX, y: startY + r * gapY, stage: STAGE.VIRGIN, plant: null, progress: 0, life: 1, wilt: 0 });
  }
  const stations = [
    { type: "tool", x: 92, y: 250, label: "Ferramentas", icon: "shovel" },
    { type: "seed", x: 92, y: 420, label: "Sementes", icon: "seed" },
    { type: "water", x: 868, y: 320, label: "Poço", icon: "water" },
    { type: "sales", x: 480, y: 548, label: "Entrega", icon: "bag" },
  ];
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const [ox, oy] = PLAYER_SPAWN[i];
    players.push({
      index: i, color: PLAYER_COLORS[i],
      x: WORLD.w / 2 + ox, y: WORLD.h / 2 + oy,
      speed: 0, stamina: TUNE.maxStamina, facing: "down", moving: false,
      holding: HOLD.NOTHING, heldSeed: null, heldPlant: null, anim: 0, navLatch: false,
      seedMenu: { open: false, index: 0 },
    });
  }
  return {
    _rng: seed != null ? makeRng(seed) : null,
    mult: DIFFICULTY_MULT[difficulty - 1], difficulty, playerCount,
    score: 0, paused: false, over: false, result: null,
    time: ROUND.duration,
    orders: [], orderId: 1, orderSpawnTimer: 3,
    combo: 0, comboTimer: 0,
    stats: { delivered: 0, expired: 0 },
    particles: [], floaters: [], shake: 0, anyMoving: false,
    players, plots, stations,
    events: [],
  };
}

// ---- helpers ---------------------------------------------------------------
export function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
export function roundProgress(s) { return clamp01(1 - s.time / ROUND.duration); }
export function maxConcurrentOrders(s) { return ORDER.maxConcurrent + COOP.concurrentBonus[s.playerCount - 1]; }
export function starGoals(s) { const k = COOP.starScale[s.playerCount - 1]; return ROUND.stars.map((v) => Math.round(v * k)); }
export function stationOf(s, type) { return s.stations.find((x) => x.type === type); }
export function ordersNeeding(s, name) { return s.orders.filter((o) => o.plant.name === name && o.need > 0); }

export function nearestStation(s, p) {
  let best = null, bd = TUNE.interactRadius;
  for (const st of s.stations) { const d = dist(p.x, p.y, st.x, st.y); if (d < bd) { bd = d; best = st; } }
  return best;
}
export function nearestPlot(s, p) {
  let best = null, bd = TUNE.interactRadius;
  for (const pl of s.plots) { const d = dist(p.x, p.y, pl.x, pl.y); if (d < bd) { bd = d; best = pl; } }
  return best;
}
function growthTime(s, plot) { return TUNE.growthBase * plot.plant.rarity * s.mult; }
function lifeTime(s, plot) { return TUNE.lifeBase * plot.plant.rarity * s.mult; }
function decayMult(s) { return lerp(TUNE.decayRampMin, TUNE.decayRampMax, roundProgress(s)); }

// ---- orders ----------------------------------------------------------------
function orderableRarity(s) { const p = roundProgress(s); return p < 0.3 ? 1 : p < 0.6 ? 2 : 3; }
function orderInterval(s) {
  return lerp(ORDER.spawnStart, ORDER.spawnEnd, roundProgress(s)) * ORDER.diffSpawn[s.difficulty - 1] * COOP.spawnScale[s.playerCount - 1];
}
export function spawnOrder(s) {
  if (s.orders.length >= maxConcurrentOrders(s)) return;
  const pool = PLANTS.filter((p) => p.rarity <= orderableRarity(s));
  const plant = pool[Math.floor(rng(s) * pool.length)];
  const p = roundProgress(s);
  let qty = 1;
  if (p > 0.3 && rng(s) < 0.5) qty++;
  if (p > 0.6 && rng(s) < 0.4) qty++;
  const time = (ORDER.timeBase + ORDER.timePerRarity * plant.rarity) * ORDER.diffTime[s.difficulty - 1];
  s.orders.push({ plant, need: qty, qty, timeLeft: time, maxTime: time, id: s.orderId++ });
}

function updateOrders(s, dt) {
  s.orderSpawnTimer -= dt;
  if (s.orderSpawnTimer <= 0) { spawnOrder(s); s.orderSpawnTimer = orderInterval(s); }
  for (const o of s.orders) o.timeLeft -= dt;
  for (let i = s.orders.length - 1; i >= 0; i--) {
    if (s.orders[i].timeLeft <= 0) {
      s.orders.splice(i, 1);
      s.score = Math.max(0, s.score - ORDER.expirePenalty);
      s.combo = 0; s.stats.expired++;
      const st = stationOf(s, "sales");
      spawnParticles(s, st.x, st.y - 12, { n: 12, color: "#e74c3c", speed: 130 });
      spawnFloater(s, st.x, st.y - 30, "-" + ORDER.expirePenalty, "#e74c3c");
      addShake(s, 8); ev(s, "fail");
    }
  }
  if (s.comboTimer > 0) { s.comboTimer -= dt; if (s.comboTimer <= 0) s.combo = 0; }
}

function deliverPlant(s, p) {
  if (p.holding !== HOLD.PLANT || !p.heldPlant) return;
  const st = stationOf(s, "sales");
  const matches = ordersNeeding(s, p.heldPlant.name);
  if (matches.length === 0) { spawnFloater(s, st.x, st.y - 28, "sem pedido!", "#e7a76a"); return; }
  matches.sort((a, b) => a.timeLeft - b.timeLeft);
  const o = matches[0];
  o.need--; s.score += ORDER.unitReward;
  p.holding = HOLD.NOTHING; p.heldPlant = null;
  spawnParticles(s, st.x, st.y - 12, { n: 6, color: "#9fe6ff", speed: 90 }); ev(s, "pickup");
  if (o.need <= 0) completeOrder(s, o);
}

function completeOrder(s, o) {
  const base = ORDER.baseReward * o.plant.rarity * o.qty;
  const tip = Math.round(base * 0.5 * (o.timeLeft / o.maxTime));
  s.combo++; s.comboTimer = ORDER.comboWindow;
  const mult = 1 + 0.1 * Math.min(s.combo - 1, 9);
  const total = Math.round((base + tip) * mult);
  s.score += total; s.stats.delivered++;
  const st = stationOf(s, "sales");
  spawnParticles(s, st.x, st.y - 16, { n: 20, color: "#f7d774", speed: 150 });
  spawnFloater(s, st.x, st.y - 34, "+" + total + (s.combo > 1 ? "  x" + s.combo : ""), "#f7d774");
  addShake(s, 7); ev(s, "ding");
  const idx = s.orders.indexOf(o);
  if (idx >= 0) s.orders.splice(idx, 1);
}

// ---- interactions ----------------------------------------------------------
function handleInteract(s, p, intent) {
  if (intent.drop && p.holding !== HOLD.PLANT) { p.holding = HOLD.NOTHING; p.heldSeed = null; }
  if (!intent.interact) return;
  const st = nearestStation(s, p);
  if (st) { interactStation(s, p, st); return; }
  const plot = nearestPlot(s, p);
  if (plot) interactPlot(s, p, plot);
}
function interactStation(s, p, st) {
  switch (st.type) {
    case "tool": if (p.holding !== HOLD.PLANT) { p.holding = HOLD.TOOL; p.heldSeed = null; ev(s, "pickup"); } break;
    case "water": if (p.holding !== HOLD.PLANT) { p.holding = HOLD.WATER; p.heldSeed = null; ev(s, "pickup"); } break;
    case "seed": if (p.holding !== HOLD.PLANT) p.seedMenu.open = true; break;
    case "sales": deliverPlant(s, p); break;
  }
}
function interactPlot(s, p, plot) {
  if (plot.stage === STAGE.DIED) {
    if (p.holding === HOLD.TOOL) { resetPlot(plot); p.holding = HOLD.NOTHING; ev(s, "pickup"); }
    return;
  }
  if (p.holding === HOLD.TOOL && plot.stage === STAGE.VIRGIN) {
    plot.stage = STAGE.TREATED; plot.life = 1; p.holding = HOLD.NOTHING; ev(s, "pickup");
    spawnParticles(s, plot.x, plot.y, { n: 8, color: "#6b4a2b", speed: 70 }); return;
  }
  if (p.holding === HOLD.SEED && plot.stage === STAGE.TREATED && p.heldSeed) {
    plot.plant = p.heldSeed; plot.stage = STAGE.SMALL; plot.progress = 0; plot.life = 1; plot.wilt = 0;
    p.holding = HOLD.NOTHING; p.heldSeed = null; ev(s, "pickup");
    spawnParticles(s, plot.x, plot.y - 6, { n: 8, color: "#5fd35f", speed: 80 }); return;
  }
  const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
  if (p.holding === HOLD.WATER && growing) {
    plot.life = 1; plot.wilt = 0; p.holding = HOLD.NOTHING; ev(s, "watering");
    spawnParticles(s, plot.x, plot.y - 10, { n: 10, color: "#7ec8ff", speed: 110 }); return;
  }
  if (p.holding === HOLD.NOTHING && plot.stage === STAGE.READY) {
    p.holding = HOLD.PLANT; p.heldPlant = plot.plant;
    spawnParticles(s, plot.x, plot.y - 14, { n: 12, color: "#fff0a8", speed: 120 });
    resetPlot(plot); ev(s, "pickup");
  }
}
function resetPlot(plot) { plot.stage = STAGE.VIRGIN; plot.plant = null; plot.progress = 0; plot.life = 1; plot.wilt = 0; }
function selectSeed(s, p) { p.holding = HOLD.SEED; p.heldSeed = PLANTS[p.seedMenu.index]; p.seedMenu.open = false; ev(s, "pickup"); }

// ---- FX (pure math; renderer reads particles/floaters/shake) ---------------
function spawnParticles(s, x, y, { n = 8, color = "#fff", speed = 100, gravity = 220 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.6);
    s.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.3, life: 0.5 + Math.random() * 0.4, maxLife: 0.9, size: 2 + Math.random() * 3, color, gravity });
  }
}
function spawnFloater(s, x, y, text, color) { s.floaters.push({ x, y, vy: -34, life: 1.2, maxLife: 1.2, text, color }); }
function addShake(s, a) { s.shake = Math.min(12, s.shake + a); }
function updateFX(s, dt) {
  for (let i = s.particles.length - 1; i >= 0; i--) {
    const p = s.particles[i]; p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.life <= 0) s.particles.splice(i, 1);
  }
  for (let i = s.floaters.length - 1; i >= 0; i--) {
    const f = s.floaters[i]; f.y += f.vy * dt; f.life -= dt; if (f.life <= 0) s.floaters.splice(i, 1);
  }
  if (s.shake > 0) s.shake = Math.max(0, s.shake - 30 * dt);
}

// ---- per-player update -----------------------------------------------------
function updateSeedMenu(s, p, intent) {
  if (intent.navL) p.seedMenu.index = Math.max(0, p.seedMenu.index - 1);
  if (intent.navR) p.seedMenu.index = Math.min(PLANTS.length - 1, p.seedMenu.index + 1);
  if (Math.abs(intent.mx) > 0.55 && !p.navLatch) {
    p.seedMenu.index = Math.max(0, Math.min(PLANTS.length - 1, p.seedMenu.index + (intent.mx > 0 ? 1 : -1)));
    p.navLatch = true;
  } else if (Math.abs(intent.mx) < 0.3) { p.navLatch = false; }
  if (intent.confirm) selectSeed(s, p);
}
function updatePlayer(s, p, intent, dt) {
  let dx = intent.mx, dy = intent.my;
  const inMag = Math.hypot(dx, dy);
  const analogMag = inMag > 0 ? Math.min(1, inMag) : 1;
  p.moving = dx !== 0 || dy !== 0;
  const running = intent.run && p.moving && p.stamina > 0;
  if (running) {
    p.speed = TUNE.runSpeed; p.stamina -= TUNE.runDrain * dt;
    if (p.stamina <= 0) { p.stamina = 0; p.speed = TUNE.normalSpeed; }
  } else {
    p.speed = TUNE.normalSpeed; p.stamina += (p.moving ? TUNE.walkRegen : TUNE.idleRegen) * dt;
  }
  p.stamina = Math.max(0, Math.min(TUNE.maxStamina, p.stamina));
  if (p.moving) {
    const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    if (Math.abs(dx) > Math.abs(dy)) p.facing = dx < 0 ? "left" : "right";
    else p.facing = dy < 0 ? "up" : "down";
    const sp = p.speed * analogMag;
    p.x += dx * sp * dt; p.y += dy * sp * dt; p.anim += dt * (running ? 12 : 8);
  } else { p.anim += dt * 3; }
  p.x = Math.max(28, Math.min(WORLD.w - 28, p.x));
  p.y = Math.max(132, Math.min(WORLD.h - 28, p.y));
}
function updatePlots(s, dt) {
  const decay = decayMult(s);
  for (const plot of s.plots) {
    const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
    if (growing) {
      if (plot.life > 0) {
        plot.progress += dt / growthTime(s, plot);
        if (plot.progress >= 1) { plot.progress = 0; plot.stage++; plot.life = 1; plot.wilt = 0; }
        plot.life -= (dt / lifeTime(s, plot)) * decay;
        if (plot.life < 0) plot.life = 0;
      } else {
        plot.wilt += dt;
        if (plot.wilt >= TUNE.wiltGrace) {
          plot.stage = STAGE.DIED; plot.wilt = 0;
          spawnParticles(s, plot.x, plot.y - 8, { n: 8, color: "#7a5230", speed: 70 });
        }
      }
    } else if (plot.stage === STAGE.TREATED) {
      plot.life -= dt / (TUNE.lifeBase * 3 * s.mult);
      if (plot.life <= 0) resetPlot(plot);
    }
  }
}

function endRound(s) {
  s.over = true;
  const goals = starGoals(s), sc = s.score;
  const stars = sc >= goals[2] ? 3 : sc >= goals[1] ? 2 : sc >= goals[0] ? 1 : 0;
  s.result = { score: sc, stars, goals, delivered: s.stats.delivered, expired: s.stats.expired };
}

// ---- main step -------------------------------------------------------------
// `intents` is an array indexed by player slot (missing => idle).
export function step(s, intents, dt) {
  if (s.over || s.paused) return s;
  s.time -= dt;
  if (s.time <= 0) { s.time = 0; endRound(s); return s; }
  updateFX(s, dt);
  updateOrders(s, dt);
  let anyMoving = false;
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i], intent = (intents && intents[i]) || ZERO_INTENT();
    if (p.seedMenu.open) { updateSeedMenu(s, p, intent); p.moving = false; continue; }
    updatePlayer(s, p, intent, dt);
    handleInteract(s, p, intent);
    if (p.moving) anyMoving = true;
  }
  updatePlots(s, dt);
  s.anyMoving = anyMoving;
  return s;
}
