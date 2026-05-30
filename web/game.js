"use strict";

/*
 * Overgarden — web reimplementation (HTML5 Canvas).
 *
 * Faithful port of the core gameplay loop from the original Unity (LD46) project,
 * now using the original art (sprites sliced from the Unity spritesheets) and audio.
 *
 *  - Player movement + stamina/run (Player.cs / StaminaBar.cs)
 *  - Plant plots with growth stages + life (StageScript.cs / LifeBar.cs)
 *  - Holding items: NOTHING / SEED / WATER / TOOL / PLANT (EventsManager.cs)
 *  - Seed stall selection sorted by rarity (SeedStallManager.cs)
 *  - Sales box selling produce over time (SalesManager.cs)
 *  - Difficulty by "number of players" multiplier {4,3,2,1} (DataHolder/StageScript)
 *  - Audio: theme, footsteps, watering, pickup (AudioManager.cs)
 */

// Holding item states (EventsManager.HoldingItem)
const HOLD = { NOTHING: 0, SEED: 1, WATER: 2, TOOL: 3, PLANT: 4 };

// Plant stages (StageScript.PlantStages, 1-indexed in original)
const STAGE = {
  VIRGIN: 1, TREATED: 2, SMALL: 3, MEDIUM: 4, GREAT: 5, READY: 6, DIED: 7,
};

// Difficulty multiplier indexed by numberOfPlayers-1 (StageScript.DifficultyMultiplier)
const DIFFICULTY_MULT = [4, 3, 2, 1];

const WORLD = { w: 960, h: 600 };
const TUNE = {
  normalSpeed: 165,
  runSpeed: 300,
  maxStamina: 100,
  runDrain: 48,
  walkRegen: 14,
  idleRegen: 26,
  // Life must run out BEFORE a growth stage completes, so the plant needs
  // watering mid-stage to survive (matches the original rarity*5 life vs
  // rarity*6 growth ratio in StageScript/LifeBar).
  growthBase: 1.8,   // * rarity * mult => seconds to complete a growth stage
  lifeBase: 1.5,     // * rarity * mult => seconds of life before dying (< growth)
  interactRadius: 70,
  sellInterval: 5,
};

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
    a.addEventListener("error", () => resolve(a), { once: true }); // tolerate missing audio
    a.load();
  });
}

