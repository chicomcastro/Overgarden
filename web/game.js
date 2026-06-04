"use strict";

/*
 * Overgarden — web reimplementation (HTML5 Canvas).
 *
 * Milestone 1 ("loop Overcooked mínimo"): timed rounds with order tickets,
 * star results, reversible wilting (watering matters), combos and juice, on
 * top of the original art/audio and the faithful farming loop.
 */

// Holding item states (EventsManager.HoldingItem)
const HOLD = { NOTHING: 0, SEED: 1, WATER: 2, TOOL: 3, PLANT: 4 };

// Plant stages (StageScript.PlantStages, 1-indexed in original)
const STAGE = { VIRGIN: 1, TREATED: 2, SMALL: 3, MEDIUM: 4, GREAT: 5, READY: 6, DIED: 7 };

// Difficulty multiplier indexed by difficulty-1 (StageScript.DifficultyMultiplier)
const DIFFICULTY_MULT = [4, 3, 2, 1];

// Co-op scaling by playerCount-1: more players => faster orders, more can be
// active at once, higher star goals. First-pass values — tune with the e2e
// multi-player harness (see docs/COOP_DESIGN.md). Solo keeps factor 1.
const COOP = {
  spawnScale: [1, 0.72, 0.58, 0.5],
  concurrentBonus: [0, 2, 3, 4],
  starScale: [1, 1.8, 2.5, 3.2],
};
const PLAYER_COLORS = ["#ffd24a", "#4ea8ff", "#ff6b6b", "#74e36b"];
const PLAYER_SPAWN = [[0, 30], [-70, 30], [70, 30], [0, 96]];

const WORLD = { w: 960, h: 600 };

const TUNE = {
  normalSpeed: 175,
  runSpeed: 320,
  maxStamina: 100,
  runDrain: 48,
  walkRegen: 14,
  idleRegen: 26,
  // Life runs out before a growth stage completes, so plants need watering.
  growthBase: 1.1,   // * rarity * mult => seconds to complete a growth stage
  lifeBase: 1.3,     // * rarity * mult => seconds of life (< growth => must water)
  wiltGrace: 3.0,    // seconds a plant can wilt (life 0) before dying — reversible
  decayRampMin: 0.6, // life-decay multiplier at round start (forgiving)
  decayRampMax: 1.3, // ...and at round end (harsher)
  interactRadius: 72,
};

const ROUND = {
  duration: 150,          // seconds
  // Calibrated to the achievable ceiling measured by the e2e bot at the shipped
  // pacing: 1★ ≈ a median solo run, 3★ ≈ a strong one. See tests/e2e/.
  stars: [90, 200, 380], // score thresholds for 1/2/3 stars
};

const ORDER = {
  maxConcurrent: 4,
  baseReward: 70,           // * rarity * qty
  unitReward: 10,           // per produce deposited toward an order
  expirePenalty: 60,
  spawnStart: 8, spawnEnd: 4, // seconds between spawns (round start -> end)
  timeBase: 22, timePerRarity: 9, // base seconds to fulfil an order
  diffTime: [1.5, 1.2, 1.0, 0.8],  // order time scale by difficulty (easy -> insano)
  diffSpawn: [1.3, 1.1, 0.95, 0.8],// spawn-interval scale (easy spawns slower)
  comboWindow: 12,          // seconds before an idle combo resets
};

// Seedable RNG — only gameplay-affecting randomness (order stream) routes
// through rng() so headless runs with ?seed=N are reproducible. Visual-only
// randomness (particles) stays on Math.random and never affects metrics.
let _seedRng = null;
function rng() { return _seedRng ? _seedRng() : Math.random(); }
function seedRng(seed) {
  // mulberry32 — tiny, deterministic PRNG.
  let a = (seed >>> 0) || 1;
  _seedRng = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Built once assets load: PLANTS list sorted by rarity (SeedStallManager order).
let PLANTS = [];

// ---------------------------------------------------------------------------
// Canvas / DOM
// ---------------------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
const startScreen = document.getElementById("start-screen");
const pauseScreen = document.getElementById("pause-screen");
const resultScreen = document.getElementById("result-screen");
const startBtn = document.getElementById("start-btn");
const muteBox = document.getElementById("mute-box");

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
const ASSETS = { atlas: null, img: {}, audio: {} };

function loadImage(name) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("img " + name));
    im.src = "assets/img/" + name;
  });
}

function loadAudio(name) {
  return new Promise((resolve) => {
    const a = new Audio("assets/audio/" + name);
    a.addEventListener("canplaythrough", () => resolve(a), { once: true });
    a.addEventListener("error", () => resolve(a), { once: true });
    a.load();
  });
}

