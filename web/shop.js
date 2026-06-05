"use strict";
/*
 * Shop / meta-progression. Coins are earned per offline round and spent on
 * persistent upgrades that tweak the simulation (move speed, wilt rate, growth
 * rate, round time). State lives in localStorage.
 *
 * Upgrades apply to offline play (campaign/quick) only — online rounds run on
 * the authoritative server with vanilla tuning for fairness.
 */
const KEY = "overgarden.shop";

export const UPGRADES = [
  { id: "boots", name: "Botas Velozes", icon: "👟", desc: "+8% de velocidade por nível", max: 3, cost: [120, 260, 440] },
  { id: "fertilizer", name: "Adubo", icon: "🌿", desc: "Plantas murcham ~12% mais devagar", max: 3, cost: [150, 320, 520] },
  { id: "greenhouse", name: "Estufa Rápida", icon: "🌱", desc: "Crescimento ~8% mais rápido", max: 3, cost: [180, 360, 600] },
  { id: "clock", name: "Relógio Extra", icon: "⏱️", desc: "+8s de rodada por nível", max: 2, cost: [220, 420] },
  { id: "splash", name: "Regador Duplo", icon: "💦", desc: "Regar molha também um canteiro vizinho", max: 1, cost: [420] },
  { id: "nursery", name: "Viveiro", icon: "🪴", desc: "Começa com canteiros já preparados", max: 2, cost: [200, 400] },
  { id: "merchant", name: "Comerciante", icon: "🤝", desc: "Combo dura +2.5s por nível", max: 2, cost: [240, 440] },
];

export const Shop = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)) || { coins: 0, levels: {} }; } catch (_) { return { coins: 0, levels: {} }; } },
  save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} },
  coins() { return this.load().coins || 0; },
  level(id) { return this.load().levels[id] || 0; },
  costOf(id) { const u = UPGRADES.find((x) => x.id === id); const lvl = this.level(id); return lvl >= u.max ? null : u.cost[lvl]; },

  // Coins earned for a finished round.
  reward({ stars = 0, score = 0 } = {}) { return stars * 15 + Math.floor(score / 15); },
  earn(n) { const s = this.load(); s.coins = (s.coins || 0) + Math.max(0, Math.round(n)); this.save(s); return s.coins; },
  buy(id) {
    const u = UPGRADES.find((x) => x.id === id);
    const s = this.load();
    const lvl = s.levels[id] || 0;
    if (!u || lvl >= u.max) return false;
    const cost = u.cost[lvl];
    if ((s.coins || 0) < cost) return false;
    s.coins -= cost; s.levels[id] = lvl + 1; this.save(s);
    return true;
  },
  reset() { this.save({ coins: 0, levels: {} }); },

  // Combined simulation modifiers from owned upgrades.
  mods() {
    const L = this.load().levels || {};
    return {
      speedMult: 1 + 0.08 * (L.boots || 0),
      decayMult: 1 - 0.12 * (L.fertilizer || 0),
      growthMult: 1 - 0.08 * (L.greenhouse || 0),
      bonusTime: 8 * (L.clock || 0),
      waterSplash: (L.splash || 0) > 0,
      startTreated: L.nursery || 0,
      comboBonus: 2.5 * (L.merchant || 0),
    };
  },
};
