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

## Reproducibility

Only gameplay-affecting randomness (the order stream) is seeded via a mulberry32
PRNG (`?seed=`). With a fixed seed + fixed timestep, runs are deterministic.
