"use strict";

/*
 * Overgarden — web reimplementation (HTML5 Canvas).
 *
 * Faithful port of the core gameplay loop from the original Unity (LD46) project:
 *  - Player movement + stamina/run (Player.cs / StaminaBar.cs)
 *  - Plant plots with growth stages + life (StageScript.cs / LifeBar.cs)
 *  - Holding items: NOTHING / SEED / WATER / TOOL / PLANT (EventsManager.cs)
 *  - Seed stall selection sorted by rarity (SeedStallManager.cs)
 *  - Sales box that sells deposited produce over time (SalesManager.cs)
 *  - Difficulty by "number of players" multiplier {4,3,2,1} (DataHolder/StageScript)
 */

// ---------------------------------------------------------------------------
// Plant data (from Assets/Plants/*.asset), sorted by rarity like SeedStallManager.
// ---------------------------------------------------------------------------
const PLANTS = [
  { name: "Carrot",          rarity: 1, emoji: "🥕" },
  { name: "Potato",          rarity: 1, emoji: "🥔" },
  { name: "Tomato",          rarity: 1, emoji: "🍅" },
  { name: "Corn",            rarity: 2, emoji: "🌽" },
  { name: "SuspeciousLemon", rarity: 2, emoji: "🍋" },
  { name: "Aubergine",       rarity: 3, emoji: "🍆" },
  { name: "DarkCarrot",      rarity: 3, emoji: "🥕" },
  { name: "GrapeTomato",     rarity: 3, emoji: "🍇" },
  { name: "Pepper",          rarity: 3, emoji: "🌶️" },
  { name: "Sweetsop",        rarity: 3, emoji: "🍈" },
  { name: "GoldPotato",      rarity: 4, emoji: "🥇" },
  { name: "LeafAubergine",   rarity: 4, emoji: "🍆" },
  { name: "LemonTomato",     rarity: 4, emoji: "🍋" },
  { name: "PepperCorn",      rarity: 4, emoji: "🌽" },
].sort((a, b) => a.rarity - b.rarity);

// Holding item states (EventsManager.HoldingItem)
const HOLD = { NOTHING: 0, SEED: 1, WATER: 2, TOOL: 3, PLANT: 4 };

// Plant stages (StageScript.PlantStages, 1-indexed in original)
const STAGE = {
  VIRGIN: 1,   // untilled ground   -> needs TOOL
  TREATED: 2,  // tilled ground     -> needs SEED
  SMALL: 3,    // growing
  MEDIUM: 4,   // growing
  GREAT: 5,    // growing
  READY: 6,    // harvest with empty hands
  DIED: 7,
};

// Difficulty multiplier indexed by numberOfPlayers-1 (StageScript.DifficultyMultiplier)
const DIFFICULTY_MULT = [4, 3, 2, 1];

// ---------------------------------------------------------------------------
// Tuning. Original used per-frame counters; here we use real time (seconds).
// Smaller multiplier => faster growth AND faster decay (harder, like more players).
// ---------------------------------------------------------------------------
const WORLD = { w: 960, h: 600 };
const TUNE = {
  normalSpeed: 165,       // px/s
  runSpeed: 300,          // px/s
  maxStamina: 100,
  runDrain: 48,           // stamina/s while running
  walkRegen: 14,          // stamina/s while walking
  idleRegen: 26,          // stamina/s while idle
  // seconds for one progression stage at rarity 1, mult 4 (baseline)
  growthBase: 0.9,        // * rarity * mult  => seconds per growth stage
  lifeBase: 1.1,          // * rarity * mult  => seconds of life before dying
  interactRadius: 64,
  sellInterval: 5,        // SalesManager sells 1 every 5s
};

// ---------------------------------------------------------------------------
// Canvas / DOM
// ---------------------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const startScreen = document.getElementById("start-screen");
const pauseScreen = document.getElementById("pause-screen");

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

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let game = null;

