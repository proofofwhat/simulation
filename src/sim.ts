import { HASHES_PER_DIFFICULTY, type Config } from "./config.js";
import { DifficultyController } from "./difficulty.js";
import { HashpowerProcess } from "./hashpower.js";
import { Rng } from "./rng.js";

export interface Tick {
  /** Simulated time of this observation, in seconds since genesis. */
  time: number;
  /** Cardano block height reached — the clock, and nothing more. */
  cardanoHeight: number;
  /** Instantaneous hashpower, hashes/s. */
  hashpower: number;
  /** Hashpower jump multiplier, if a fleet moved at this instant. */
  jump: number | null;
  /** Difficulty currently being mined against. */
  difficulty: number;
  /** Decay multiplier currently applied to base difficulty. */
  decay: number;
  /** Seconds the pending WHAT block is overdue. */
  overage: number;
  /** Mean seconds to the next block at the current hashpower and difficulty. */
  expectedInterval: number;
  /** Set when a WHAT block was confirmed at this instant. */
  block: Block | null;
  /** Cumulative discoveries lost to a collision in the same Cardano block. */
  orphans: number;
}

export interface Block {
  height: number;
  /** Seconds since the previous WHAT block, by on-chain timestamp. */
  interval: number;
  /** The allowed difficulty at the block's on-chain timestamp. */
  difficulty: number;
  /** Seconds between finding the hash and the anchoring Cardano block. */
  confirmationDelay: number;
  /** Epoch retarget factor, if this block closed an epoch. */
  retarget: number | null;
  epoch: number;
  /** Competing discoveries dropped because this one got into the block first. */
  orphaned: number;
}

interface Discovery {
  time: number;
  difficulty: number;
  /**
   * The validity-interval start its transaction will carry: the latest Cardano
   * block at the moment it was found. This, not the block that confirms it, is
   * the time the validator records.
   */
  validFrom: number;
}

/**
 * Where the hashpower at any instant comes from.
 *
 * `HashpowerProcess` is the statistical answer — a mean-reverting process with
 * Poisson fleet jumps, which is what a real chain's hashpower looks like from
 * the outside. The browser front end supplies the other kind: a fleet counted
 * in machines, where the figure moves because somebody added a rig. The law,
 * the collision model and every other part of the simulation are indifferent
 * to which is feeding them, so neither is a second implementation of anything.
 */
export interface HashpowerSource {
  /** Hashes per second at this instant. */
  readonly value: number;
  /** Advance by `dt` seconds. A fixed fleet does nothing here. */
  step(dt: number): void;
  /** Jump multiplier if a fleet moved at this instant, for the log to annotate. */
  readonly lastJump: number | null;
}

/**
 * Continuous time, integrated on a fine step.
 *
 * Hashing is a continuous-time inhomogeneous Poisson process with rate
 * `H(t) / (D * 2^32)`; a hash can be found at any instant and needs nothing to
 * happen on Cardano. Difficulty state changes ONLY when a WHAT block is
 * confirmed — between blocks the allowed target is a closed-form function of
 * Cardano's clock, not a sequence of on-chain updates.
 *
 * The rest follows what the node and validator actually do:
 *
 * - **Cardano is the only clock.** The validator reads a block's time from its
 *   transaction's validity-interval start, which the submitter takes from the
 *   latest Cardano block at submission — before the hash was found, not the
 *   block that later includes it. That time stamps the block and starts the
 *   next block's clock.
 * - **Miners hash against a job, not the curve.** The Stratum server fixes a
 *   job's target at the allowed target as of the latest Cardano block, and
 *   re-issues jobs every `jobRefresh` seconds and on each new tip. While a
 *   block is overdue that lags the continuous law by up to a refresh plus a
 *   Cardano block. The allowed target only loosens and the validity start is
 *   never earlier than the job's clock, so every solution validates.
 * - **A new block can only be mined once its parent confirms.** Jobs for the
 *   next height exist from the Cardano block that includes the parent, but
 *   that block's clock started at the parent's validity start, earlier.
 *
 * Mining does not pause while a submission is in flight — miners cannot know a
 * competitor found a hash. So several discoveries can be waiting on the same
 * Cardano block, all built on the same parent. Only one can count: the earliest
 * wins and the rest are orphaned. This caps the WHAT block rate at the Cardano
 * block rate, roughly one per 20s, no matter how much hashpower arrives.
 */