async function loadAssets() {
  const atlas = await fetch("assets/atlas.json").then((r) => r.json());
  ASSETS.atlas = atlas;

  const sheets = new Set();
  for (const g of [atlas.character, atlas.items, atlas.plants, atlas.ui, atlas.tiles]) {
    for (const k in g) sheets.add(g[k].sheet);
  }
  await Promise.all([...sheets].map(async (s) => { ASSETS.img[s] = await loadImage(s); }));

  await Promise.all(Object.entries(atlas.audio).map(async ([k, file]) => {
    ASSETS.audio[k] = await loadAudio(file);
  }));

  PLANTS = Object.entries(atlas.plantData)
    .map(([name, d]) => ({ name, rarity: d.rarity, main: d.main, stages: d.stages }))
    .sort((a, b) => a.rarity - b.rarity || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Audio (sampled loops/one-shots + tiny synth cues for orders)
// ---------------------------------------------------------------------------
let actx = null;
const sound = {
  muted: false,
  theme() { this._loop("theme", 0.4); },
  footstepsOn() { this._loop("footsteps", 0.5); },
  footstepsOff() { const a = ASSETS.audio.footsteps; if (a) { a.pause(); a.currentTime = 0; } },
  watering() { this._once("watering", 0.6); },
  pickup() { this._once("pickup", 0.5); },
  _loop(key, vol) {
    const a = ASSETS.audio[key];
    if (!a || this.muted) return;
    a.loop = true; a.volume = vol;
    if (a.paused) a.play().catch(() => {});
  },
  _once(key, vol) {
    const a = ASSETS.audio[key];
    if (!a || this.muted) return;
    a.loop = false; a.volume = vol; a.currentTime = 0;
    a.play().catch(() => {});
  },
  _beep(freq, dur, type, vol) {
    if (this.muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (_) {}
  },
  ding() { this._beep(880, 0.12, "triangle", 0.25); setTimeout(() => this._beep(1320, 0.14, "triangle", 0.22), 90); },
  fail() { this._beep(200, 0.25, "sawtooth", 0.2); },
  setMuted(m) {
    this.muted = m;
    for (const k in ASSETS.audio) { if (m) ASSETS.audio[k].pause(); }
    if (!m && game && gameState === "playing" && !game.paused) this.theme();
  },
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = {};
const justPressed = {};
// We index keys by BOTH e.key (e.g. "w", "shift", "arrowup") and e.code
// (e.g. "shiftleft", "shiftright", "slash", "period", "enter") so a second
// keyboard player can have distinct binds (left vs right shift, etc.).
function setKey(name, down) {
  if (down) { if (!keys[name]) justPressed[name] = true; keys[name] = true; }
  else keys[name] = false;
}
window.addEventListener("keydown", (e) => {
  setKey(e.key.toLowerCase(), true);
  setKey(e.code.toLowerCase(), true);
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "/"].includes(e.key.toLowerCase())) e.preventDefault();
});
window.addEventListener("keyup", (e) => { setKey(e.key.toLowerCase(), false); setKey(e.code.toLowerCase(), false); });

function pressed(k) { return justPressed[k] === true; }
function anyDown(list) { return list.some((k) => keys[k]); }
function anyPressed(list) { return list.some((k) => justPressed[k] === true); }
function clearJustPressed() { for (const k in justPressed) justPressed[k] = false; }

const touchMove = { x: 0, y: 0, active: false };

// Per-slot keyboard binds. Slot 0 in solo also accepts arrows (preserves the
// original feel + the headless bot, which drives WASD). In co-op slot 0 is
// WASD-only so the arrows belong to slot 1.
function keymapForSlot(slot, playerCount) {
  if (slot === 0) {
    return playerCount === 1
      ? { up: ["w", "arrowup"], down: ["s", "arrowdown"], left: ["a", "arrowleft"], right: ["d", "arrowright"], run: ["shift"], interact: ["e"], drop: ["q"], navL: ["a", "arrowleft"], navR: ["d", "arrowright"], confirm: ["e"] }
      : { up: ["w"], down: ["s"], left: ["a"], right: ["d"], run: ["shiftleft"], interact: ["e"], drop: ["q"], navL: ["a"], navR: ["d"], confirm: ["e"] };
  }
  if (slot === 1) {
    return { up: ["arrowup"], down: ["arrowdown"], left: ["arrowleft"], right: ["arrowright"], run: ["shiftright"], interact: ["slash", "enter"], drop: ["period"], navL: ["arrowleft"], navR: ["arrowright"], confirm: ["slash", "enter"] };
  }
  return null; // slots 2+ are gamepad-only
}

// Gamepad previous-button state per pad index, for edge detection.
const gpPrev = {};
function gamepadIntent(gpIndex) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads[gpIndex];
  if (!gp) return null;
  const dz = 0.28;
  let mx = gp.axes[0] || 0, my = gp.axes[1] || 0;
  if (Math.hypot(mx, my) < dz) { mx = 0; my = 0; }
  const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const dpadL = b(14), dpadR = b(15), dpadU = b(12), dpadD = b(13);
  if (mx === 0 && my === 0) { mx = (dpadR ? 1 : 0) - (dpadL ? 1 : 0); my = (dpadD ? 1 : 0) - (dpadU ? 1 : 0); }
  const cur = { interact: b(0), drop: b(1), navL: dpadL, navR: dpadR, run: b(5) || b(7) || b(2), pause: b(9) };
  const prev = gpPrev[gpIndex] || {};
  const edge = (k) => cur[k] && !prev[k];
  gpPrev[gpIndex] = cur;
  if (edge("pause")) justPressed["p"] = true; // route gamepad Start to pause
  return {
    mx, my, run: cur.run,
    interact: edge("interact"), drop: edge("drop"),
    navL: edge("navL"), navR: edge("navR"), confirm: edge("interact"),
  };
}

// Build one intent per player slot for this frame. Slot 0 also folds in touch.
function gatherIntents() {
  const out = [];
  for (let i = 0; i < game.players.length; i++) {
    const dev = game.players[i].device;
    let it;
    if (dev.type === "gamepad") {
      it = gamepadIntent(dev.index) || { mx: 0, my: 0, run: false, interact: false, drop: false, navL: false, navR: false, confirm: false };
    } else {
      const km = dev.keymap;
      let mx = (anyDown(km.right) ? 1 : 0) - (anyDown(km.left) ? 1 : 0);
      let my = (anyDown(km.down) ? 1 : 0) - (anyDown(km.up) ? 1 : 0);
      it = {
        mx, my, run: anyDown(km.run),
        interact: anyPressed(km.interact), drop: anyPressed(km.drop),
        navL: anyPressed(km.navL), navR: anyPressed(km.navR), confirm: anyPressed(km.confirm),
      };
      // Touch (mobile, slot 0 only): analog joystick + on-screen buttons (which
      // set the slot-0 keys via bindTouch).
      if (i === 0 && touchMove.active && Math.hypot(touchMove.x, touchMove.y) > 0.22) {
        it.mx = touchMove.x; it.my = touchMove.y;
      }
    }
    out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let gameState = "menu"; // menu | playing | result
let game = null;

// Decide which input device drives each slot: keyboards first (0,1), then any
// connected gamepads fill the rest.
function assignDevices(playerCount) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const devices = [];
  let padCursor = 0;
  for (let slot = 0; slot < playerCount; slot++) {
    const km = keymapForSlot(slot, playerCount);
    if (km) devices.push({ type: "keyboard", keymap: km });
    else if (pads[padCursor]) devices.push({ type: "gamepad", index: pads[padCursor++].index });
    else devices.push({ type: "keyboard", keymap: keymapForSlot(0, playerCount) }); // fallback
  }
  return devices;
}

function createGame(playerCount, difficulty) {
  playerCount = Math.max(1, Math.min(4, playerCount || 1));
  difficulty = Math.max(1, Math.min(4, difficulty || 1));
  const mult = DIFFICULTY_MULT[difficulty - 1];

  const plots = [];
  const cols = 3, rows = 2;
  const startX = 300, startY = 215, gapX = 130, gapY = 150;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      plots.push({
        x: startX + c * gapX, y: startY + r * gapY,
        stage: STAGE.VIRGIN, plant: null, progress: 0, life: 1, wilt: 0,
      });
    }
  }

  // Stations: top band kept clear for HUD/orders.
  const stations = [
    { type: "tool",  x: 92,  y: 250, label: "Ferramentas", icon: "shovel" },
    { type: "seed",  x: 92,  y: 420, label: "Sementes",    icon: "seed" },
    { type: "water", x: 868, y: 320, label: "Poço",        icon: "water" },
    { type: "sales", x: 480, y: 548, label: "Entrega",     icon: "bag" },
  ];

  const devices = assignDevices(playerCount);
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const [ox, oy] = PLAYER_SPAWN[i];
    players.push({
      index: i, color: PLAYER_COLORS[i], device: devices[i],
      x: WORLD.w / 2 + ox, y: WORLD.h / 2 + oy,
      speed: 0, stamina: TUNE.maxStamina,
      facing: "down", moving: false,
      holding: HOLD.NOTHING, heldSeed: null, heldPlant: null,
      anim: 0, navLatch: false,
      seedMenu: { open: false, index: 0 },
    });
  }

  const g = {
    mult, difficulty, playerCount,
    score: 0, paused: false,
    time: ROUND.duration,
    orders: [], orderId: 1, orderSpawnTimer: 3,
    combo: 0, comboTimer: 0,
    stats: { delivered: 0, expired: 0 },
    particles: [], floaters: [], shake: 0, anyMoving: false,
    players, plots, stations,
  };
  // Back-compat aliases for the headless harness / debug API (single player).
  g.player = players[0];
  g.seedMenu = players[0].seedMenu;
  return g;
}