async function loadAssets() {
  const atlas = await fetch("assets/atlas.json").then((r) => r.json());
  ASSETS.atlas = atlas;

  // Unique image sheets
  const sheets = new Set();
  for (const g of [atlas.character, atlas.items, atlas.plants, atlas.ui, atlas.tiles]) {
    for (const k in g) sheets.add(g[k].sheet);
  }
  await Promise.all([...sheets].map(async (s) => { ASSETS.img[s] = await loadImage(s); }));

  // Audio
  await Promise.all(Object.entries(atlas.audio).map(async ([k, file]) => {
    ASSETS.audio[k] = await loadAudio(file);
  }));

  // Build PLANTS list from plantData, sorted by rarity (stable by name)
  PLANTS = Object.entries(atlas.plantData)
    .map(([name, d]) => ({ name, rarity: d.rarity, main: d.main, stages: d.stages }))
    .sort((a, b) => a.rarity - b.rarity || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Audio control (mirrors AudioManager: theme loop, footsteps loop, one-shots)
// ---------------------------------------------------------------------------
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
  setMuted(m) {
    this.muted = m;
    for (const k in ASSETS.audio) {
      const a = ASSETS.audio[k];
      if (m) a.pause();
    }
    if (!m && game && !game.paused) this.theme();
  },
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = {};
const justPressed = {};
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (!keys[k]) justPressed[k] = true;
  keys[k] = true;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

function pressed(k) { return justPressed[k] === true; }
function clearJustPressed() { for (const k in justPressed) justPressed[k] = false; }

// Analog joystick state (mobile). x,y in [-1,1].
const touchMove = { x: 0, y: 0, active: false };
let seedNavLatch = false;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let game = null;

function createGame(numberOfPlayers) {
  const mult = DIFFICULTY_MULT[numberOfPlayers - 1];

  const plots = [];
  const cols = 3, rows = 2;
  const startX = 300, startY = 200, gapX = 130, gapY = 150;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      plots.push({
        x: startX + c * gapX, y: startY + r * gapY,
        stage: STAGE.VIRGIN, plant: null, progress: 0, life: 1,
      });
    }
  }

  const stations = [
    { type: "tool",  x: 110, y: 300, label: "Ferramentas", icon: "shovel" },
    { type: "water", x: 850, y: 300, label: "Poço",        icon: "water" },
    { type: "seed",  x: 480, y: 80,  label: "Sementes",    icon: "seed" },
    { type: "sales", x: 480, y: 545, label: "Vendas",      icon: "bag" },
  ];

  return {
    mult, numberOfPlayers,
    score: 0, paused: false,
    player: {
      x: WORLD.w / 2, y: WORLD.h / 2,
      speed: 0, stamina: TUNE.maxStamina,
      facing: "down", moving: false,
      holding: HOLD.NOTHING, heldSeed: null, heldPlant: null,
      anim: 0,
    },
    plots, stations,
    sales: { plant: null, quantity: 0, sellTimer: 0 },
    seedMenu: { open: false, index: 0 },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

function nearestStation() {
  const p = game.player;
  let best = null, bestD = TUNE.interactRadius;
  for (const s of game.stations) {
    const d = dist(p.x, p.y, s.x, s.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function nearestPlot() {
  const p = game.player;
  let best = null, bestD = TUNE.interactRadius;
  for (const plot of game.plots) {
    const d = dist(p.x, p.y, plot.x, plot.y);
    if (d < bestD) { bestD = d; best = plot; }
  }
  return best;
}

function growthTime(plot) { return TUNE.growthBase * plot.plant.rarity * game.mult; }
function lifeTime(plot)   { return TUNE.lifeBase   * plot.plant.rarity * game.mult; }

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
function handleInteract() {
  const p = game.player;

  if (game.seedMenu.open) { if (pressed("e")) selectSeed(); return; }

  if (pressed("q") && p.holding !== HOLD.PLANT) {
    p.holding = HOLD.NOTHING; p.heldSeed = null;
  }

  if (!pressed("e")) return;

  const station = nearestStation();
  if (station) { interactStation(station); return; }
  const plot = nearestPlot();
  if (plot) interactPlot(plot);
}

function interactStation(s) {
  const p = game.player;
  switch (s.type) {
    case "tool":
      if (p.holding !== HOLD.PLANT) { p.holding = HOLD.TOOL; p.heldSeed = null; sound.pickup(); }
      break;
    case "water":
      if (p.holding !== HOLD.PLANT) { p.holding = HOLD.WATER; p.heldSeed = null; sound.pickup(); }
      break;
    case "seed":
      if (p.holding !== HOLD.PLANT) { game.seedMenu.open = true; }
      break;
    case "sales":
      sellHeldPlant();
      break;
  }
}

function interactPlot(plot) {
  const p = game.player;

  if (plot.stage === STAGE.DIED) {
    if (p.holding === HOLD.TOOL) { resetPlot(plot); p.holding = HOLD.NOTHING; sound.pickup(); }
    return;
  }
  if (p.holding === HOLD.TOOL && plot.stage === STAGE.VIRGIN) {
    plot.stage = STAGE.TREATED; plot.life = 1; p.holding = HOLD.NOTHING; sound.pickup();
    return;
  }
  if (p.holding === HOLD.SEED && plot.stage === STAGE.TREATED && p.heldSeed) {
    plot.plant = p.heldSeed; plot.stage = STAGE.SMALL; plot.progress = 0; plot.life = 1;
    p.holding = HOLD.NOTHING; p.heldSeed = null; sound.pickup();
    return;
  }
  const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
  if (p.holding === HOLD.WATER && growing) {
    plot.life = 1; p.holding = HOLD.NOTHING; sound.watering();
    return;
  }
  if (p.holding === HOLD.NOTHING && plot.stage === STAGE.READY) {
    p.holding = HOLD.PLANT; p.heldPlant = plot.plant; resetPlot(plot); sound.pickup();
  }
}

function resetPlot(plot) {
  plot.stage = STAGE.VIRGIN; plot.plant = null; plot.progress = 0; plot.life = 1;
}

function sellHeldPlant() {
  const p = game.player;
  if (p.holding !== HOLD.PLANT || !p.heldPlant) return;
  if (game.sales.plant === null) {
    game.sales.plant = p.heldPlant; game.sales.quantity = 1; game.score += 20;
  } else if (game.sales.plant.name === p.heldPlant.name) {
    game.sales.quantity += 1; game.score += 20;
  } else { return; }
  p.holding = HOLD.NOTHING; p.heldPlant = null; sound.pickup();
}

function selectSeed() {
  const p = game.player;
  p.holding = HOLD.SEED; p.heldSeed = PLANTS[game.seedMenu.index];
  game.seedMenu.open = false; sound.pickup();
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update(dt) {
  if (game.paused) return;

  if (game.seedMenu.open) {
    if (pressed("a")) game.seedMenu.index = Math.max(0, game.seedMenu.index - 1);
    if (pressed("d")) game.seedMenu.index = Math.min(PLANTS.length - 1, game.seedMenu.index + 1);
    // Joystick: tilt left/right to step through seeds (one step per tilt).
    if (touchMove.active && Math.abs(touchMove.x) > 0.55 && !seedNavLatch) {
      const dir = touchMove.x > 0 ? 1 : -1;
      game.seedMenu.index = Math.max(0, Math.min(PLANTS.length - 1, game.seedMenu.index + dir));
      seedNavLatch = true;
    } else if (Math.abs(touchMove.x) < 0.3) {
      seedNavLatch = false;
    }
    handleInteract();
    game.player.moving = false;
    sound.footstepsOff();
    return;
  }

  updatePlayer(dt);
  handleInteract();
  updatePlots(dt);
  updateSales(dt);
}

function updatePlayer(dt) {
  const p = game.player;
  let dx = 0, dy = 0;
  let analogMag = 1;

  const joyMag = Math.hypot(touchMove.x, touchMove.y);
  if (touchMove.active && joyMag > 0.22) {
    // Analog joystick: variable speed by tilt magnitude.
    dx = touchMove.x; dy = touchMove.y;
    analogMag = Math.min(1, joyMag);
  } else {
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
  }

  const wasMoving = p.moving;
  p.moving = dx !== 0 || dy !== 0;

  const running = keys["shift"] && p.moving && p.stamina > 0;
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
    // Facing: dominant axis
    if (Math.abs(dx) > Math.abs(dy)) p.facing = dx < 0 ? "left" : "right";
    else p.facing = dy < 0 ? "up" : "down";
    const sp = p.speed * analogMag;
    p.x += dx * sp * dt;
    p.y += dy * sp * dt;
    p.anim += dt * (running ? 12 : 8);
    if (!wasMoving) sound.footstepsOn();
  } else {
    p.anim += dt * 3; // slow idle/hold animation
    if (wasMoving) sound.footstepsOff();
  }

  p.x = Math.max(28, Math.min(WORLD.w - 28, p.x));
  p.y = Math.max(40, Math.min(WORLD.h - 28, p.y));
}

function updatePlots(dt) {
  for (const plot of game.plots) {
    const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
    if (growing) {
      plot.progress += dt / growthTime(plot);
      if (plot.progress >= 1) { plot.progress = 0; plot.stage += 1; plot.life = 1; }
      plot.life -= dt / lifeTime(plot);
      if (plot.life <= 0) { plot.life = 0; plot.stage = STAGE.DIED; }
    } else if (plot.stage === STAGE.TREATED) {
      plot.life -= dt / (TUNE.lifeBase * 2 * game.mult);
      if (plot.life <= 0) resetPlot(plot);
    }
  }
}

function updateSales(dt) {
  const s = game.sales;
  if (s.quantity > 0) {
    s.sellTimer += dt;
    if (s.sellTimer >= TUNE.sellInterval) {
      s.sellTimer -= TUNE.sellInterval;
      s.quantity -= 1; game.score += 100;
      if (s.quantity === 0) s.plant = null;
    }
  } else { s.sellTimer = 0; s.plant = null; }
}

// ---------------------------------------------------------------------------
// Sprite drawing
// ---------------------------------------------------------------------------
function drawFrame(sheetName, rect, dx, dy, dw, dh) {
  const img = ASSETS.img[sheetName];
  if (!img) return;
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, dx, dy, dw, dh);
}

// Draw a sprite frame anchored at a point (ax,ay = bottom-center), scaled to target height.
function drawSpriteAnchored(sheetName, rect, ax, ay, targetH) {
  const scale = targetH / rect.h;
  const w = rect.w * scale;
  drawFrame(sheetName, rect, ax - w / 2, ay - targetH, w, targetH);
}

function charFrame() {
  const p = game.player;
  let set;
  if (p.moving) set = "walk_" + p.facing;
  else if (p.holding !== HOLD.NOTHING) set = "hold_" + p.facing;
  else set = "idle_" + p.facing;
  const data = ASSETS.atlas.character[set];
  const idx = Math.floor(p.anim) % data.frames.length;
  return { sheet: data.sheet, rect: data.frames[idx] };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  drawBackground();
  // Sort plots+player by y for simple depth ordering
  for (const plot of game.plots) drawPlot(plot);
  for (const s of game.stations) drawStation(s);
  drawPlayer();
  drawHUD();
  drawInteractHint();
  if (game.seedMenu.open) drawSeedMenu();
}

// Draw one 32px cell (col,row) of a tileset sheet, scaled to dw×dh.
function drawTile(sheetKey, col, row, dx, dy, dw, dh) {
  const t = ASSETS.atlas.tiles[sheetKey];
  if (!t) return;
  ctx.drawImage(ASSETS.img[t.sheet], col * 32, row * 32, 32, 32, dx, dy, dw, dh);
}

const TILE_PX = 48; // display size of a ground tile

function drawBackground() {
  // Grass ground (tallgrass solid-grass cell 1,1), tiled across the world.
  ctx.fillStyle = "#6ab04c";
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  if (ASSETS.atlas.tiles.grass) {
    for (let y = 0; y < WORLD.h; y += TILE_PX) {
      for (let x = 0; x < WORLD.w; x += TILE_PX) {
        drawTile("grass", 1, 3, x, y, TILE_PX, TILE_PX); // solid grass field cell
      }
    }
  }
  drawFence();
}

// Fence border using fence.png tiles (horizontal run top/bottom, posts on sides).
function drawFence() {
  if (!ASSETS.atlas.tiles.fence) return;
  const F = 40;
  // top & bottom horizontal rails (cell 1,0)
  for (let x = 0; x < WORLD.w; x += F) {
    drawTile("fence", 1, 0, x, -4, F, F);
    drawTile("fence", 1, 0, x, WORLD.h - F + 4, F, F);
  }
  // left & right vertical posts (cell 1,1)
  for (let y = F - 8; y < WORLD.h - F; y += F) {
    drawTile("fence", 1, 1, -4, y, F, F);
    drawTile("fence", 1, 1, WORLD.w - F + 4, y, F, F);
  }
}

function drawPlot(plot) {
  const size = 96;
  const x = plot.x - size / 2, y = plot.y - size / 2;

  if (plot.stage === STAGE.VIRGIN) {
    // Untilled: just grass with a subtle marker so the plot is findable.
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(x + 6, y + 6, size - 12, size - 12, 10, true, false);
    ctx.strokeStyle = "rgba(60,45,25,0.35)"; ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    roundRect(x + 6, y + 6, size - 12, size - 12, 10, false, true);
    ctx.setLineDash([]);
  } else if (ASSETS.atlas.tiles.soil) {
    // Tilled: 3x3 nine-slice from plowed_soil (rows 2-4 = grass-edged soil field).
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        drawTile("soil", c, r + 2, x + c * 32, y + r * 32, 32, 32);
      }
    }
  } else {
    ctx.fillStyle = "#7a5230";
    roundRect(x, y, size, size, 8, true, false);
  }

  // Plant sprite (stages from Plants_1 sheet; stage index = stage-3)
  if (plot.plant && plot.stage >= STAGE.SMALL) {
    const baseY = plot.y + size / 2 - 14; // anchor near soil bottom
    if (plot.stage === STAGE.DIED) {
      const r = plot.plant.stages[2] || plot.plant.stages[0];
      ctx.globalAlpha = 0.45;
      drawSpriteAnchored(r.sheet, r, plot.x, baseY, 58);
      ctx.globalAlpha = 1;
      // dark tint
      ctx.fillStyle = "rgba(60,40,20,0.35)";
      roundRect(x + 8, y + 8, size - 16, size - 16, 6, true, false);
    } else {
      const idx = Math.min(plot.stage - STAGE.SMALL, plot.plant.stages.length - 1);
      const r = plot.plant.stages[idx];
      const targetH = [40, 54, 66, 72][idx] || 60;
      drawSpriteAnchored(r.sheet, r, plot.x, baseY, targetH);
      if (plot.stage === STAGE.READY) {
        ctx.strokeStyle = "rgba(247,215,116,0.9)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(plot.x, plot.y, size / 2 - 2, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
  if (growing) {
    bar(x, y - 14, size, 5, plot.progress, "#7ec8ff", "#1f3a4d");
    bar(x, y - 7, size, 5, plot.life, lifeColor(plot.life), "#3a1f1f");
  } else if (plot.stage === STAGE.TREATED) {
    bar(x, y - 8, size, 5, plot.life, "#caa46a", "#3a2a1f");
  }
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

  if (s.type === "sales" && game.sales.plant) {
    const m = game.sales.plant.main;
    if (m) drawFrame(m.sheet, m, s.x + 22, s.y - 26, 22, 22);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Trebuchet MS, sans-serif";
    ctx.fillText("x" + game.sales.quantity, s.x + 33, s.y - 4);
  }
}

function drawPlayer() {
  const p = game.player;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 16, 18, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  const f = charFrame();
  drawSpriteAnchored(f.sheet, f.rect, p.x, p.y + 18, 76);

  // Held item floating above head
  drawHeldIcon(p.x, p.y - 56);
}

function drawHeldIcon(cx, cy) {
  const p = game.player;
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

function drawHUD() {
  ctx.fillStyle = "rgba(20,30,16,0.7)";
  roundRect(12, 12, 220, 36, 8, true, false);
  ctx.fillStyle = "#f7d774";
  ctx.font = "bold 22px Trebuchet MS, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Score: " + game.score, 24, 38);

  const sx = WORLD.w - 232, sy = 16, sw = 220, sh = 18;
  ctx.fillStyle = "rgba(20,30,16,0.7)";
  roundRect(sx - 8, sy - 4, sw + 16, sh + 24, 8, true, false);
  ctx.fillStyle = "#3a1f1f";
  roundRect(sx, sy, sw, sh, 5, true, false);
  ctx.fillStyle = "#5fd35f";
  roundRect(sx, sy, sw * (game.player.stamina / TUNE.maxStamina), sh, 5, true, false);
  ctx.fillStyle = "#fff";
  ctx.font = "11px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("STAMINA", sx + sw / 2, sy + sh + 14);

  const label = heldLabel();
  if (label) {
    ctx.fillStyle = "rgba(20,30,16,0.7)";
    roundRect(12, WORLD.h - 46, 300, 34, 8, true, false);
    ctx.fillStyle = "#e7e0cd";
    ctx.font = "bold 16px Trebuchet MS, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Segurando: " + label, 24, WORLD.h - 24);
  }
}

function heldLabel() {
  const p = game.player;
  switch (p.holding) {
    case HOLD.TOOL: return "Enxada";
    case HOLD.WATER: return "Água";
    case HOLD.SEED: return p.heldSeed ? "Semente: " + p.heldSeed.name : "Semente";
    case HOLD.PLANT: return p.heldPlant ? p.heldPlant.name : "Colheita";
    default: return null;
  }
}

function drawInteractHint() {
  if (game.seedMenu.open) return;
  const p = game.player;
  const station = nearestStation();
  const plot = !station ? nearestPlot() : null;
  let hint = null;

  if (station) {
    if (station.type === "tool") hint = "E: pegar enxada";
    if (station.type === "water") hint = "E: pegar água";
    if (station.type === "seed") hint = p.holding !== HOLD.PLANT ? "E: escolher semente" : null;
    if (station.type === "sales") hint = p.holding === HOLD.PLANT ? "E: vender colheita" : null;
  } else if (plot) {
    if (plot.stage === STAGE.VIRGIN && p.holding === HOLD.TOOL) hint = "E: preparar terra";
    else if (plot.stage === STAGE.TREATED && p.holding === HOLD.SEED) hint = "E: plantar";
    else if (plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY && p.holding === HOLD.WATER) hint = "E: regar";
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

function drawSeedMenu() {
  ctx.fillStyle = "rgba(20,30,16,0.88)";
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);

  ctx.fillStyle = "#f7d774";
  ctx.font = "bold 30px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Escolha a semente", WORLD.w / 2, 120);
  ctx.fillStyle = "#b7d49a";
  ctx.font = "16px Trebuchet MS, sans-serif";
  ctx.fillText("A / D para navegar · E para escolher", WORLD.w / 2, 150);

  const idx = game.seedMenu.index;
  const spacing = 135;
  const cy = WORLD.h / 2 + 10;
  for (let off = -2; off <= 2; off++) {
    const i = idx + off;
    if (i < 0 || i >= PLANTS.length) continue;
    const plant = PLANTS[i];
    const cx = WORLD.w / 2 + off * spacing;
    const selected = off === 0;
    const r = selected ? 62 : 46;

    ctx.fillStyle = selected ? "rgba(247,215,116,0.18)" : "rgba(255,255,255,0.06)";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    if (selected) { ctx.strokeStyle = "#f7d774"; ctx.lineWidth = 4; ctx.stroke(); }

    // Use the main produce icon (Plants_2 sheet)
    if (plant.main) {
      const h = selected ? 64 : 44, w = h * (plant.main.w / plant.main.h);
      drawFrame(plant.main.sheet, plant.main, cx - w / 2, cy - h / 2, w, h);
    }

    if (selected) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 20px Trebuchet MS, sans-serif";
      ctx.fillText(plant.name, cx, cy + 100);
      ctx.fillStyle = "#f7d774";
      ctx.font = "14px Trebuchet MS, sans-serif";
      ctx.fillText("Raridade " + "★".repeat(plant.rarity), cx, cy + 124);
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing primitives
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

  if (pressed("p")) togglePause();

  update(dt);
  render();
  clearJustPressed();
  requestAnimationFrame(loop);
}

function togglePause() {
  if (!game || game.seedMenu.open) return;
  game.paused = !game.paused;
  pauseScreen.classList.toggle("hidden", !game.paused);
  if (game.paused) sound.footstepsOff();
  if (game.paused) { for (const k in ASSETS.audio) ASSETS.audio[k].pause(); }
  else if (!sound.muted) sound.theme();
}

// ---------------------------------------------------------------------------
// Menu wiring
// ---------------------------------------------------------------------------
let selectedPlayers = 1;

document.querySelectorAll(".diff-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedPlayers = parseInt(btn.dataset.players, 10);
  });
});

startBtn.addEventListener("click", startGame);
document.getElementById("resume-btn").addEventListener("click", togglePause);
document.getElementById("quit-btn").addEventListener("click", quitToMenu);
muteBox.addEventListener("change", () => sound.setMuted(muteBox.checked));

// On-screen touch controls: feed the same keys/justPressed state as the keyboard.
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
    const release = (e) => {
      e.preventDefault();
      keys[key] = false;
      btn.classList.remove("pressed");
    };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });
}
bindTouch();