export function* simulate(cfg: Config, source?: HashpowerSource): Generator<Tick> {
  const rng = new Rng(cfg.seed);
  const hash = source ?? new HashpowerProcess(cfg, rng);
  const diff = new DifficultyController(cfg);
  const step = cfg.integrationStep;

  let time = 0;
  let cardanoHeight = 0;
  let nextCardano = rng.exponential(cfg.cardanoMeanBlockTime);
  /** The latest Cardano block, and the one before it; genesis counts as one at 0. */
  let lastCardano = 0;
  let prevCardano = 0;
  /** Cardano time the current jobs' target was chosen at. */
  let jobClock = 0;
  let nextRefresh = cfg.jobRefresh;
  /** When the current job was issued; no work on it can predate this. */
  let jobIssued = 0;
  let nextSample = cfg.sampleInterval;
  let whatHeight = 0;
  let orphans = 0;
  /** Discoveries submitted and awaiting a Cardano block, all on the same parent. */
  let pending: Discovery[] = [];

  for (;;) {
    hash.step(step);
    time += step;
    const hashpower = hash.value;

    let block: Block | null = null;

    // Advance the clock. A Cardano block is only an instant that can carry a
    // timestamp; crossing one confirms a pending discovery.
    while (time >= nextCardano) {
      const cardanoTime = nextCardano;
      cardanoHeight += 1;
      nextCardano += rng.exponential(cfg.cardanoMeanBlockTime);

      const arrived = pending.filter((p) => p.time <= cardanoTime);
      if (arrived.length > 0 && !block) {
        // Only the first discovery gets into this Cardano block; the others
        // were mined on the same parent and are orphaned.
        const winner = arrived.reduce((a, b) => (a.time <= b.time ? a : b));
        const dropped = arrived.length - 1;
        orphans += dropped;
        pending = pending.filter((p) => !arrived.includes(p));

        const confirmed = diff.effective(winner.validFrom);
        // The validator's own check. It cannot fail: the job's clock is never
        // later than the validity start. Kept so the model cannot drift into
        // claiming a block the validator would refuse.
        if (winner.difficulty < confirmed * (1 - 1e-12)) {
          throw new Error(`block at ${winner.time}s is easier than the rule allows at ${winner.validFrom}s`);
        }
        const interval = winner.validFrom - diff.lastBlockTime;
        const retarget = diff.onBlock(winner.validFrom);
        // The node pushes the new tip with its own validity start as the clock.
        jobClock = winner.validFrom;
        jobIssued = cardanoTime;
        whatHeight += 1;
        block = {
          height: whatHeight,
          interval,
          difficulty: confirmed,
          confirmationDelay: cardanoTime - winner.time,
          retarget,
          epoch: diff.epoch,
          orphaned: dropped,
        };
      }
      prevCardano = lastCardano;
      lastCardano = cardanoTime;
    }
    // The refresh timer re-issues jobs at the latest Cardano block's time.
    while (time >= nextRefresh) {
      jobClock = Math.max(jobClock, lastCardano <= nextRefresh ? lastCardano : prevCardano);
      jobIssued = Math.max(jobIssued, nextRefresh);
      nextRefresh += cfg.jobRefresh;
    }
    const difficulty = diff.effective(jobClock);
    const rate = hashpower / (difficulty * HASHES_PER_DIFFICULTY);
    const expectedInterval = rate > 0 ? 1 / rate : Infinity;

    // Mining never pauses: a miner can't know a competitor already found one.
    if (rng.bernoulli(1 - Math.exp(-rate * step))) {
      // Uniform within the step, but not before the job it was mined on.
      const from = Math.max(time - step, jobIssued);
      const found = time - rng.uniform() * (time - from);
      const validFrom = lastCardano <= found ? lastCardano : prevCardano;
      pending.push({ time: found, difficulty, validFrom });
    }

    const sampled = time >= nextSample;
    if (sampled) nextSample += cfg.sampleInterval;

    if (block || hash.lastJump !== null || sampled) {
      yield {
        time,
        cardanoHeight,
        hashpower,
        jump: hash.lastJump,
        difficulty,
        decay: diff.decayFactor(time),
        overage: diff.overage(time),
        expectedInterval,
        block,
        orphans,
      };
    }

    if (cfg.blocks > 0 && whatHeight >= cfg.blocks) return;
  }
}