function createGame(numberOfPlayers) {
  const mult = DIFFICULTY_MULT[numberOfPlayers - 1];

  // Plots: 2 rows x 3 cols in the center
  const plots = [];
  const cols = 3, rows = 2;
  const startX = 300, startY = 190, gapX = 130, gapY = 150;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      plots.push({
        x: startX + c * gapX,
        y: startY + r * gapY,
        stage: STAGE.VIRGIN,
        plant: null,        // selected PLANTS entry once seeded
        progress: 0,        // 0..1 within current growth stage
        life: 1,            // 1..0
      });
    }
  }

  // Stations around the field
  const stations = [
    { type: "tool",  x: 110, y: 300, label: "Ferramentas", emoji: "🛠️" },
    { type: "water", x: 850, y: 300, label: "Poço",        emoji: "🪣" },
    { type: "seed",  x: 480, y: 70,  label: "Sementes",    emoji: "🌱" },
    { type: "sales", x: 480, y: 540, label: "Vendas",      emoji: "📦" },
  ];

  return {
    mult,
    numberOfPlayers,
    score: 0,
    paused: false,
    over: false,
    player: {
      x: WORLD.w / 2,
      y: WORLD.h / 2,
      speed: 0,
      stamina: TUNE.maxStamina,
      dir: { x: 0, y: 1 },     // facing
      moving: false,
      holding: HOLD.NOTHING,
      heldSeed: null,          // PLANTS entry chosen at stall
      heldPlant: null,         // PLANTS entry harvested
      walkAnim: 0,
    },
    plots,
    stations,
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

function growthTime(plot)  { return TUNE.growthBase * plot.plant.rarity * game.mult; }
function lifeTime(plot)    { return TUNE.lifeBase   * plot.plant.rarity * game.mult; }

// ---------------------------------------------------------------------------
// Interactions (E key)
// ---------------------------------------------------------------------------
function handleInteract() {
  const p = game.player;

  // Seed menu has priority
  if (game.seedMenu.open) {
    selectSeed();
    return;
  }

  // Drop item (Q)
  if (pressed("q") && p.holding !== HOLD.PLANT) {
    p.holding = HOLD.NOTHING;
    p.heldSeed = null;
  }

  if (!pressed("e")) return;

  const station = nearestStation();
  if (station) {
    interactStation(station);
    return;
  }

  const plot = nearestPlot();
  if (plot) interactPlot(plot);
}

function interactStation(s) {
  const p = game.player;
  switch (s.type) {
    case "tool":
      if (p.holding !== HOLD.PLANT) { p.holding = HOLD.TOOL; p.heldSeed = null; }
      break;
    case "water":
      if (p.holding !== HOLD.PLANT) { p.holding = HOLD.WATER; p.heldSeed = null; }
      break;
    case "seed":
      if (p.holding !== HOLD.PLANT) { game.seedMenu.open = true; }
      break;
    case "sales":
      sellHeldPlant();
      break;
  }
}

// Mirrors StageScript.interact()
function interactPlot(plot) {
  const p = game.player;

  if (plot.stage === STAGE.DIED) {
    // Re-till dead plant back to virgin with a tool
    if (p.holding === HOLD.TOOL) {
      resetPlot(plot);
      p.holding = HOLD.NOTHING;
    }
    return;
  }

  // Correct-item progressions
  if (p.holding === HOLD.TOOL && plot.stage === STAGE.VIRGIN) {
    plot.stage = STAGE.TREATED;
    plot.life = 1;
    p.holding = HOLD.NOTHING;
    return;
  }
  if (p.holding === HOLD.SEED && plot.stage === STAGE.TREATED && p.heldSeed) {
    plot.plant = p.heldSeed;
    plot.stage = STAGE.SMALL;
    plot.progress = 0;
    plot.life = 1;
    p.holding = HOLD.NOTHING;
    p.heldSeed = null;
    return;
  }

  // Water a growing plant
  const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
  if (p.holding === HOLD.WATER && growing) {
    plot.life = 1;
    p.holding = HOLD.NOTHING;
    return;
  }

  // Harvest with empty hands
  if (p.holding === HOLD.NOTHING && plot.stage === STAGE.READY) {
    p.holding = HOLD.PLANT;
    p.heldPlant = plot.plant;
    resetPlot(plot);
  }
}

function resetPlot(plot) {
  plot.stage = STAGE.VIRGIN;
  plot.plant = null;
  plot.progress = 0;
  plot.life = 1;
}

// Mirrors SalesManager.OnTriggerStay2D deposit
function sellHeldPlant() {
  const p = game.player;
  if (p.holding !== HOLD.PLANT || !p.heldPlant) return;

  if (game.sales.plant === null) {
    game.sales.plant = p.heldPlant;
    game.sales.quantity = 1;
    game.score += 20;
  } else if (game.sales.plant.name === p.heldPlant.name) {
    game.sales.quantity += 1;
    game.score += 20;
  } else {
    return; // different produce: original ignores it, keep holding
  }
  p.holding = HOLD.NOTHING;
  p.heldPlant = null;
}

// Seed menu navigation
function selectSeed() {
  const p = game.player;
  p.holding = HOLD.SEED;
  p.heldSeed = PLANTS[game.seedMenu.index];
  game.seedMenu.open = false;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update(dt) {
  if (game.paused) return;

  // Seed menu freezes the player (isChoosingSeed)
  if (game.seedMenu.open) {
    if (pressed("a")) game.seedMenu.index = Math.max(0, game.seedMenu.index - 1);
    if (pressed("d")) game.seedMenu.index = Math.min(PLANTS.length - 1, game.seedMenu.index + 1);
    if (pressed("e")) selectSeed();
    game.player.moving = false;
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
  if (keys["w"] || keys["arrowup"]) dy -= 1;
  if (keys["s"] || keys["arrowdown"]) dy += 1;
  if (keys["a"] || keys["arrowleft"]) dx -= 1;
  if (keys["d"] || keys["arrowright"]) dx += 1;

  p.moving = dx !== 0 || dy !== 0;

  const running = (keys["shift"]) && p.moving && p.stamina > 0;
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
    p.dir = { x: dx, y: dy };
    p.x += dx * p.speed * dt;
    p.y += dy * p.speed * dt;
    p.walkAnim += dt * (running ? 14 : 9);
  } else {
    p.walkAnim = 0;
  }

  // Keep inside world
  p.x = Math.max(24, Math.min(WORLD.w - 24, p.x));
  p.y = Math.max(30, Math.min(WORLD.h - 24, p.y));
}

// Mirrors StageScript growth + LifeBar decay
function updatePlots(dt) {
  for (const plot of game.plots) {
    const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;

    if (growing) {
      // Grow
      plot.progress += dt / growthTime(plot);
      if (plot.progress >= 1) {
        plot.progress = 0;
        plot.stage += 1; // advance growth stage / reach READY
        plot.life = 1;
      }
      // Lose life over time; reaching 0 kills the plant
      plot.life -= dt / lifeTime(plot);
      if (plot.life <= 0) {
        plot.life = 0;
        plot.stage = STAGE.DIED;
      }
    } else if (plot.stage === STAGE.TREATED) {
      // Tilled ground also dries out and reverts to virgin
      plot.life -= dt / (TUNE.lifeBase * 2 * game.mult);
      if (plot.life <= 0) resetPlot(plot);
    }
  }
}

// Mirrors SalesManager.SellItem coroutine
function updateSales(dt) {
  const s = game.sales;
  if (s.quantity > 0) {
    s.sellTimer += dt;
    if (s.sellTimer >= TUNE.sellInterval) {
      s.sellTimer -= TUNE.sellInterval;
      s.quantity -= 1;
      game.score += 100;
      if (s.quantity === 0) s.plant = null;
    }
  } else {
    s.sellTimer = 0;
    s.plant = null;
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  drawBackground();
  for (const plot of game.plots) drawPlot(plot);
  for (const s of game.stations) drawStation(s);
  drawPlayer();
  drawHUD();
  drawInteractHint();
  if (game.seedMenu.open) drawSeedMenu();
}

function drawBackground() {
  // Grass with subtle checker
  ctx.fillStyle = "#6ab04c";
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  for (let y = 0; y < WORLD.h; y += 48) {
    for (let x = 0; x < WORLD.w; x += 48) {
      if (((x + y) / 48) % 2 === 0) ctx.fillRect(x, y, 48, 48);
    }
  }
  // Fence border
  ctx.strokeStyle = "#8a6d3b";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, WORLD.w - 8, WORLD.h - 8);
}

function drawPlot(plot) {
  const size = 92;
  const x = plot.x - size / 2, y = plot.y - size / 2;

  // Ground tile
  if (plot.stage === STAGE.VIRGIN) {
    ctx.fillStyle = "#5a8a3c";
    roundRect(x, y, size, size, 8, true, false);
    ctx.strokeStyle = "#4a7330";
    roundRect(x, y, size, size, 8, false, true);
  } else {
    // Tilled soil
    ctx.fillStyle = "#6b4a2b";
    roundRect(x, y, size, size, 8, true, false);
    ctx.fillStyle = "#5a3d22";
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 8, y + 14 + i * 18, size - 16, 6);
  }

  // Plant visual
  if (plot.plant && plot.stage >= STAGE.SMALL) {
    let scale = 0.4, alpha = 1;
    if (plot.stage === STAGE.SMALL)  scale = 0.45;
    if (plot.stage === STAGE.MEDIUM) scale = 0.7;
    if (plot.stage === STAGE.GREAT)  scale = 0.9;
    if (plot.stage === STAGE.READY)  scale = 1.1;
    if (plot.stage === STAGE.DIED)   { scale = 0.7; alpha = 0.55; }

    ctx.globalAlpha = alpha;
    const px = plot.x, py = plot.y - 4;
    if (plot.stage === STAGE.DIED) {
      drawEmoji("🥀", px, py, 46);
    } else {
      drawEmoji(plot.plant.emoji, px, py, 46 * scale + 14);
    }
    ctx.globalAlpha = 1;

    if (plot.stage === STAGE.READY) {
      // Glow ring on harvest-ready
      ctx.strokeStyle = "rgba(247,215,116,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(plot.x, plot.y, size / 2 - 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Progress + life bars while growing
  const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
  if (growing) {
    bar(x, y - 14, size, 5, plot.progress, "#7ec8ff", "#1f3a4d"); // growth
    bar(x, y - 7, size, 5, plot.life, lifeColor(plot.life), "#3a1f1f"); // life
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
  const w = 80, h = 64;
  const x = s.x - w / 2, y = s.y - h / 2;
  ctx.fillStyle = "#7a5230";
  roundRect(x, y, w, h, 8, true, false);
  ctx.fillStyle = "#5e3f24";
  roundRect(x, y + h - 14, w, 14, 4, true, false);
  drawEmoji(s.emoji, s.x, s.y - 4, 34);

  ctx.fillStyle = "#2a3a1f";
  ctx.font = "bold 12px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(s.label, s.x, y + h + 14);

  // Sales station shows stored produce
  if (s.type === "sales" && game.sales.plant) {
    drawEmoji(game.sales.plant.emoji, s.x + 26, s.y - 18, 22);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Trebuchet MS, sans-serif";
    ctx.fillText("x" + game.sales.quantity, s.x + 26, s.y + 2);
  }
}

function drawPlayer() {
  const p = game.player;
  const bob = Math.sin(p.walkAnim) * 3;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 18, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = "#3a6ea5";
  roundRect(p.x - 12, p.y - 14 + bob, 24, 28, 7, true, false);
  // Head
  ctx.fillStyle = "#f1c27d";
  ctx.beginPath();
  ctx.arc(p.x, p.y - 20 + bob, 10, 0, Math.PI * 2);
  ctx.fill();
  // Hat
  ctx.fillStyle = "#c9a227";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 26 + bob, 14, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(p.x - 7, p.y - 33 + bob, 14, 7);

  // Facing indicator (small eyes)
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(p.x + p.dir.x * 4 - 3, p.y - 21 + bob, 1.6, 0, Math.PI * 2);
  ctx.arc(p.x + p.dir.x * 4 + 3, p.y - 21 + bob, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Held item above head
  const held = heldEmoji();
  if (held) drawEmoji(held, p.x, p.y - 44 + bob, 26);
}

function heldEmoji() {
  const p = game.player;
  switch (p.holding) {
    case HOLD.TOOL:  return "🪓";
    case HOLD.WATER: return "🪣";
    case HOLD.SEED:  return p.heldSeed ? "🌱" : null;
    case HOLD.PLANT: return p.heldPlant ? p.heldPlant.emoji : null;
    default: return null;
  }
}

function drawHUD() {
  // Score
  ctx.fillStyle = "rgba(20,30,16,0.7)";
  roundRect(12, 12, 220, 36, 8, true, false);
  ctx.fillStyle = "#f7d774";
  ctx.font = "bold 22px Trebuchet MS, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Score: " + game.score, 24, 38);

  // Stamina bar
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

  // Held item label
  const label = heldLabel();
  if (label) {
    ctx.fillStyle = "rgba(20,30,16,0.7)";
    roundRect(12, WORLD.h - 46, 260, 34, 8, true, false);
    ctx.fillStyle = "#e7e0cd";
    ctx.font = "bold 16px Trebuchet MS, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Segurando: " + label, 24, WORLD.h - 24);
  }
}

function heldLabel() {
  const p = game.player;
  switch (p.holding) {
    case HOLD.TOOL:  return "Enxada 🪓";
    case HOLD.WATER: return "Água 🪣";
    case HOLD.SEED:  return p.heldSeed ? `Semente: ${p.heldSeed.name} ${p.heldSeed.emoji}` : "Semente";
    case HOLD.PLANT: return p.heldPlant ? `${p.heldPlant.name} ${p.heldPlant.emoji}` : "Colheita";
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
    if (station.type === "tool")  hint = "E: pegar enxada";
    if (station.type === "water") hint = "E: pegar água";
    if (station.type === "seed")  hint = p.holding !== HOLD.PLANT ? "E: escolher semente" : null;
    if (station.type === "sales") hint = p.holding === HOLD.PLANT ? "E: vender colheita" : null;
  } else if (plot) {
    if (plot.stage === STAGE.VIRGIN && p.holding === HOLD.TOOL) hint = "E: preparar terra";
    else if (plot.stage === STAGE.TREATED && p.holding === HOLD.SEED) hint = "E: plantar";
    else if (plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY && p.holding === HOLD.WATER) hint = "E: regar";
    else if (plot.stage === STAGE.READY && p.holding === HOLD.NOTHING) hint = "E: colher";
    else if (plot.stage === STAGE.DIED && p.holding === HOLD.TOOL) hint = "E: limpar terra";
  }

  if (!hint) return;
  ctx.fillStyle = "rgba(247,215,116,0.95)";
  ctx.font = "bold 16px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  const tw = ctx.measureText(hint).width;
  ctx.fillStyle = "rgba(20,30,16,0.85)";
  roundRect(p.x - tw / 2 - 10, p.y - 70, tw + 20, 24, 6, true, false);
  ctx.fillStyle = "#f7d774";
  ctx.fillText(hint, p.x, p.y - 53);
}

function drawSeedMenu() {
  ctx.fillStyle = "rgba(20,30,16,0.85)";
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);

  ctx.fillStyle = "#f7d774";
  ctx.font = "bold 30px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Escolha a semente", WORLD.w / 2, 130);
  ctx.fillStyle = "#b7d49a";
  ctx.font = "16px Trebuchet MS, sans-serif";
  ctx.fillText("A / D para navegar · E para escolher", WORLD.w / 2, 162);

  const idx = game.seedMenu.index;
  const spacing = 130;
  const cy = WORLD.h / 2 + 10;
  for (let off = -2; off <= 2; off++) {
    const i = idx + off;
    if (i < 0 || i >= PLANTS.length) continue;
    const plant = PLANTS[i];
    const cx = WORLD.w / 2 + off * spacing;
    const selected = off === 0;
    const r = selected ? 60 : 44;

    ctx.fillStyle = selected ? "rgba(247,215,116,0.18)" : "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = "#f7d774";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    drawEmoji(plant.emoji, cx, cy, selected ? 56 : 38);

    if (selected) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 20px Trebuchet MS, sans-serif";
      ctx.fillText(plant.name, cx, cy + 96);
      ctx.fillStyle = "#f7d774";
      ctx.font = "14px Trebuchet MS, sans-serif";
      ctx.fillText("Raridade " + "★".repeat(plant.rarity), cx, cy + 120);
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------
function drawEmoji(emoji, x, y, size) {
  ctx.font = size + "px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, x, y);
  ctx.textBaseline = "alphabetic";
}

function bar(x, y, w, h, t, fill, bg) {
  ctx.fillStyle = bg;
  roundRect(x, y, w, h, 2, true, false);
  ctx.fillStyle = fill;
  roundRect(x, y, w * Math.max(0, Math.min(1, t)), h, 2, true, false);
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

  // Pause toggle
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

document.getElementById("start-btn").addEventListener("click", startGame);
document.getElementById("resume-btn").addEventListener("click", togglePause);
document.getElementById("quit-btn").addEventListener("click", quitToMenu);

function startGame() {
  game = createGame(selectedPlayers);
  startScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function quitToMenu() {
  running = false;
  game = null;
  pauseScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
}

// Initial splash render
ctx.fillStyle = "#6ab04c";
ctx.fillRect(0, 0, WORLD.w, WORLD.h);