// Analog joystick: drag the knob; feeds the touchMove vector.
function bindJoystick() {
  const js = document.getElementById("joystick");
  const knob = document.getElementById("knob");
  if (!js || !knob) return;
  const R = 46; // max knob travel (px)
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
  game = createGame(selectedPlayers);
  startScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  showTouchControls(true);
  sound.setMuted(muteBox.checked);
  if (!sound.muted) sound.theme();
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function quitToMenu() {
  running = false;
  game = null;
  for (const k in ASSETS.audio) { ASSETS.audio[k].pause(); ASSETS.audio[k].currentTime = 0; }
  showTouchControls(false);
  pauseScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
ctx.fillStyle = "#6ab04c";
ctx.fillRect(0, 0, WORLD.w, WORLD.h);

// Debug hook for automated/visual testing (only with ?debug in the URL).
if (location.search.includes("debug")) {
  window.__OG__ = {
    get game() { return game; },
    get PLANTS() { return PLANTS; },
    teleport(x, y) { game.player.x = x; game.player.y = y; },
    openSeedMenu(i = 0) { game.seedMenu.open = true; game.seedMenu.index = i; },
    setPlot(i, patch) { Object.assign(game.plots[i], patch); },
  };
}

loadAssets()
  .then(() => {
    startBtn.disabled = false;
    startBtn.textContent = "Começar";
  })
  .catch((err) => {
    console.error(err);
    startBtn.textContent = "Erro ao carregar assets";
  });
