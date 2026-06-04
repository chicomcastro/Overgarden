"use strict";
/*
 * Overgarden — browser layer: rendering, input (keyboard/gamepad/touch), audio
 * and the menu/loop, on top of the pure simulation in sim.js.
 *
 * The simulation (state + update) lives in sim.js so it runs identically here
 * and on the authoritative co-op server. This file owns everything the sim
 * doesn't: canvas drawing, the input->intent layer, audio, and the DOM screens.
 */
import * as Sim from "./sim.js";
import { Net } from "./net.js";

const { HOLD, STAGE, WORLD, TUNE, ROUND, ORDER, COOP } = Sim;

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
  await Promise.all(Object.entries(atlas.audio).map(async ([k, file]) => { ASSETS.audio[k] = await loadAudio(file); }));
  Sim.setPlants(Sim.buildPlants(atlas));
  try { LEVELS = (await fetch("assets/levels.json").then((r) => r.json())).levels || []; } catch (_) { LEVELS = []; }
}

// ---------------------------------------------------------------------------
// Audio
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

// Play a list of sim sound events as one-shots.
function playEvents(arr) {
  for (const e of arr) {
    if (e === "pickup") sound.pickup();
    else if (e === "watering") sound.watering();
    else if (e === "ding") sound.ding();
    else if (e === "fail") sound.fail();
  }
}

// ---------------------------------------------------------------------------
// Input (keyboard + gamepad + touch) -> per-player intents
// ---------------------------------------------------------------------------
const keys = {};
const justPressed = {};
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

function keymapForSlot(slot, playerCount) {
  if (slot === 0) {
    return playerCount === 1
      ? { up: ["w", "arrowup"], down: ["s", "arrowdown"], left: ["a", "arrowleft"], right: ["d", "arrowright"], run: ["shift"], interact: ["e"], drop: ["q"], navL: ["a", "arrowleft"], navR: ["d", "arrowright"], confirm: ["e"] }
      : { up: ["w"], down: ["s"], left: ["a"], right: ["d"], run: ["shiftleft"], interact: ["e"], drop: ["q"], navL: ["a"], navR: ["d"], confirm: ["e"] };
  }
  if (slot === 1) {
    return { up: ["arrowup"], down: ["arrowdown"], left: ["arrowleft"], right: ["arrowright"], run: ["shiftright"], interact: ["slash", "enter"], drop: ["period"], navL: ["arrowleft"], navR: ["arrowright"], confirm: ["slash", "enter"] };
  }
  return null;
}

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
  if (edge("pause")) justPressed["p"] = true;
  return { mx, my, run: cur.run, interact: edge("interact"), drop: edge("drop"), navL: edge("navL"), navR: edge("navR"), confirm: edge("interact") };
}

function gatherIntents() {
  const out = [];
  for (let i = 0; i < game.players.length; i++) {
    const dev = game.players[i].device;
    let it;
    if (dev.type === "bot") {
      it = (game._botIntents && game._botIntents[i]) || Sim.ZERO_INTENT();
    } else if (dev.type === "remote") {
      it = game._remoteIntents && game._remoteIntents[i] ? game._remoteIntents[i] : Sim.ZERO_INTENT();
    } else if (dev.type === "gamepad") {
      it = gamepadIntent(dev.index) || Sim.ZERO_INTENT();
    } else {
      const km = dev.keymap;
      let mx = (anyDown(km.right) ? 1 : 0) - (anyDown(km.left) ? 1 : 0);
      let my = (anyDown(km.down) ? 1 : 0) - (anyDown(km.up) ? 1 : 0);
      it = { mx, my, run: anyDown(km.run), interact: anyPressed(km.interact), drop: anyPressed(km.drop), navL: anyPressed(km.navL), navR: anyPressed(km.navR), confirm: anyPressed(km.confirm) };
      if (i === 0 && touchMove.active && Math.hypot(touchMove.x, touchMove.y) > 0.22) { it.mx = touchMove.x; it.my = touchMove.y; }
    }
    out.push(it);
  }
  return out;
}

function assignDevices(playerCount) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const devices = [];
  let padCursor = 0;
  for (let slot = 0; slot < playerCount; slot++) {
    const km = keymapForSlot(slot, playerCount);
    if (km) devices.push({ type: "keyboard", keymap: km });
    else if (pads[padCursor]) devices.push({ type: "gamepad", index: pads[padCursor++].index });
    else devices.push({ type: "keyboard", keymap: keymapForSlot(0, playerCount) });
  }
  return devices;
}