function maxConcurrentOrders() { return ORDER.maxConcurrent + COOP.concurrentBonus[game.playerCount - 1]; }
function starGoals() { const s = COOP.starScale[game.playerCount - 1]; return ROUND.stars.map((v) => Math.round(v * s)); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function roundProgress() { return clamp01(1 - game.time / ROUND.duration); }

function nearestStation(p) {
  let best = null, bestD = TUNE.interactRadius;
  for (const s of game.stations) {
    const d = dist(p.x, p.y, s.x, s.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function nearestPlot(p) {
  let best = null, bestD = TUNE.interactRadius;
  for (const plot of game.plots) {
    const d = dist(p.x, p.y, plot.x, plot.y);
    if (d < bestD) { bestD = d; best = plot; }
  }
  return best;
}

function stationOf(type) { return game.stations.find((s) => s.type === type); }

function growthTime(plot) { return TUNE.growthBase * plot.plant.rarity * game.mult; }
function lifeTime(plot)   { return TUNE.lifeBase   * plot.plant.rarity * game.mult; }
function decayMult()      { return lerp(TUNE.decayRampMin, TUNE.decayRampMax, roundProgress()); }

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
function orderableRarity() {
  const p = roundProgress();
  if (p < 0.3) return 1;
  if (p < 0.6) return 2;
  return 3;
}
function orderInterval() {
  return lerp(ORDER.spawnStart, ORDER.spawnEnd, roundProgress())
    * ORDER.diffSpawn[game.difficulty - 1] * COOP.spawnScale[game.playerCount - 1];
}
function spawnOrder() {
  if (game.orders.length >= maxConcurrentOrders()) return;
  const maxR = orderableRarity();
  const pool = PLANTS.filter((p) => p.rarity <= maxR);
  const plant = pool[Math.floor(rng() * pool.length)];
  const p = roundProgress();
  let qty = 1;
  if (p > 0.3 && rng() < 0.5) qty++;
  if (p > 0.6 && rng() < 0.4) qty++;
  const time = (ORDER.timeBase + ORDER.timePerRarity * plant.rarity) * ORDER.diffTime[game.difficulty - 1];
  game.orders.push({ plant, need: qty, qty, timeLeft: time, maxTime: time, id: game.orderId++ });
}

function ordersNeeding(name) {
  return game.orders.filter((o) => o.plant.name === name && o.need > 0);
}

function updateOrders(dt) {
  game.orderSpawnTimer -= dt;
  if (game.orderSpawnTimer <= 0) {
    spawnOrder();
    game.orderSpawnTimer = orderInterval();
  }
  for (const o of game.orders) o.timeLeft -= dt;
  for (let i = game.orders.length - 1; i >= 0; i--) {
    if (game.orders[i].timeLeft <= 0) {
      game.orders.splice(i, 1);
      game.score = Math.max(0, game.score - ORDER.expirePenalty);
      game.combo = 0;
      game.stats.expired++;
      const st = stationOf("sales");
      spawnParticles(st.x, st.y - 12, { n: 12, color: "#e74c3c", speed: 130 });
      spawnFloater(st.x, st.y - 30, "-" + ORDER.expirePenalty, "#e74c3c");
      addShake(8);
      sound.fail();
    }
  }
  if (game.comboTimer > 0) {
    game.comboTimer -= dt;
    if (game.comboTimer <= 0) game.combo = 0;
  }
}

function deliverPlant(p) {
  if (p.holding !== HOLD.PLANT || !p.heldPlant) return;
  const st = stationOf("sales");
  const matches = ordersNeeding(p.heldPlant.name);
  if (matches.length === 0) {
    spawnFloater(st.x, st.y - 28, "sem pedido!", "#e7a76a");
    return; // forgiving: keep holding the produce
  }
  // Fulfil the most urgent matching order.
  matches.sort((a, b) => a.timeLeft - b.timeLeft);
  const o = matches[0];
  o.need--;
  game.score += ORDER.unitReward;
  p.holding = HOLD.NOTHING; p.heldPlant = null;
  spawnParticles(st.x, st.y - 12, { n: 6, color: "#9fe6ff", speed: 90 });
  sound.pickup();
  if (o.need <= 0) completeOrder(o);
}

function completeOrder(o) {
  const base = ORDER.baseReward * o.plant.rarity * o.qty;
  const tip = Math.round(base * 0.5 * (o.timeLeft / o.maxTime)); // faster = bigger tip
  game.combo++;
  game.comboTimer = ORDER.comboWindow;
  const mult = 1 + 0.1 * Math.min(game.combo - 1, 9);
  const total = Math.round((base + tip) * mult);
  game.score += total;
  game.stats.delivered++;
  const st = stationOf("sales");
  spawnParticles(st.x, st.y - 16, { n: 20, color: "#f7d774", speed: 150 });
  spawnFloater(st.x, st.y - 34, "+" + total + (game.combo > 1 ? "  x" + game.combo : ""), "#f7d774");
  addShake(7);
  sound.ding();
  const idx = game.orders.indexOf(o);
  if (idx >= 0) game.orders.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
function handleInteract(p, intent) {
  if (intent.drop && p.holding !== HOLD.PLANT) { p.holding = HOLD.NOTHING; p.heldSeed = null; }
  if (!intent.interact) return;

  const station = nearestStation(p);
  if (station) { interactStation(p, station); return; }
  const plot = nearestPlot(p);
  if (plot) interactPlot(p, plot);
}

function interactStation(p, s) {
  switch (s.type) {
    case "tool":
      if (p.holding !== HOLD.PLANT) { p.holding = HOLD.TOOL; p.heldSeed = null; sound.pickup(); }
      break;
    case "water":
      if (p.holding !== HOLD.PLANT) { p.holding = HOLD.WATER; p.heldSeed = null; sound.pickup(); }
      break;
    case "seed":
      if (p.holding !== HOLD.PLANT) { p.seedMenu.open = true; }
      break;
    case "sales":
      deliverPlant(p);
      break;
  }
}

function interactPlot(p, plot) {
  if (plot.stage === STAGE.DIED) {
    if (p.holding === HOLD.TOOL) { resetPlot(plot); p.holding = HOLD.NOTHING; sound.pickup(); }
    return;
  }
  if (p.holding === HOLD.TOOL && plot.stage === STAGE.VIRGIN) {
    plot.stage = STAGE.TREATED; plot.life = 1; p.holding = HOLD.NOTHING; sound.pickup();
    spawnParticles(plot.x, plot.y, { n: 8, color: "#6b4a2b", speed: 70 });
    return;
  }
  if (p.holding === HOLD.SEED && plot.stage === STAGE.TREATED && p.heldSeed) {
    plot.plant = p.heldSeed; plot.stage = STAGE.SMALL; plot.progress = 0; plot.life = 1; plot.wilt = 0;
    p.holding = HOLD.NOTHING; p.heldSeed = null; sound.pickup();
    spawnParticles(plot.x, plot.y - 6, { n: 8, color: "#5fd35f", speed: 80 });
    return;
  }
  const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
  if (p.holding === HOLD.WATER && growing) {
    plot.life = 1; plot.wilt = 0; p.holding = HOLD.NOTHING; sound.watering();
    spawnParticles(plot.x, plot.y - 10, { n: 10, color: "#7ec8ff", speed: 110 });
    return;
  }
  if (p.holding === HOLD.NOTHING && plot.stage === STAGE.READY) {
    p.holding = HOLD.PLANT; p.heldPlant = plot.plant;
    spawnParticles(plot.x, plot.y - 14, { n: 12, color: "#fff0a8", speed: 120 });
    resetPlot(plot); sound.pickup();
  }
}

function resetPlot(plot) {
  plot.stage = STAGE.VIRGIN; plot.plant = null; plot.progress = 0; plot.life = 1; plot.wilt = 0;
}

function selectSeed(p) {
  p.holding = HOLD.SEED; p.heldSeed = PLANTS[p.seedMenu.index];
  p.seedMenu.open = false; sound.pickup();
}

// ---------------------------------------------------------------------------
// FX (particles / floating text / screenshake)
// ---------------------------------------------------------------------------
function spawnParticles(x, y, { n = 8, color = "#fff", speed = 100, gravity = 220 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.6);
    game.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.3,
      life: 0.5 + Math.random() * 0.4, maxLife: 0.9, size: 2 + Math.random() * 3,
      color, gravity,
    });
  }
}
function spawnFloater(x, y, text, color) {
  game.floaters.push({ x, y, vy: -34, life: 1.2, maxLife: 1.2, text, color });
}
function addShake(a) { game.shake = Math.min(12, game.shake + a); }

function updateFX(dt) {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.vy += p.gravity * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) game.particles.splice(i, 1);
  }
  for (let i = game.floaters.length - 1; i >= 0; i--) {
    const f = game.floaters[i];
    f.y += f.vy * dt; f.life -= dt;
    if (f.life <= 0) game.floaters.splice(i, 1);
  }
  if (game.shake > 0) game.shake = Math.max(0, game.shake - 30 * dt);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update(dt) {
  if (gameState !== "playing" || game.paused) return;

  game.time -= dt;
  if (game.time <= 0) { game.time = 0; endRound(); return; }

  updateFX(dt);
  updateOrders(dt);

  const intents = gatherIntents();
  let anyMoving = false;
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i], intent = intents[i];
    if (p.seedMenu.open) { updateSeedMenu(p, intent); p.moving = false; continue; }
    updatePlayer(p, intent, dt);
    handleInteract(p, intent);
    if (p.moving) anyMoving = true;
  }
  updatePlots(dt);

  // Footsteps loop on while anyone walks.
  if (anyMoving && !game.anyMoving) sound.footstepsOn();
  else if (!anyMoving && game.anyMoving) sound.footstepsOff();
  game.anyMoving = anyMoving;
}

