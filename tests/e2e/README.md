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

## Reproducibility

Only gameplay-affecting randomness (the order stream) is seeded via a mulberry32
PRNG (`?seed=`). With a fixed seed + fixed timestep, runs are deterministic.