// ---------------------------------------------------------------------------
// Game state (the sim state) + thin wrapper
// ---------------------------------------------------------------------------
let gameState = "menu"; // menu | playing | result
let game = null;
let pendingSeed = null;
let footActive = false;
let LEVELS = [];
let currentMode = "quick"; // quick | campaign | online
let currentLevelIndex = -1;

function createGame(playerCount, { difficulty = 1, level = null } = {}) {
  const s = Sim.createState({ playerCount, difficulty, seed: pendingSeed, level });
  pendingSeed = null;
  const devices = assignDevices(playerCount);
  s.players.forEach((p, i) => { p.device = devices[i]; });
  s.player = s.players[0];          // back-compat aliases for the harness/debug
  s.seedMenu = s.players[0].seedMenu;
  return s;
}

// ---- Campaign progress (localStorage) ----
const PROGRESS_KEY = "overgarden.campaign";
function loadProgress() { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (_) { return {}; } }
function saveStars(id, stars) { const p = loadProgress(); if ((p[id] || 0) < stars) { p[id] = stars; try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (_) {} } }
function levelUnlocked(i) { return i <= 0 || (loadProgress()[LEVELS[i - 1].id] || 0) >= 1; }

// Advance one frame: gather intents, step the sim, then handle the audio/UI
// side effects the sim deliberately doesn't.
function stepGame(dt, doRender, withAudio) {
  if (pressed("p") && gameState === "playing") togglePause();
  if (gameState === "playing" && !game.paused) {
    const intents = gatherIntents();
    Sim.step(game, intents, dt);
    if (withAudio) {
      playEvents(game.events);
      if (game.anyMoving && !footActive) { sound.footstepsOn(); footActive = true; }
      else if (!game.anyMoving && footActive) { sound.footstepsOff(); footActive = false; }
    }
    game.events.length = 0;
    if (game.over) finishRound();
  }
  if (doRender && game) render();
  clearJustPressed();
}

function finishRound() {
  gameState = "result";
  footActive = false;
  sound.footstepsOff();
  for (const k in ASSETS.audio) ASSETS.audio[k].pause();
  showTouchControls(false);
  const r = game.result;
  if (currentMode === "campaign" && currentLevelIndex >= 0) saveStars(LEVELS[currentLevelIndex].id, r.stars);
  document.getElementById("result-stars").innerHTML =
    [0, 1, 2].map((i) => `<span class="${i < r.stars ? "on" : "off"}">★</span>`).join("");
  document.getElementById("result-score").textContent = "Score: " + r.score;
  document.getElementById("result-stats").textContent =
    (currentMode === "campaign" ? `${game.levelName} · ` : "") +
    `Entregues: ${r.delivered} · perdidos: ${r.expired}` +
    (r.stars < 3 ? ` · próxima ★ em ${r.goals[Math.min(r.stars, 2)]}` : " · máximo!");
  setResultButtons();
  resultScreen.classList.remove("hidden");
}

// Result-screen buttons depend on the mode (quick = replay/menu;
// campaign = next stage/map).
function setResultButtons() {
  const again = document.getElementById("again-btn"), menu = document.getElementById("menu-btn");
  again.classList.remove("hidden");
  if (currentMode === "campaign") {
    const next = currentLevelIndex + 1;
    const hasNext = next < LEVELS.length && levelUnlocked(next);
    again.textContent = hasNext ? "Próxima fase ▶" : "Repetir fase";
    again.onclick = () => startLevel(hasNext ? next : currentLevelIndex);
    menu.textContent = "Mapa"; menu.onclick = openCampaign;
  } else {
    again.textContent = "Jogar de novo"; again.onclick = startGame;
    menu.textContent = "Menu"; menu.onclick = quitToMenu;
  }
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
  if (game.shake > 0) ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
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
    for (let y = 0; y < WORLD.h; y += TILE_PX) for (let x = 0; x < WORLD.w; x += TILE_PX) drawTile("grass", 1, 3, x, y, TILE_PX, TILE_PX);
  }
  drawFence();
}
function drawFence() {
  if (!ASSETS.atlas.tiles.fence) return;
  const F = 40;
  for (let x = 0; x < WORLD.w; x += F) { drawTile("fence", 1, 0, x, -4, F, F); drawTile("fence", 1, 0, x, WORLD.h - F + 4, F, F); }
  for (let y = F - 8; y < WORLD.h - F; y += F) { drawTile("fence", 1, 1, -4, y, F, F); drawTile("fence", 1, 1, WORLD.w - F + 4, y, F, F); }
}