function updateSeedMenu(p, intent) {
  if (intent.navL) p.seedMenu.index = Math.max(0, p.seedMenu.index - 1);
  if (intent.navR) p.seedMenu.index = Math.min(PLANTS.length - 1, p.seedMenu.index + 1);
  // Analog stick navigation with a per-player latch.
  if (Math.abs(intent.mx) > 0.55 && !p.navLatch) {
    p.seedMenu.index = Math.max(0, Math.min(PLANTS.length - 1, p.seedMenu.index + (intent.mx > 0 ? 1 : -1)));
    p.navLatch = true;
  } else if (Math.abs(intent.mx) < 0.3) {
    p.navLatch = false;
  }
  if (intent.confirm) selectSeed(p);
}

function updatePlayer(p, intent, dt) {
  let dx = intent.mx, dy = intent.my;
  const inMag = Math.hypot(dx, dy);
  const analogMag = inMag > 0 ? Math.min(1, inMag) : 1;

  const wasMoving = p.moving;
  p.moving = dx !== 0 || dy !== 0;

  const running = intent.run && p.moving && p.stamina > 0;
  if (running) {
    p.speed = TUNE.runSpeed;
    p.stamina -= TUNE.runDrain * dt;
    if (p.stamina <= 0) { p.stamina = 0; p.speed = TUNE.normalSpeed; }
  } else {
    p.speed = TUNE.normalSpeed;
    p.stamina += (p.moving ? TUNE.walkRegen : TUNE.idleRegen) * dt;
  }
  p.stamina = Math.max(0, Math.min(TUNE.maxStamina, p.stamina));

  if (p.moving) {
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    if (Math.abs(dx) > Math.abs(dy)) p.facing = dx < 0 ? "left" : "right";
    else p.facing = dy < 0 ? "up" : "down";
    const sp = p.speed * analogMag;
    p.x += dx * sp * dt;
    p.y += dy * sp * dt;
    p.anim += dt * (running ? 12 : 8);
  } else {
    p.anim += dt * 3;
  }

  p.x = Math.max(28, Math.min(WORLD.w - 28, p.x));
  p.y = Math.max(132, Math.min(WORLD.h - 28, p.y));
}

