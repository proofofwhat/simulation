# Difficulty-adjustment simulation

Proof of What? is a Cardano native token whose issuance is handed out by
SHA-256d proof of work. Cardano does security, ordering, finality and
timekeeping; the work only decides who gets the coinbase. Because Cardano
supplies the clock, the difficulty rule can be one the usual constraints
forbid: symmetric in log space, continuous while a block is in flight, no
epoch, no retarget, and a floor far below Bitcoin's difficulty 1.

This runs that rule. The chain around it is a model; the rule is not. The
arithmetic here is the same integer code the Stratum server runs, and a direct
port of
[`lib/what/difficulty.ak`](https://github.com/proofofwhat/contracts/blob/main/lib/what/difficulty.ak)
in the validator, which is where the rule is specified and enforced. The
validator is the authority; this is a way to watch it behave — and
`npm run parity` below is how you check that claim rather than taking it.

Illustrative model, not a forecast.

Whitepaper section 6 specifies the rule:
[`whitepaper.md`](https://github.com/proofofwhat/contracts/blob/main/whitepaper.md),
in the same repository as the validator.

```sh
npm install
npm run sim                               # curses UI — hashpower + difficulty charts, log below ('q' quits)
npm run sim -- --plain --blocks 500       # one line per block, as fast as it runs
npm run sim -- --help
npm run browser                           # the same simulation in a browser tab
npm run parity                            # check the rule against the validator's own vectors
npm run typecheck                         # tsc --noEmit over src/, browser/ and tools/
```

`npm run sim` is `tsx src/main.ts`; the two are interchangeable, and the
examples below use the longer form so the flags read clearly.

**`npm run parity` is the one to run first if you are here to check something.**
It holds `src/what/difficulty.ts` against the 224 vectors in
[`lib/what/parity.ak`](https://github.com/proofofwhat/contracts/blob/main/lib/what/parity.ak)
— the same assertions `aiken check` runs against the validator — from a
committed file, with no Aiken and no network. `tools/parity.ts` says what that
does and does not prove.

Zero runtime dependencies. `tsx`, `typescript` and `@types/node` are
development dependencies and nothing else is needed.

## In a browser

`npm run browser` serves the same generator the terminal UI consumes, driven by
a fleet you count rather than by the statistical hashpower process: software
miners, Bitaxe ASICs and warehouses, each with a pair of buttons. The
difficulty law, the Poisson discovery and the collision model are identical
under either — the fleet is a second source of hashpower, not a second
simulation.

Both series share one logarithmic axis, hashpower drawn as the difficulty it
implies, because at equilibrium a hashpower `H` settles at `H × target / 2^32`.
The amber line is therefore the level the blue line is chasing, and the gap
between them is the lag. Every block is a dot on the difficulty line, which is
what makes an ASIC's arrival legible: difficulty climbs as a ladder of blocks
rather than as a jump.

The opening state comes from the query string, so a particular run is a link:
`?software=1&bitaxes=1&warehouses=0&speed=600&window=21600` — the three fleet
counts, simulated seconds per real second, and the width of the chart's window
in simulated seconds. The server takes a port as a bare argument and
`--no-open` suppresses launching a browser:

```sh
npm run browser -- 8899 --no-open
```

The three rates are round numbers, and deliberately so: what matters is the
scale between them, not any one of them. A software miner is the node's bundled
CPU miner at three workers, **0.5 MH/s**. A Bitaxe is a Bitaxe Gamma 601,
**1 TH/s**. A warehouse is ten thousand current-generation ASICs at 200 TH/s
each, **2 EH/s**. Each tier is about two million of the one below, and that
ratio — not the third digit of any rate — is what the rule has to answer.

## Model

Everything runs in continuous time, integrated on a fine step (`--step`, default 1s).

- **Hashing** — inhomogeneous Poisson process with rate `H(t) / (D * 2^32)`, where
  `D` is the current Stratum job's difficulty. A hash can be found at any
  instant; nothing has to happen on Cardano for it.
- **Hashpower** — mean-reverting in log space (OU) with Poisson jumps standing in
  for fleets of rigs being pointed at or away from the chain. Defaults are
  calibrated to how real hashpower moves: the diffusion is ~0.2%/minute and
  ~6%/day, reverting over about a day, with a fleet-scale jump about daily. The
  jumps, not the diffusion, are the realistic driver here, and a fleet arriving
  or leaving is the event the rule has to answer. `--volatility 0.02` is a
  minute-by-minute stress case; `--volatility 0 --jump-interval 0` pins
  hashpower flat.
- **Difficulty** — one symmetric law in log space, no epoch and no retarget:

  ```
  in flight:  D(t) = base * 2^(-max(0, elapsed - target) / halfLife)
  on a block: base *= 2^((target - interval) / halfLife)
  ```

  The in-flight form is a closed-form function of the clock that each miner
  evaluates locally — **no difficulty state changes between WHAT blocks**, and no
  Cardano transaction is involved. State changes only on confirmation, from the
  on-chain timestamps alone. For a late block the on-block update is exactly the
  decay already applied; for an early block it is that law reflected. `halfLife`
  is the gain. Bitcoin's epoch retarget is still available via `--epoch N` for
  comparison, but is off by default and not needed.
- **Cardano's clock** — the only clock, as the validator reads it. A block's time
  is its transaction's validity-interval start, which the node takes from the
  latest Cardano block at submission: *before* the hash was found, not the
  Cardano block that later includes it (mean 20s later, `conf=` in the log).
  That time stamps the block and starts the next one's decay window, while
  mining on the next block can only begin once this one confirms.
- **Jobs** — miners hash against a job, not the continuous curve. The Stratum
  server fixes a job's target at the allowed target as of the latest Cardano
  block, and re-issues jobs on each new tip and every `--job-refresh` seconds
  (default 30, the node's). While a block is overdue that lags the continuous
  law by up to a refresh plus a Cardano block. Because the allowed target only
  loosens and a validity start is never earlier than the job's clock, every
  solution validates; the simulation checks this on every block and stops if it
  ever fails.
- **Collisions** — mining never pauses while a submission is in flight, since a
  miner can't know a competitor already found a hash. Several discoveries can
  therefore be waiting on the same Cardano block, all built on the same parent;
  only the earliest counts and the rest are orphaned (`orphaned=` in the log,
  `orphans=` in the summary). This caps the WHAT block rate at the Cardano block
  rate — roughly one per 20s — no matter how much hashpower shows up.

## What the default run shows

The symmetric rule holds the 10-minute target, across the gain range and with or
without hashpower volatility. Every row is 400 blocks at seed 1, and the command
that produces it is `npx tsx src/main.ts --plain --blocks 400 --seed 1` plus the
flags named:

| config | flags | mean | median | max | >3x target | orphans |
|---|---|---|---|---|---|---|
| half-life 300 | `--half-life 300` | 601s | 445s | 2628s | 11 | 27 |
| half-life 600 (default) | — | 599s | 424s | 3043s | 15 | 20 |
| half-life 1800 | `--half-life 1800` | 607s | 470s | 2854s | 11 | 16 |
| half-life 3600 | `--half-life 3600` | 600s | 432s | 4603s | 17 | 16 |
| constant hashpower | `--volatility 0 --jump-interval 0` | 601s | 451s | 2508s | 14 | 16 |
| volatility stress | `--volatility 0.02` | 613s | 429s | 3911s | 24 | 31 |

`--plain` prints the summary line to stderr, so redirect it separately if you
are capturing the per-block output.

The medians run 0.70 to 0.77 of the mean, against the 0.693 of a pure
exponential — so intervals are not just right on average, they are close to the
shape a Poisson process produces. Every row sits above 0.693 rather than
scattering either side of it, which is the decay law's skew: the target loosens
while a block is overdue, so very long intervals are cut short more often than
a memoryless process would cut them. The tail is where the gain shows: the longest
interval runs from 2628s at a 300s half-life to 4603s at 3600s, since a lower
half-life walks the target down faster while a block is overdue. The cost is
churning difficulty harder on every block.

Orphans run ~4% of discoveries at these settings — 4.31%, with a standard
error of 0.38 over seeds 1–6 at 1,000 blocks each:

```sh
for s in 1 2 3 4 5 6; do
  npx tsx src/main.ts --plain --blocks 1000 --seed $s \
    --volatility 0 --jump-interval 0 2>&1 >/dev/null | tail -1
done
```

giving 40, 34, 37, 47, 62 and 50 orphans, each against 1,000 blocks. That
figure is a rate per *discovery* — `orphans / (blocks + orphans)` — and the ±
is the standard error of that rate over the six seeds. Leaving volatility and
jumps on gives the same within noise.

Two denominators appear in this file and they are not interchangeable. Per
*discovery* is what a miner is asking about: the share of found hashes that
earn nothing, which cannot exceed 1. Per *block* is `orphans / blocks`, which
is unbounded and reaches 31.66 under saturation below, and it is the quantity
the arrival process gives in closed form — so every analytic figure here is per
block. Each one says which it is, and the comparisons below are per block on
both sides.

The obvious guess at the constant-rate prediction is μ = 20/600 = 3.3%, one
orphan per Cardano block for every WHAT block that collides. The right answer
is **1.7%**: with discoveries Poisson at the target rate and Cardano blocks
Poisson at 20s, orphans per block are `(μ - 1 + e^-μ)/(1 - e^-μ)`, which at
μ = 1/30 is 1.68%. Either way the measurement is well above it — 4.50% per
block over the same six seeds — and the excess is the decay law: the target
loosens while a block is overdue, so the discovery rate is high exactly where
intervals are long, and discoveries cluster there.

Carrying that through the hazard predicts **3.7%** and reproduces the gain
dependence across an eightfold range. The model figures below are analytic — worked out by hand from the hazard, not
computed anywhere in this repository, and so not reproducible from it. The
measured ones come from the loop above with `--half-life` added, as
`orphans / blocks` over the six seeds — 6,000 blocks a column:

| `--half-life` | 300 | 600 | 1200 | 2400 |
|---|---|---|---|---|
| model | 4.63% | 3.71% | 3.39% | 3.28% |
| measured | 5.67% | 4.50% | 3.70% | 3.83% |
| ratio | 1.22 | 1.21 | 1.09 | 1.17 |

The model tracks the direction and the magnitude but runs low throughout, by
between 9% and 22% with no trend in the gain. That is more consistent with a
systematic offset than with a missing mechanism, though four points at this
scatter do not settle it. Three things could account for it and this does not
separate them: the hazard clock starts at a block's attested time rather than
at its discovery, jobs are up to `--job-refresh` seconds stale, and the
integrator records at most one discovery per step.

Note that higher gain *raises* the orphan rate: a shorter half-life churns
difficulty harder, and since the discovery rate goes as 1/difficulty, what the
chain experiences is the harmonic mean. Taking the `diff=` column of

```sh
npx tsx src/main.ts --plain --blocks 1000 --seed 1 --volatility 0 --jump-interval 0 | grep blk=
```

its log2 standard deviation is 0.77, and the harmonic mean sits 25% below the
arithmetic one — which is what `exp(-(σ ln2)²)` predicts for a lognormal of
that spread, 25.1%. The `grep` matters: `diff=` appears on the idle lines too,
where it is the live job's difficulty rather than a confirmed block's, and
including them gives 0.80 and 26%.

### Why the rule is symmetric

Decaying down continuously while retargeting up on Bitcoin's epoch schedule
does not hold the target, and the bias is not a volatility effect — it survives
pinning hashpower constant. Block intervals are exponential, so even at perfect
calibration about 37% of them exceed the target by chance. Under an asymmetric
pair each of those ratchets `base` down permanently while the capped
once-per-epoch correction cannot recover the ground, and the chain settles at a
fixed point several times too fast. Retargeting more often overshoots instead of
fixing it.

The drift vanishes only where the two directions are the same law. That is why
the upward step is the downward decay reflected, and why `--epoch` is off by
default: it adds Bitcoin's retarget on top of a rule that does not need it, and
is kept only for comparison.

### The Cardano block rate is a hard ceiling

Because at most one WHAT block can land per Cardano block, the chain cannot run
faster than ~20s per block however much hashpower arrives. This regime is
derivable: with discoveries Poisson at k times the target rate, expected
discoveries per Cardano block is **μ = k·20/600 = k/30**, one lands and the rest
orphan, so

```
mean interval     = 20s / (1 - e^-μ)
orphans per block = (μ - 1 + e^-μ) / (1 - e^-μ)
```

Saturation starts at μ = 1, i.e. **k = 30**. At k = 1000, μ = 33.3, predicting
20.0s and 32.3 orphans per block:

```sh
npx tsx src/main.ts --plain --blocks 400 --step 0.02 \
  --hashpower 1e18 --mean-hashpower 1e18 --reversion 0 --difficulty 139698386 \
  --half-life 1e9 --volatility 0 --jump-interval 0
```

Six seeds give **31.66 ± 0.60 orphans per block and a mean interval of
19.88 ± 0.39s**. The small
shortfall is the integrator: at most one discovery is recorded per step, so the
count is low by `(1 - e^-λΔ)/(λΔ)` = 0.9835 at `--step 0.02`, predicting 31.80.

Two things that command gets right and the obvious one does not.
`--mean-hashpower` and `--reversion` must be set, or the OU process pulls the
surge back toward the 1e15 default during the run: over the same six seeds that
gives 24.6 orphans per block instead of 31.66, 22% low, with the mean interval
6% high at 21.2s. And `--difficulty` has to be the value calibrated for the *base* hashpower
(1e15 × 600 / 2³² = 139,698,386), not an arbitrary small number: pinning it at
`--difficulty 1000` is ~140,000x below calibration, so combined with 1000x
hashpower the discovery rate saturates the integrator and the resulting orphan
count measures `--step`, not the chain.

This bounds how much migrated hashpower the chain can visibly absorb. Two
caveats the simulation does not model, both favouring Cardano block producers —
a producer can include a WHAT block and its successor in one Cardano block, and
it settles orphan races by
choosing which transaction to include. Races here are resolved by earliest
discovery.

Every run is reproducible from `--seed`.