function drawPlot(plot) {
  const size = 96;
  const x = plot.x - size / 2, y = plot.y - size / 2;
  if (plot.stage === STAGE.VIRGIN) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(x + 6, y + 6, size - 12, size - 12, 10, true, false);
    ctx.strokeStyle = "rgba(60,45,25,0.35)"; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    roundRect(x + 6, y + 6, size - 12, size - 12, 10, false, true);
    ctx.setLineDash([]);
  } else if (ASSETS.atlas.tiles.soil) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) drawTile("soil", c, r + 2, x + c * 32, y + r * 32, 32, 32);
  } else {
    ctx.fillStyle = "#7a5230"; roundRect(x, y, size, size, 8, true, false);
  }
  const growing = plot.stage >= STAGE.SMALL && plot.stage < STAGE.READY;
  const wilting = growing && plot.life <= 0;
  if (plot.plant && plot.stage >= STAGE.SMALL) {
    const baseY = plot.y + size / 2 - 14;
    if (plot.stage === STAGE.DIED) {
      const r = plot.plant.stages[2] || plot.plant.stages[0];
      ctx.globalAlpha = 0.45; drawSpriteAnchored(r.sheet, r, plot.x, baseY, 58); ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(60,40,20,0.35)"; roundRect(x + 8, y + 8, size - 16, size - 16, 6, true, false);
    } else {
      const idx = Math.min(plot.stage - STAGE.SMALL, plot.plant.stages.length - 1);
      const r = plot.plant.stages[idx];
      const targetH = [40, 54, 66, 72][idx] || 60;
      if (wilting) {
        ctx.globalAlpha = 0.8; drawSpriteAnchored(r.sheet, r, plot.x, baseY + 4, targetH * 0.92); ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(180,90,30,0.22)"; roundRect(x + 8, y + 8, size - 16, size - 16, 6, true, false);
      } else {
        drawSpriteAnchored(r.sheet, r, plot.x, baseY, targetH);
      }
      if (plot.stage === STAGE.READY) {
        ctx.strokeStyle = "rgba(247,215,116,0.9)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(plot.x, plot.y, size / 2 - 2, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  if (growing) {
    bar(x, y - 14, size, 5, plot.progress, "#7ec8ff", "#1f3a4d");
    if (wilting) { bar(x, y - 7, size, 5, 1 - plot.wilt / TUNE.wiltGrace, "#e74c3c", "#3a1f1f"); drawWaterCue(plot, true); }
    else { bar(x, y - 7, size, 5, plot.life, lifeColor(plot.life), "#3a1f1f"); if (plot.life < 0.4) drawWaterCue(plot, false); }
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
function lifeColor(t) { return t > 0.5 ? "#5fd35f" : t > 0.25 ? "#f0c419" : "#e74c3c"; }

function drawStation(s) {
  const w = 84, h = 66;
  const x = s.x - w / 2, y = s.y - h / 2;
  ctx.fillStyle = "#7a5230"; roundRect(x, y, w, h, 8, true, false);
  ctx.fillStyle = "#5e3f24"; roundRect(x, y + h - 14, w, 14, 4, true, false);
  const item = ASSETS.atlas.items[s.icon];
  if (item) { const ih = 40, iw = ih * (item.w / item.h); drawFrame(item.sheet, { x: 0, y: 0, w: item.w, h: item.h }, s.x - iw / 2, s.y - ih / 2 - 4, iw, ih); }
  ctx.fillStyle = "#2a3a1f"; ctx.font = "bold 12px Trebuchet MS, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(s.label, s.x, y + h + 14);
}

function drawPlayers() {
  const coop = game.playerCount > 1;
  const order = [...game.players].sort((a, b) => a.y - b.y);
  for (const p of order) {
    ctx.fillStyle = coop ? hexAlpha(p.color, 0.5) : "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 16, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (coop) { ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y + 16, 19, 7, 0, 0, Math.PI * 2); ctx.stroke(); }
    const f = charFrame(p);
    drawSpriteAnchored(f.sheet, f.rect, p.x, p.y + 18, 76);
    drawHeldIcon(p.x, p.y - 56, p);
    if (coop) {
      ctx.fillStyle = p.color; ctx.font = "bold 12px Trebuchet MS, sans-serif"; ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 3;
      ctx.strokeText("P" + (p.index + 1), p.x, p.y - 64); ctx.fillText("P" + (p.index + 1), p.x, p.y - 64);
      bar(p.x - 18, p.y + 24, 36, 4, p.stamina / TUNE.maxStamina, p.color, "#3a1f1f");
    }
  }
}
function hexAlpha(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

function drawHeldIcon(cx, cy, p) {
  const items = ASSETS.atlas.items;
  let item = null, rect = null, sheet = null, h = 26;
  if (p.holding === HOLD.TOOL) item = items.shovel;
  else if (p.holding === HOLD.WATER) item = items.water;
  else if (p.holding === HOLD.SEED) item = items.seed;
  else if (p.holding === HOLD.PLANT && p.heldPlant && p.heldPlant.main) { sheet = p.heldPlant.main.sheet; rect = p.heldPlant.main; h = 24; }
  if (item) { sheet = item.sheet; rect = { x: 0, y: 0, w: item.w, h: item.h }; }
  if (!sheet || !rect) return;
  const w = h * (rect.w / rect.h);
  drawFrame(sheet, rect, cx - w / 2, cy - h / 2, w, h);
}

function drawParticles() {
  for (const p of game.particles) { ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1;
}
function drawFloaters() {
  ctx.textAlign = "center";
  for (const f of game.floaters) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 0.6));
    ctx.font = "bold 20px Trebuchet MS, sans-serif";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function fmtTime(t) { const s = Math.max(0, Math.ceil(t)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

function drawHUD() {
  ctx.fillStyle = "rgba(20,30,16,0.75)"; roundRect(12, 10, 210, 44, 8, true, false);
  ctx.fillStyle = "#f7d774"; ctx.font = "bold 22px Trebuchet MS, sans-serif"; ctx.textAlign = "left";
  ctx.fillText("Score " + game.score, 22, 33);
  ctx.font = "12px Trebuchet MS, sans-serif"; ctx.fillStyle = "#b7d49a";
  const goals = Sim.starGoals(game);
  const reached = goals.filter((t) => game.score >= t).length;
  ctx.fillText("★".repeat(reached) + "☆".repeat(3 - reached) + "  meta " + goals[2], 22, 48);

  if (game.combo > 1) { ctx.fillStyle = "#ffd24a"; ctx.font = "bold 16px Trebuchet MS, sans-serif"; ctx.fillText("COMBO x" + game.combo, 240, 32); }

  const tw = 120, tx = WORLD.w / 2 - tw / 2;
  ctx.fillStyle = "rgba(20,30,16,0.75)"; roundRect(tx, 8, tw, 38, 8, true, false);
  ctx.fillStyle = game.time < 30 ? "#e74c3c" : "#fff"; ctx.font = "bold 24px Trebuchet MS, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("⏱ " + fmtTime(game.time), WORLD.w / 2, 35);

  if (game.playerCount === 1) {
    const sx = WORLD.w - 232, sy = 14, sw = 220, sh = 16;
    ctx.fillStyle = "rgba(20,30,16,0.75)"; roundRect(sx - 8, sy - 4, sw + 16, sh + 22, 8, true, false);
    ctx.fillStyle = "#3a1f1f"; roundRect(sx, sy, sw, sh, 5, true, false);
    ctx.fillStyle = "#5fd35f"; roundRect(sx, sy, sw * (game.players[0].stamina / TUNE.maxStamina), sh, 5, true, false);
    ctx.fillStyle = "#fff"; ctx.font = "11px Trebuchet MS, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("STAMINA", sx + sw / 2, sy + sh + 12);
    const label = heldLabel(game.players[0]);
    if (label) {
      ctx.fillStyle = "rgba(20,30,16,0.7)"; roundRect(12, WORLD.h - 44, 300, 32, 8, true, false);
      ctx.fillStyle = "#e7e0cd"; ctx.font = "bold 15px Trebuchet MS, sans-serif"; ctx.textAlign = "left";
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
    ctx.fillStyle = "rgba(20,30,16,0.82)"; roundRect(x, y, cw, ch, 8, true, false);
    ctx.strokeStyle = col; ctx.lineWidth = 3; roundRect(x, y, cw, ch, 8, false, true);
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
  const station = Sim.nearestStation(game, p);
  const plot = !station ? Sim.nearestPlot(game, p) : null;
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
  ctx.font = "bold 16px Trebuchet MS, sans-serif"; ctx.textAlign = "center";
  const tw = ctx.measureText(hint).width;
  ctx.fillStyle = "rgba(20,30,16,0.85)"; roundRect(p.x - tw / 2 - 10, p.y - 88, tw + 20, 24, 6, true, false);
  ctx.fillStyle = "#f7d774"; ctx.fillText(hint, p.x, p.y - 71);
}

function drawSeedMenu(p) {
  const PLANTS = game.plantPool || Sim.PLANTS;
  const idx = p.seedMenu.index;
  const spacing = 58, panelW = 260, panelH = 96;
  let cx = Math.max(panelW / 2 + 8, Math.min(WORLD.w - panelW / 2 - 8, p.x));
  let cy = p.y - 120;
  if (cy < panelH + 10) cy = p.y + 130;
  const top = cy - panelH / 2;
  ctx.fillStyle = "rgba(20,30,16,0.92)"; roundRect(cx - panelW / 2, top, panelW, panelH, 10, true, false);
  ctx.strokeStyle = p.color; ctx.lineWidth = 3; roundRect(cx - panelW / 2, top, panelW, panelH, 10, false, true);
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
    if (plant.main) { const h = selected ? 30 : 20, w = h * (plant.main.w / plant.main.h); drawFrame(plant.main.sheet, plant.main, x - w / 2, row - h / 2, w, h); }
    const demand = Sim.ordersNeeding(game, plant.name).reduce((a, o) => a + o.need, 0);
    if (demand > 0) {
      ctx.fillStyle = "#e74c3c"; ctx.beginPath(); ctx.arc(x + r * 0.8, row - r * 0.8, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px Trebuchet MS, sans-serif"; ctx.textAlign = "center"; ctx.fillText(demand, x + r * 0.8, row - r * 0.8 + 4);
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
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
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
  stepGame(dt, true, true);
  requestAnimationFrame(loop);
}

function togglePause() {
  if (!game || gameState !== "playing") return;
  game.paused = !game.paused;
  pauseScreen.classList.toggle("hidden", !game.paused);
  if (game.paused) { footActive = false; sound.footstepsOff(); for (const k in ASSETS.audio) ASSETS.audio[k].pause(); }
  else if (!sound.muted) sound.theme();
}

// ---------------------------------------------------------------------------
// Menu wiring
// ---------------------------------------------------------------------------
let selectedPlayers = 1;
let selectedDifficulty = 1;
function bindChoiceGroup(selector, attr, setter) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(selector).forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      setter(parseInt(btn.dataset[attr], 10));
    });
  });
}
bindChoiceGroup(".count-btn", "count", (v) => { selectedPlayers = v; const cc = document.getElementById("create-count"); if (cc) cc.textContent = v; });
bindChoiceGroup(".diff-btn", "diff", (v) => { selectedDifficulty = v; });

startBtn.addEventListener("click", startGame);
document.getElementById("resume-btn").addEventListener("click", togglePause);
document.getElementById("quit-btn").addEventListener("click", quitToMenu);
// again/menu handlers are set per-mode in setResultButtons().
muteBox.addEventListener("change", () => sound.setMuted(muteBox.checked));

// ---- Campaign level select ----
const campaignScreen = document.getElementById("campaign-screen");
function buildCampaignGrid() {
  const grid = document.getElementById("level-grid");
  grid.innerHTML = "";
  const prog = loadProgress();
  LEVELS.forEach((lv, i) => {
    const unlocked = levelUnlocked(i);
    const stars = prog[lv.id] || 0;
    const card = document.createElement("div");
    card.className = "level-card" + (unlocked ? "" : " locked");
    const starHtml = [0, 1, 2].map((s) => `<span class="${s < stars ? "on" : "off"}">★</span>`).join("");
    card.innerHTML = `<div class="lv-name">${unlocked ? (i + 1) + ". " + lv.name : "🔒 " + lv.name}</div>` +
      `<div class="lv-stars">${starHtml}</div><div class="lv-meta">${lv.duration}s · ★${lv.stars[0]}</div>`;
    if (unlocked) card.addEventListener("click", () => startLevel(i));
    grid.appendChild(card);
  });
}
function openCampaign() {
  startScreen.classList.add("hidden"); resultScreen.classList.add("hidden");
  if (online) { try { Net.leave(); if (Net.ws) Net.ws.close(); } catch (_) {} online = false; }
  buildCampaignGrid();
  campaignScreen.classList.remove("hidden");
}
document.getElementById("campaign-btn").addEventListener("click", openCampaign);
document.getElementById("campaign-back").addEventListener("click", () => { campaignScreen.classList.add("hidden"); startScreen.classList.remove("hidden"); });

const touchControls = document.getElementById("touch-controls");
function bindTouch() {
  if (!touchControls) return;
  touchControls.querySelectorAll(".tbtn").forEach((btn) => {
    const key = btn.dataset.key;
    const press = (e) => { e.preventDefault(); if (!keys[key]) justPressed[key] = true; keys[key] = true; btn.classList.add("pressed"); try { btn.setPointerCapture(e.pointerId); } catch (_) {} };
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
  const end = (e) => { e.preventDefault(); touchMove.active = false; touchMove.x = 0; touchMove.y = 0; knob.style.transform = "translate(0,0)"; };
  js.addEventListener("pointerdown", start);
  js.addEventListener("pointermove", move);
  js.addEventListener("pointerup", end);
  js.addEventListener("pointercancel", end);
}
bindJoystick();

function showTouchControls(on) { if (touchControls) touchControls.classList.toggle("active", on && (online || selectedPlayers === 1)); }

function launch(g) {
  game = g;
  gameState = "playing";
  online = false;
  startScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  resultScreen.classList.add("hidden");
  campaignScreen.classList.add("hidden");
  document.getElementById("again-btn").classList.remove("hidden");
  showTouchControls(true);
  if (actx && actx.state === "suspended") actx.resume().catch(() => {});
  sound.setMuted(muteBox.checked);
  if (!sound.muted) sound.theme();
  footActive = false;
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function startGame() {
  if (!ASSETS.atlas) return;
  currentMode = "quick"; currentLevelIndex = -1;
  launch(createGame(selectedPlayers, { difficulty: selectedDifficulty }));
}

function startLevel(i) {
  if (!ASSETS.atlas || !LEVELS[i]) return;
  currentMode = "campaign"; currentLevelIndex = i;
  launch(createGame(selectedPlayers, { level: LEVELS[i] }));
}

function quitToMenu() {
  if (online) { try { Net.leave(); if (Net.ws) Net.ws.close(); } catch (_) {} online = false; }
  running = false; game = null; gameState = "menu";
  for (const k in ASSETS.audio) { ASSETS.audio[k].pause(); ASSETS.audio[k].currentTime = 0; }
  showTouchControls(false);
  document.getElementById("again-btn").classList.remove("hidden");
  pauseScreen.classList.add("hidden");
  resultScreen.classList.add("hidden");
  campaignScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Online (authoritative server: send this device's intent, render snapshots)
// ---------------------------------------------------------------------------
let online = false;

// One intent from the local device (keyboard WASD/arrows + touch + gamepad 0).
function localIntent() {
  const gp = gamepadIntent(0);
  if (gp && (gp.mx || gp.my || gp.interact || gp.drop || gp.run || gp.navL || gp.navR)) return gp;
  const km = keymapForSlot(0, 1);
  const it = {
    mx: (anyDown(km.right) ? 1 : 0) - (anyDown(km.left) ? 1 : 0),
    my: (anyDown(km.down) ? 1 : 0) - (anyDown(km.up) ? 1 : 0),
    run: anyDown(km.run), interact: anyPressed(km.interact), drop: anyPressed(km.drop),
    navL: anyPressed(km.navL), navR: anyPressed(km.navR), confirm: anyPressed(km.confirm),
  };
  if (touchMove.active && Math.hypot(touchMove.x, touchMove.y) > 0.22) { it.mx = touchMove.x; it.my = touchMove.y; }
  return it;
}

let _onlineEnded = false;
function onlineLoop() {
  if (!online) return;
  if (Net.phase === "playing" || Net.phase === "result") {
    const s = Net.renderState();
    if (s) {
      game = s;
      gameState = "playing";
      // Footsteps from whether anyone is moving in the latest snapshot.
      const moving = Net.lastSnapshot && Net.lastSnapshot.players.some((p) => p.moving);
      if (moving && !footActive) { sound.footstepsOn(); footActive = true; }
      else if (!moving && footActive) { sound.footstepsOff(); footActive = false; }
      render();
      if (Net.phase === "playing") Net.sendIntent(localIntent());
    }
    if (Net.phase === "result" && !_onlineEnded) { _onlineEnded = true; footActive = false; sound.footstepsOff(); showOnlineResult(); }
    clearJustPressed();
  }
  requestAnimationFrame(onlineLoop);
}

function showOnlineResult() {
  const r = (game && game.result) || Net.result;
  if (!r) return;
  document.getElementById("result-stars").innerHTML = [0, 1, 2].map((i) => `<span class="${i < r.stars ? "on" : "off"}">★</span>`).join("");
  document.getElementById("result-score").textContent = "Score: " + r.score;
  document.getElementById("result-stats").textContent = `Pedidos entregues: ${r.delivered} · perdidos: ${r.expired}`;
  document.getElementById("again-btn").classList.add("hidden"); // server rooms don't restart
  resultScreen.classList.remove("hidden");
}

// Fires once per snapshot: enter online play on the first one, and play the
// sim's sound events (here, not per render frame, so they don't repeat).
function onSnapshot(s) {
  if (!online) beginOnline();
  if (!sound.muted) playEvents(s.events || []);
}

function beginOnline() {
  online = true; _onlineEnded = false; running = false; // stop any offline rAF
  startScreen.classList.add("hidden"); pauseScreen.classList.add("hidden"); resultScreen.classList.add("hidden");
  const os = document.getElementById("online-screen"); if (os) os.classList.add("hidden");
  if (actx && actx.state === "suspended") actx.resume().catch(() => {});
  sound.setMuted(muteBox.checked);
  showTouchControls(true);
  requestAnimationFrame(onlineLoop);
}

// Default server URL: ?server=... overrides; else same host on :8787 (dev) or a
// configured prod endpoint. Lobby UI (O-2) wires this to buttons.
function serverUrl() {
  const p = new URLSearchParams(location.search).get("server");
  if (p) return p;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.hostname}:8787`;
}

window.__OG_NET__ = {
  Net,
  async connectCreate(url, count, difficulty, levelId) { await Net.connect(url || serverUrl()); Net.on.snapshot = onSnapshot; Net.create(count, difficulty, levelId); },
  async connectJoin(url, room) { await Net.connect(url || serverUrl()); Net.on.snapshot = onSnapshot; Net.join(room); },
  start() { Net.start(); },
  state() { return { room: Net.room, slot: Net.slot, host: Net.host, phase: Net.phase, count: Net.count, error: Net.error, snapshot: Net.lastSnapshot }; },
};

// ---------------------------------------------------------------------------
// Lobby UI
// ---------------------------------------------------------------------------
const onlineScreen = document.getElementById("online-screen");
const onlineSetup = document.getElementById("online-setup");
const onlineLobby = document.getElementById("online-lobby");
const onlineError = document.getElementById("online-error");

function populateLevelSelect() {
  const sel = document.getElementById("online-level");
  if (!sel || sel.options.length) return;
  for (const lv of LEVELS) { const o = document.createElement("option"); o.value = lv.id; o.textContent = lv.name; sel.appendChild(o); }
}
function showOnlineScreen(show) {
  onlineScreen.classList.toggle("hidden", !show);
  if (show) { populateLevelSelect(); onlineSetup.classList.remove("hidden"); onlineLobby.classList.add("hidden"); onlineError.textContent = ""; }
}
function showLobbyView() {
  onlineSetup.classList.add("hidden"); onlineLobby.classList.remove("hidden");
  document.getElementById("room-code").textContent = Net.room || "----";
  document.getElementById("lobby-start").classList.toggle("hidden", !Net.host);
  document.getElementById("lobby-wait").classList.toggle("hidden", Net.host);
  document.getElementById("lobby-players").textContent =
    `${Net.levelName ? "Fase: " + Net.levelName + " · " : ""}Jogadores na sala: ${Net.slots ? Net.slots.length : 1} / ${Net.count}`;
}
function closeOnline() {
  online = false;
  try { Net.leave(); if (Net.ws) Net.ws.close(); } catch (_) {}
}

Net.on.joined = () => showLobbyView();
Net.on.lobby = () => { if (Net.phase === "lobby") showLobbyView(); };
Net.on.error = (msg) => { onlineError.textContent = msg; };
Net.on.close = (info) => {
  if (!info || info.intentional || !info.wasInGame) return;
  // Lost connection mid-game: drop back to the online screen with the code
  // prefilled so the player can rejoin (the server keeps the room running and
  // allows drop-in into the freed slot).
  online = false;
  pauseScreen.classList.add("hidden"); resultScreen.classList.add("hidden");
  document.getElementById("again-btn").classList.remove("hidden");
  startScreen.classList.add("hidden");
  showOnlineScreen(true);
  if (info.room) document.getElementById("join-code").value = info.room;
  onlineError.textContent = "conexão perdida — reentre na sala";
};

async function connectThen(action) {
  onlineError.textContent = "conectando…";
  try {
    await Net.connect(serverUrl());
    onlineError.textContent = "";
    Net.on.snapshot = onSnapshot;
    action();
  } catch (_) { onlineError.textContent = "não foi possível conectar ao servidor"; }
}

document.getElementById("online-btn").addEventListener("click", () => { startScreen.classList.add("hidden"); showOnlineScreen(true); });
document.getElementById("online-back").addEventListener("click", () => { try { if (Net.ws) Net.ws.close(); } catch (_) {} showOnlineScreen(false); startScreen.classList.remove("hidden"); });
document.getElementById("create-room").addEventListener("click", () => {
  const lvl = document.getElementById("online-level");
  const levelId = lvl && lvl.value ? lvl.value : undefined;
  connectThen(() => Net.create(selectedPlayers, selectedDifficulty, levelId));
});
document.getElementById("join-room").addEventListener("click", () => {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  if (code.length < 4) { onlineError.textContent = "digite o código (4 letras)"; return; }
  connectThen(() => Net.join(code));
});
document.getElementById("lobby-start").addEventListener("click", () => Net.start());
document.getElementById("lobby-leave").addEventListener("click", () => { closeOnline(); showOnlineScreen(false); startScreen.classList.remove("hidden"); });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
ctx.fillStyle = "#6ab04c";
ctx.fillRect(0, 0, WORLD.w, WORLD.h);

if (location.search.includes("debug")) {
  const params = new URLSearchParams(location.search);
  if (params.has("seed")) { pendingSeed = parseInt(params.get("seed"), 10); Sim.seedRng(pendingSeed); }

  window.__OG__ = {
    get game() { return game; },
    get gameState() { return game && game.over ? "result" : gameState; },
    get PLANTS() { return Sim.PLANTS; },
    TUNE, ROUND, ORDER, WORLD, HOLD, STAGE, COOP,
    starGoals: () => Sim.starGoals(game),
    keys, justPressed,
    teleport(x, y) { game.player.x = x; game.player.y = y; },
    openSeedMenu(i = 0) { game.player.seedMenu.open = true; game.player.seedMenu.index = i; },
    setPlot(i, patch) { Object.assign(game.plots[i], patch); },
    setTime(t) { game.time = t; },
    spawnOrder() { Sim.spawnOrder(game); },
    addScore(n) { game.score += n; },
    seedRng: Sim.seedRng,
    assetsReady() { return !!ASSETS.atlas && Sim.PLANTS.length > 0; },
    startHeadless({ players = 1, seed = null } = {}) {
      if (seed != null) pendingSeed = seed;
      selectedDifficulty = players; selectedPlayers = 1;
      currentMode = "quick"; currentLevelIndex = -1;
      sound.setMuted(true);
      game = createGame(1, { difficulty: players });
      gameState = "playing";
      running = false;
      startScreen.classList.add("hidden"); pauseScreen.classList.add("hidden"); resultScreen.classList.add("hidden");
      return true;
    },
    startHeadlessCoop({ count = 2, difficulty = 1, seed = null } = {}) {
      if (seed != null) pendingSeed = seed;
      selectedPlayers = count; selectedDifficulty = difficulty;
      currentMode = "quick"; currentLevelIndex = -1;
      sound.setMuted(true);
      game = createGame(count, { difficulty });
      for (const p of game.players) p.device = { type: "bot" };
      game._botIntents = [];
      gameState = "playing";
      running = false;
      startScreen.classList.add("hidden"); pauseScreen.classList.add("hidden"); resultScreen.classList.add("hidden");
      return true;
    },
    setBotIntents(arr) { game._botIntents = arr; },
    tick(dt, doRender = false) {
      stepGame(dt, doRender, false);
      return game && game.over ? "result" : "playing";
    },
  };
}

loadAssets()
  .then(() => {
    startBtn.disabled = false; startBtn.textContent = "Jogo rápido";
    const cb = document.getElementById("campaign-btn");
    if (cb && LEVELS.length) { cb.disabled = false; cb.textContent = "🗺️ Campanha"; }
  })
  .catch((err) => { console.error(err); startBtn.textContent = "Erro ao carregar assets"; });