function updatePlots(dt) {
  const decay = decayMult();
  for (const plot of game.plots) {
    const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
    if (growing) {
      if (plot.life > 0) {
        // healthy: grow + lose life
        plot.progress += dt / growthTime(plot);
        if (plot.progress >= 1) { plot.progress = 0; plot.stage++; plot.life = 1; plot.wilt = 0; }
        plot.life -= (dt / lifeTime(plot)) * decay;
        if (plot.life < 0) plot.life = 0;
      } else {
        // wilting: growth paused; dies if not watered within the grace window
        plot.wilt += dt;
        if (plot.wilt >= TUNE.wiltGrace) {
          plot.stage = STAGE.DIED; plot.wilt = 0;
          spawnParticles(plot.x, plot.y - 8, { n: 8, color: "#7a5230", speed: 70 });
        }
      }
    } else if (plot.stage === STAGE.TREATED) {
      plot.life -= dt / (TUNE.lifeBase * 3 * game.mult);
      if (plot.life <= 0) resetPlot(plot);
    }
  }
}

function endRound() {
  gameState = "result";
  sound.footstepsOff();
  for (const k in ASSETS.audio) ASSETS.audio[k].pause();
  showTouchControls(false);

  const s = game.score;
  const goals = starGoals();
  const stars = (s >= goals[2]) ? 3 : (s >= goals[1]) ? 2 : (s >= goals[0]) ? 1 : 0;
  document.getElementById("result-stars").innerHTML =
    [0, 1, 2].map((i) => `<span class="${i < stars ? "on" : "off"}">★</span>`).join("");
  document.getElementById("result-score").textContent = "Score: " + s;
  document.getElementById("result-stats").textContent =
    `Pedidos entregues: ${game.stats.delivered} · perdidos: ${game.stats.expired}` +
    (stars < 3 ? ` · próxima estrela em ${goals[Math.min(stars, 2)]}` : " · máximo!");
  resultScreen.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Sprite drawing
// ---------------------------------------------------------------------------
function drawFrame(sheetName, rect, dx, dy, dw, dh) {
  const img = ASSETS.img[sheetName];
  if (!img) return;
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, dx, dy, dw, dh);
}
function drawSpriteAnchored(sheetName, rect, ax, ay, targetH) {
  const scale = targetH / rect.h;
  const w = rect.w * scale;
  drawFrame(sheetName, rect, ax - w / 2, ay - targetH, w, targetH);
}
function charFrame(p) {
  let set;
  if (p.moving) set = "walk_" + p.facing;
  else if (p.holding !== HOLD.NOTHING) set = "hold_" + p.facing;
  else set = "idle_" + p.facing;
  const data = ASSETS.atlas.character[set];
  const idx = Math.floor(p.anim) % data.frames.length;
  return { sheet: data.sheet, rect: data.frames[idx] };
}

function drawTile(sheetKey, col, row, dx, dy, dw, dh) {
  const t = ASSETS.atlas.tiles[sheetKey];
  if (!t) return;
  ctx.drawImage(ASSETS.img[t.sheet], col * 32, row * 32, 32, 32, dx, dy, dw, dh);
}
const TILE_PX = 48;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  ctx.save();
  if (game.shake > 0) {
    ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
  }
  drawBackground();
  for (const plot of game.plots) drawPlot(plot);
  for (const s of game.stations) drawStation(s);
  drawPlayers();
  drawParticles();
  drawFloaters();
  ctx.restore();

  drawHUD();
  drawOrders();
  for (const p of game.players) drawInteractHint(p);
  for (const p of game.players) if (p.seedMenu.open) drawSeedMenu(p);
}

function drawBackground() {
  ctx.fillStyle = "#6ab04c";
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  if (ASSETS.atlas.tiles.grass) {
    for (let y = 0; y < WORLD.h; y += TILE_PX) {
      for (let x = 0; x < WORLD.w; x += TILE_PX) drawTile("grass", 1, 3, x, y, TILE_PX, TILE_PX);
    }
  }
  drawFence();
}

function drawFence() {
  if (!ASSETS.atlas.tiles.fence) return;
  const F = 40;
  for (let x = 0; x < WORLD.w; x += F) {
    drawTile("fence", 1, 0, x, -4, F, F);
    drawTile("fence", 1, 0, x, WORLD.h - F + 4, F, F);
  }
  for (let y = F - 8; y < WORLD.h - F; y += F) {
    drawTile("fence", 1, 1, -4, y, F, F);
    drawTile("fence", 1, 1, WORLD.w - F + 4, y, F, F);
  }
}

