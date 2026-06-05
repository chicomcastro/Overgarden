# Overgarden — e2e balancing harness

An autoplayer bot plays full headless rounds of the web build and produces
**visual evidence** + **balancing data** on every PR.

## What it does

1. Serves `web/` and opens it in headless Chromium with `?debug&seed=N`.
2. Injects a heuristic **bot** (`bot.js`) that plays the loop (prepare → plant →
   water → harvest → deliver) through the real input path, at real game speed.
3. A deterministic, seeded `tick(dt)` advances a 150s round in a fraction of a
   second; the **harness** (`harness.js`) records per-tick metrics.
4. `run.mjs` runs several seeds and writes to `tests/e2e/out/`:
   - `screenshots/*.png` — start / mid / late / result (visual evidence)
   - `score-over-time.svg` — score curves vs. star thresholds
   - `metrics.json` — every run + aggregate + the tuning snapshot evaluated
   - `report.md` — full human report
   - `summary.md` — short table posted as a PR comment

## Run locally

```bash
npm install
npx playwright install --with-deps chromium
npm run e2e                       # default: Fácil, seeds 1..5
node tests/e2e/run.mjs --players 4 --seeds 1,2,3   # Insano
open tests/e2e/out/report.md
```

## Using it to rebalance

Tweak the `TUNE` / `ROUND` / `ORDER` tables in `web/game.js`, re-run, and
compare aggregates. Rules of thumb (also printed in `report.md`):

- **Always 0★** → too hard (or `ROUND.stars` thresholds too high). **Always 3★** → too easy.
- **High deaths / low waters** → `TUNE.lifeBase` / `wiltGrace` too tight, or player too slow to cover the map.
- **High expired orders** → `ORDER.timeBase` / `diffTime` too short, or spawns too fast.
- **High idle %** → bot ran out of work: there's slack, the tuning can be tightened.

The bot is intentionally **consistent, not optimal** — so score deltas between
runs are attributable to tuning changes, not bot variance.

## Tuning sweep

Instead of eyeballing one tuning at a time, sweep a grid of the throughput
knobs and let the bot tell you which combo lands a competent player in the
"fun" star band:

```bash
npm run sweep                                  # modo order (pacing de pedidos)
npm run sweep:prod                             # modo production (crescimento + vida)
node tests/e2e/sweep.mjs --mode production --players 4 --target 1.5
open tests/e2e/out/sweep-production/sweep.md
```

Two modes (`--mode`), all axes relative to the shipped baseline:

- **order** (default): `spawnScale` (spawn rate), `ORDER.timeBase` (deadline), `ORDER.expirePenalty`.
- **production**: `growthScale` (`TUNE.growthBase`, <1 = matures faster), `lifeScale` (`TUNE.lifeBase`, >1 = wilts slower → fewer well trips).

It mutates the live `__OG__.ORDER` / `__OG__.TUNE` objects before each round — no rebuild needed.

The report ranks combos, flags those in the band, and — crucially — reports the
**achievable score ceiling**: if the lowest `ROUND.stars` threshold sits above
it, no order-knob tuning alone can earn a star, and it suggests star thresholds
aligned to the ceiling (or points to speeding up production / co-op).

Can also be run on demand from the **Actions → tuning-sweep** workflow.

## Co-op balancing

Drives N bot players (1–4) on the shared farm and reports team score, star
distribution and load per player count, so the `COOP` scaling in `game.js`
(spawn rate, concurrent orders, star goals) can be tuned to real multi-player
throughput:

```bash
npm run coop                                   # difficulty Fácil, counts 1–4
node tests/e2e/coop.mjs --difficulty 2 --counts 2,4
open tests/e2e/out/coop/coop.md
```

The co-op bot (`coop-bot.js`) is intent-based and claims plots so players divide
labour. It's a *stronger* proxy than the solo bot, so it's used for **relative**
throughput ratios across counts (`starScale = teto_N / teto_solo`), not absolute
goals. Throughput scales **sublinearly** (shared plots + one well), which is why
`COOP.starScale` is ~`[1, 1.8, 2.1, 2.6]` rather than `[1, 2, 3, 4]`.

> Headless co-op runs via `__OG__.startHeadlessCoop({count,difficulty,seed})` +
> `setBotIntents()` — a separate path from the solo harness, so the per-PR e2e
> is untouched.

## Per-level balancing (`levels.mjs`)

`npm run levels` roda o bot em **cada fase** de `web/assets/levels.json` (seeds
fixos) e reporta a distribuição de score por fase + metas de ★ **sugeridas** a
partir do throughput medido (★1 ≈ 0.6·mediana, ★2 ≈ run sólido, ★3 ≈ melhor run
do bot — humanos batem o bot, então é alcançável). `--apply` reescreve as metas
em `levels.json`. O bot é conservador (1 cultivo por vez), então é um piso
amigável. O caminho headless aceita `levelId` (`startHeadless({levelId})`); o
e2e por-PR (sem `levelId`) usa o nível default e fica intacto.

As metas usam o **teto medido** (melhor run do bot entre os seeds — estável e
determinístico, ao contrário da mediana, que colapsa em fases com eventos):
★1≈0.30·max, ★2≈0.60·max, ★3≈0.92·max. Fases com `events` (chuva/seca/rush)
mudam o throughput, então recalibre (`--apply`) após alterá-las.

## Reproducibility

Only gameplay-affecting randomness (the order stream) is seeded via a mulberry32
PRNG (`?seed=`). With a fixed seed + fixed timestep, runs are deterministic.