function drawPlot(plot) {
  const size = 96;
  const x = plot.x - size / 2, y = plot.y - size / 2;

  if (plot.stage === STAGE.VIRGIN) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(x + 6, y + 6, size - 12, size - 12, 10, true, false);
    ctx.strokeStyle = "rgba(60,45,25,0.35)"; ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    roundRect(x + 6, y + 6, size - 12, size - 12, 10, false, true);
    ctx.setLineDash([]);
  } else if (ASSETS.atlas.tiles.soil) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) drawTile("soil", c, r + 2, x + c * 32, y + r * 32, 32, 32);
    }
  } else {
    ctx.fillStyle = "#7a5230";
    roundRect(x, y, size, size, 8, true, false);
  }

  const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
  const wilting = growing && plot.life <= 0;

  if (plot.plant && plot.stage >= STAGE.SMALL) {
    const baseY = plot.y + size / 2 - 14;
    if (plot.stage === STAGE.DIED) {
      const r = plot.plant.stages[2] || plot.plant.stages[0];
      ctx.globalAlpha = 0.45;
      drawSpriteAnchored(r.sheet, r, plot.x, baseY, 58);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(60,40,20,0.35)";
      roundRect(x + 8, y + 8, size - 16, size - 16, 6, true, false);
    } else {
      const idx = Math.min(plot.stage - STAGE.SMALL, plot.plant.stages.length - 1);
      const r = plot.plant.stages[idx];
      const targetH = [40, 54, 66, 72][idx] || 60;
      if (wilting) {
        // drooped + warm tint
        ctx.globalAlpha = 0.8;
        drawSpriteAnchored(r.sheet, r, plot.x, baseY + 4, targetH * 0.92);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(180,90,30,0.22)";
        roundRect(x + 8, y + 8, size - 16, size - 16, 6, true, false);
      } else {
        drawSpriteAnchored(r.sheet, r, plot.x, baseY, targetH);
      }
      if (plot.stage === STAGE.READY) {
        ctx.strokeStyle = "rgba(247,215,116,0.9)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(plot.x, plot.y, size / 2 - 2, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // Bars + "needs water" cue
  if (growing) {
    bar(x, y - 14, size, 5, plot.progress, "#7ec8ff", "#1f3a4d");
    if (wilting) {
      // urgent: shrinking red bar showing time left before death
      bar(x, y - 7, size, 5, 1 - plot.wilt / TUNE.wiltGrace, "#e74c3c", "#3a1f1f");
      drawWaterCue(plot, true);
    } else {
      bar(x, y - 7, size, 5, plot.life, lifeColor(plot.life), "#3a1f1f");
      if (plot.life < 0.4) drawWaterCue(plot, false);
    }
  } else if (plot.stage === STAGE.TREATED) {
    bar(x, y - 8, size, 5, plot.life, "#caa46a", "#3a2a1f");
  }
}

function drawWaterCue(plot, urgent) {
  const item = ASSETS.atlas.items.water;
  if (!item) return;
  const pulse = 0.55 + 0.45 * Math.sin(performance.now() / (urgent ? 110 : 200));
  ctx.globalAlpha = pulse;
  const h = urgent ? 26 : 20, w = h * (item.w / item.h);
  drawFrame(item.sheet, { x: 0, y: 0, w: item.w, h: item.h }, plot.x - w / 2, plot.y - 52, w, h);
  ctx.globalAlpha = 1;
}

function lifeColor(t) {
  if (t > 0.5) return "#5fd35f";
  if (t > 0.25) return "#f0c419";
  return "#e74c3c";
}

function drawStation(s) {
  const w = 84, h = 66;
  const x = s.x - w / 2, y = s.y - h / 2;
  ctx.fillStyle = "#7a5230";
  roundRect(x, y, w, h, 8, true, false);
  ctx.fillStyle = "#5e3f24";
  roundRect(x, y + h - 14, w, 14, 4, true, false);

  const item = ASSETS.atlas.items[s.icon];
  if (item) {
    const ih = 40, iw = ih * (item.w / item.h);
    drawFrame(item.sheet, { x: 0, y: 0, w: item.w, h: item.h }, s.x - iw / 2, s.y - ih / 2 - 4, iw, ih);
  }
  ctx.fillStyle = "#2a3a1f";
  ctx.font = "bold 12px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(s.label, s.x, y + h + 14);
}

function drawPlayers() {
  const coop = game.playerCount > 1;
  const order = [...game.players].sort((a, b) => a.y - b.y);
  for (const p of order) {
    // Shadow — tinted with the player colour in co-op to tell them apart.
    ctx.fillStyle = coop ? hexAlpha(p.color, 0.5) : "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 16, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (coop) {
      ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 16, 19, 7, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const f = charFrame(p);
    drawSpriteAnchored(f.sheet, f.rect, p.x, p.y + 18, 76);
    drawHeldIcon(p.x, p.y - 56, p);
    if (coop) {
      // Player number tag + stamina pip under the feet.
      ctx.fillStyle = p.color;
      ctx.font = "bold 12px Trebuchet MS, sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 3;
      ctx.strokeText("P" + (p.index + 1), p.x, p.y - 64);
      ctx.fillText("P" + (p.index + 1), p.x, p.y - 64);
      bar(p.x - 18, p.y + 24, 36, 4, p.stamina / TUNE.maxStamina, p.color, "#3a1f1f");
    }
  }
}

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawHeldIcon(cx, cy, p) {
  const items = ASSETS.atlas.items;
  let item = null, rect = null, sheet = null, h = 26;
  if (p.holding === HOLD.TOOL) item = items.shovel;
  else if (p.holding === HOLD.WATER) item = items.water;
  else if (p.holding === HOLD.SEED) item = items.seed;
  else if (p.holding === HOLD.PLANT && p.heldPlant && p.heldPlant.main) {
    sheet = p.heldPlant.main.sheet; rect = p.heldPlant.main; h = 24;
  }
  if (item) { sheet = item.sheet; rect = { x: 0, y: 0, w: item.w, h: item.h }; }
  if (!sheet || !rect) return;
  const w = h * (rect.w / rect.h);
  drawFrame(sheet, rect, cx - w / 2, cy - h / 2, w, h);
}

function drawParticles() {
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawFloaters() {
  ctx.textAlign = "center";
  for (const f of game.floaters) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 0.6));
    ctx.font = "bold 20px Trebuchet MS, sans-serif";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function drawHUD() {
  // Score (top-left) + star goals
  ctx.fillStyle = "rgba(20,30,16,0.75)";
  roundRect(12, 10, 210, 44, 8, true, false);
  ctx.fillStyle = "#f7d774";
  ctx.font = "bold 22px Trebuchet MS, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Score " + game.score, 22, 33);
  ctx.font = "12px Trebuchet MS, sans-serif";
  ctx.fillStyle = "#b7d49a";
  const goals = starGoals();
  const reached = goals.filter((t) => game.score >= t).length;
  ctx.fillText("★".repeat(reached) + "☆".repeat(3 - reached) + "  meta " + goals[2], 22, 48);

  // Combo (under score, when active)
  if (game.combo > 1) {
    ctx.fillStyle = "#ffd24a";
    ctx.font = "bold 16px Trebuchet MS, sans-serif";
    ctx.fillText("COMBO x" + game.combo, 240, 32);
  }

  // Timer (top-center)
  const tw = 120, tx = WORLD.w / 2 - tw / 2;
  ctx.fillStyle = "rgba(20,30,16,0.75)";
  roundRect(tx, 8, tw, 38, 8, true, false);
  ctx.fillStyle = game.time < 30 ? "#e74c3c" : "#fff";
  ctx.font = "bold 24px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("⏱ " + fmtTime(game.time), WORLD.w / 2, 35);

  // Stamina (top-right) — single player only; in co-op each player has a pip
  // under their feet (drawn in drawPlayers).
  if (game.playerCount === 1) {
    const sx = WORLD.w - 232, sy = 14, sw = 220, sh = 16;
    ctx.fillStyle = "rgba(20,30,16,0.75)";
    roundRect(sx - 8, sy - 4, sw + 16, sh + 22, 8, true, false);
    ctx.fillStyle = "#3a1f1f"; roundRect(sx, sy, sw, sh, 5, true, false);
    ctx.fillStyle = "#5fd35f"; roundRect(sx, sy, sw * (game.players[0].stamina / TUNE.maxStamina), sh, 5, true, false);
    ctx.fillStyle = "#fff"; ctx.font = "11px Trebuchet MS, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("STAMINA", sx + sw / 2, sy + sh + 12);

    // Held item label (bottom-left)
    const label = heldLabel(game.players[0]);
    if (label) {
      ctx.fillStyle = "rgba(20,30,16,0.7)";
      roundRect(12, WORLD.h - 44, 300, 32, 8, true, false);
      ctx.fillStyle = "#e7e0cd";
      ctx.font = "bold 15px Trebuchet MS, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Segurando: " + label, 22, WORLD.h - 23);
    }
  }
}

function drawOrders() {
  const n = game.orders.length;
  if (n === 0) return;
  const cw = 92, ch = 66, gap = 10;
  const totalW = n * cw + (n - 1) * gap;
  let x = WORLD.w / 2 - totalW / 2;
  const y = 58;
  for (const o of game.orders) {
    const urg = o.timeLeft / o.maxTime;
    const col = urg > 0.5 ? "#5fd35f" : urg > 0.25 ? "#f0c419" : "#e74c3c";
    ctx.fillStyle = "rgba(20,30,16,0.82)";
    roundRect(x, y, cw, ch, 8, true, false);
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    roundRect(x, y, cw, ch, 8, false, true);
    const m = o.plant.main;
    if (m) { const ih = 32, iw = ih * (m.w / m.h); drawFrame(m.sheet, m, x + cw / 2 - iw / 2, y + 7, iw, ih); }
    ctx.fillStyle = "#fff"; ctx.font = "bold 14px Trebuchet MS, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("x" + o.need, x + cw / 2, y + ch - 12);
    bar(x + 8, y + ch - 7, cw - 16, 4, urg, col, "#333");
    x += cw + gap;
  }
}

function heldLabel(p) {
  switch (p.holding) {
    case HOLD.TOOL: return "Enxada";
    case HOLD.WATER: return "Água";
    case HOLD.SEED: return p.heldSeed ? "Semente: " + p.heldSeed.name : "Semente";
    case HOLD.PLANT: return p.heldPlant ? p.heldPlant.name : "Colheita";
    default: return null;
  }
}

function drawInteractHint(p) {
  if (p.seedMenu.open) return;
  const station = nearestStation(p);
  const plot = !station ? nearestPlot(p) : null;
  let hint = null;

  if (station) {
    if (station.type === "tool") hint = "E: pegar enxada";
    if (station.type === "water") hint = "E: pegar água";
    if (station.type === "seed") hint = p.holding !== HOLD.PLANT ? "E: escolher semente" : null;
    if (station.type === "sales") hint = p.holding === HOLD.PLANT ? "E: entregar" : null;
  } else if (plot) {
    const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
    if (plot.stage === STAGE.VIRGIN && p.holding === HOLD.TOOL) hint = "E: preparar terra";
    else if (plot.stage === STAGE.TREATED && p.holding === HOLD.SEED) hint = "E: plantar";
    else if (growing && p.holding === HOLD.WATER) hint = "E: regar";
    else if (plot.stage === STAGE.READY && p.holding === HOLD.NOTHING) hint = "E: colher";
    else if (plot.stage === STAGE.DIED && p.holding === HOLD.TOOL) hint = "E: limpar terra";
  }
  if (!hint) return;

  ctx.font = "bold 16px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  const tw = ctx.measureText(hint).width;
  ctx.fillStyle = "rgba(20,30,16,0.85)";
  roundRect(p.x - tw / 2 - 10, p.y - 88, tw + 20, 24, 6, true, false);
  ctx.fillStyle = "#f7d774";
  ctx.fillText(hint, p.x, p.y - 71);
}

// Compact, non-blocking seed picker floating above the player's head, so other
// players keep playing while one chooses (Overcooked-style).
function drawSeedMenu(p) {
  const idx = p.seedMenu.index;
  const spacing = 58;
  const panelW = 260, panelH = 96;
  let cx = p.x;
  cx = Math.max(panelW / 2 + 8, Math.min(WORLD.w - panelW / 2 - 8, cx));
  let cy = p.y - 120;
  if (cy < panelH + 10) cy = p.y + 130; // flip below if too high
  const top = cy - panelH / 2;

  ctx.fillStyle = "rgba(20,30,16,0.92)";
  roundRect(cx - panelW / 2, top, panelW, panelH, 10, true, false);
  ctx.strokeStyle = p.color; ctx.lineWidth = 3;
  roundRect(cx - panelW / 2, top, panelW, panelH, 10, false, true);

  const row = top + 38;
  for (let off = -2; off <= 2; off++) {
    const i = idx + off;
    if (i < 0 || i >= PLANTS.length) continue;
    const plant = PLANTS[i];
    const x = cx + off * spacing;
    const selected = off === 0;
    const r = selected ? 26 : 18;
    ctx.fillStyle = selected ? hexAlpha(p.color, 0.22) : "rgba(255,255,255,0.06)";
    ctx.beginPath(); ctx.arc(x, row, r, 0, Math.PI * 2); ctx.fill();
    if (selected) { ctx.strokeStyle = p.color; ctx.lineWidth = 3; ctx.stroke(); }
    if (plant.main) {
      const h = selected ? 30 : 20, w = h * (plant.main.w / plant.main.h);
      drawFrame(plant.main.sheet, plant.main, x - w / 2, row - h / 2, w, h);
    }
    const demand = ordersNeeding(plant.name).reduce((a, o) => a + o.need, 0);
    if (demand > 0) {
      ctx.fillStyle = "#e74c3c";
      ctx.beginPath(); ctx.arc(x + r * 0.8, row - r * 0.8, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px Trebuchet MS, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(demand, x + r * 0.8, row - r * 0.8 + 4);
    }
  }
  const sel = PLANTS[idx];
  ctx.fillStyle = "#fff"; ctx.font = "bold 14px Trebuchet MS, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(sel.name + "  " + "★".repeat(sel.rarity), cx, top + panelH - 12);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
function bar(x, y, w, h, t, fill, bg) {
  ctx.fillStyle = bg; roundRect(x, y, w, h, 2, true, false);
  ctx.fillStyle = fill; roundRect(x, y, w * Math.max(0, Math.min(1, t)), h, 2, true, false);
}
function roundRect(x, y, w, h, r, doFill, doStroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (doFill) ctx.fill();
  if (doStroke) ctx.stroke();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastTime = 0;
let running = false;

function loop(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
  lastTime = now;
  if (pressed("p") && gameState === "playing") togglePause();
  update(dt);
  if (game) render();
  clearJustPressed();
  requestAnimationFrame(loop);
}

function togglePause() {
  if (!game || gameState !== "playing") return;
  game.paused = !game.paused;
  pauseScreen.classList.toggle("hidden", !game.paused);
  if (game.paused) { sound.footstepsOff(); for (const k in ASSETS.audio) ASSETS.audio[k].pause(); }
  else if (!sound.muted) sound.theme();
}

// ---------------------------------------------------------------------------
// Menu wiring
// ---------------------------------------------------------------------------
let selectedPlayers = 1;   // player count (co-op)
let selectedDifficulty = 1; // difficulty (mult / order pacing)
function bindChoiceGroup(selector, attr, setter) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(selector).forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      setter(parseInt(btn.dataset[attr], 10));
    });
  });
}
bindChoiceGroup(".count-btn", "count", (v) => { selectedPlayers = v; });
bindChoiceGroup(".diff-btn", "diff", (v) => { selectedDifficulty = v; });

startBtn.addEventListener("click", startGame);
document.getElementById("resume-btn").addEventListener("click", togglePause);
document.getElementById("quit-btn").addEventListener("click", quitToMenu);
document.getElementById("again-btn").addEventListener("click", startGame);
document.getElementById("menu-btn").addEventListener("click", quitToMenu);
muteBox.addEventListener("change", () => sound.setMuted(muteBox.checked));

const touchControls = document.getElementById("touch-controls");
function bindTouch() {
  if (!touchControls) return;
  touchControls.querySelectorAll(".tbtn").forEach((btn) => {
    const key = btn.dataset.key;
    const press = (e) => {
      e.preventDefault();
      if (!keys[key]) justPressed[key] = true;
      keys[key] = true;
      btn.classList.add("pressed");
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const release = (e) => { e.preventDefault(); keys[key] = false; btn.classList.remove("pressed"); };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });
}
bindTouch();

function bindJoystick() {
  const js = document.getElementById("joystick");
  const knob = document.getElementById("knob");
  if (!js || !knob) return;
  const R = 46;
  let cx = 0, cy = 0;
  const start = (e) => {
    e.preventDefault();
    const r = js.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    touchMove.active = true;
    try { js.setPointerCapture(e.pointerId); } catch (_) {}
    move(e);
  };
  const move = (e) => {
    if (!touchMove.active) return;
    e.preventDefault();
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy) || 1;
    const m = Math.min(1, len / R);
    const ux = dx / len, uy = dy / len;
    touchMove.x = ux * m; touchMove.y = uy * m;
    knob.style.transform = `translate(${ux * m * R}px, ${uy * m * R}px)`;
  };
  const end = (e) => {
    e.preventDefault();
    touchMove.active = false; touchMove.x = 0; touchMove.y = 0;
    knob.style.transform = "translate(0,0)";
  };
  js.addEventListener("pointerdown", start);
  js.addEventListener("pointermove", move);
  js.addEventListener("pointerup", end);
  js.addEventListener("pointercancel", end);
}
bindJoystick();

function showTouchControls(on) {
  if (touchControls) touchControls.classList.toggle("active", on);
}

function startGame() {
  if (!ASSETS.atlas) return;
  game = createGame(selectedPlayers, selectedDifficulty);
  gameState = "playing";
  startScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  resultScreen.classList.add("hidden");
  showTouchControls(true);
  if (actx && actx.state === "suspended") actx.resume().catch(() => {});
  sound.setMuted(muteBox.checked);
  if (!sound.muted) sound.theme();
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function quitToMenu() {
  running = false;
  game = null;
  gameState = "menu";
  for (const k in ASSETS.audio) { ASSETS.audio[k].pause(); ASSETS.audio[k].currentTime = 0; }
  showTouchControls(false);
  pauseScreen.classList.add("hidden");
  resultScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
ctx.fillStyle = "#6ab04c";
ctx.fillRect(0, 0, WORLD.w, WORLD.h);

if (location.search.includes("debug")) {
  const params = new URLSearchParams(location.search);
  if (params.has("seed")) seedRng(parseInt(params.get("seed"), 10));

  window.__OG__ = {
    get game() { return game; },
    get gameState() { return gameState; },
    get PLANTS() { return PLANTS; },
    // Constants exposed so the harness reports against live tuning values.
    TUNE, ROUND, ORDER, WORLD, HOLD, STAGE,
    // Raw input maps so an external bot can drive via the same input path the
    // human uses (movement runs at real game speed — realistic for balancing).
    keys, justPressed,
    teleport(x, y) { game.player.x = x; game.player.y = y; },
    openSeedMenu(i = 0) { game.player.seedMenu.open = true; game.player.seedMenu.index = i; },
    setPlot(i, patch) { Object.assign(game.plots[i], patch); },
    setTime(t) { game.time = t; },
    spawnOrder,
    addScore(n) { game.score += n; },
    seedRng,
    assetsReady() { return !!ASSETS.atlas && PLANTS.length > 0; },
    // Start a round without the rAF loop or audio; the harness drives time via
    // tick(dt) so a 150s round runs deterministically in a fraction of a second.
    // `players` here means DIFFICULTY (back-compat with the harness); the bot
    // drives a single co-op slot.
    startHeadless({ players = 1, seed = null } = {}) {
      if (seed != null) seedRng(seed);
      selectedDifficulty = players;
      sound.setMuted(true);
      game = createGame(1, players);
      gameState = "playing";
      running = false;
      startScreen.classList.add("hidden");
      pauseScreen.classList.add("hidden");
      resultScreen.classList.add("hidden");
      return true;
    },
    // One deterministic frame. Mirrors loop() but with a caller-supplied dt and
    // optional rendering (skip it for fast data-only runs).
    tick(dt, doRender = false) {
      if (pressed("p") && gameState === "playing") togglePause();
      update(dt);
      if (doRender && game) render();
      clearJustPressed();
      return gameState;
    },
  };
}

loadAssets()
  .then(() => { startBtn.disabled = false; startBtn.textContent = "Começar"; })
  .catch((err) => { console.error(err); startBtn.textContent = "Erro ao carregar assets"; });
