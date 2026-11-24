import {
  DIFFICULTY_ONE_TARGET,
  HASHES_PER_DIFFICULTY as HASHES_PER_DIFFICULTY_EXACT,
  POW_LIMIT,
} from "./what/parameters.js";

/** All tunable parameters of the simulation, in SI-ish units (seconds, hashes/s). */
export interface Config {
  seed: number;

  // --- Cardano timebase (the trusted clock) ---
  /** Mean seconds between Cardano blocks. Praos: 1s slots, f = 1/20. */
  cardanoMeanBlockTime: number;

  // --- WHAT chain difficulty ---
  /** Target seconds between WHAT blocks (Bitcoin's 10 minutes). */
  targetBlockTime: number;
  /**
   * Blocks per Bitcoin-style upward-retarget epoch. 0 disables it — the
   * symmetric per-block rule needs no epoch; this is kept for comparison.
   */
  epochBlocks: number;
  /** Max factor a single epoch retarget may raise difficulty by (Bitcoin: 4). */
  maxRetargetUp: number;
  /**
   * Downward decay: once a block is overdue, effective difficulty halves for
   * every `decayHalfLife` seconds of overage past `targetBlockTime`.
   */
  decayHalfLife: number;
  /**
   * Seconds between the Stratum server's job refreshes. A job's target is
   * fixed when it is issued, so while a block is overdue miners work against a
   * target up to this stale.
   */
  jobRefresh: number;
  /**
   * Floor on difficulty: the validator's pow limit, so the chain never becomes
   * free to mine. Far below Bitcoin's 1, because the limit is set where a CPU
   * can mine a local test network, not at Bitcoin's floor.
   */
  minDifficulty: number;
  /** Starting difficulty; `auto` derives it from the starting hashpower. */
  initialDifficulty: number | "auto";

  // --- Hashpower process (log-space OU + Poisson jumps) ---
  /** Long-run mean hashpower in hashes/s. */
  meanHashpower: number;
  /** Starting hashpower in hashes/s. */
  initialHashpower: number;
  /** Mean-reversion rate, per second. Default reverts over ~a day. */
  reversion: number;
  /**
   * Diffusion volatility of log-hashpower, per sqrt(second). The default
   * (0.0002) is ~0.2% per minute and ~6% per day, which is the scale real
   * hashpower drifts at — diurnal load, price, curtailment. Published hashrate
   * charts look far noisier than this, but most of that is estimation noise
   * from Poisson block arrivals, not machines. Raise to 0.02 for a stress test.
   */
  volatility: number;
  /**
   * Mean seconds between fleet-scale jumps (rigs switching on/off en masse).
   * These, not the diffusion, are the realistic driver for this chain, and the
   * event the whole measurement exists to capture.
   */
  jumpMeanInterval: number;
  /** Jump multiplies hashpower by exp(±jumpSize * |N(0,1)|). */
  jumpSize: number;

  // --- Numerics ---
  /**
   * Integration step in seconds for the continuous-time processes (hashpower
   * and block discovery). Must be small relative to the block interval: the
   * per-step discovery probability has to stay well under 1.
   */
  integrationStep: number;
  /** Seconds between chart samples / idle log observations. */
  sampleInterval: number;

  // --- Run control ---
  /** Stop after this many WHAT blocks (0 = run forever). */
  blocks: number;
  /** Simulated seconds per real second in TUI mode. */
  speed: number;
  /** Plain line-per-block output instead of the curses UI. */
  plain: boolean;
}

/**
 * Difficulty at the validator's pow limit, about 4.66e-10.
 *
 * Computed from the protocol constants rather than written out, so there is no
 * second place the pow limit or difficulty-1 target is stated. The division is
 * done in floating point because difficulty is a display quantity; the rule
 * itself never leaves exact integers.
 */
export const POW_LIMIT_DIFFICULTY = Number(DIFFICULTY_ONE_TARGET) / Number(POW_LIMIT);

export const DEFAULTS: Config = {
  seed: 1,

  cardanoMeanBlockTime: 20,

  targetBlockTime: 600,
  epochBlocks: 0,
  maxRetargetUp: 4,
  decayHalfLife: 600,
  jobRefresh: 30,
  minDifficulty: POW_LIMIT_DIFFICULTY,
  initialDifficulty: "auto",

  meanHashpower: 1e15, // 1 PH/s
  initialHashpower: 1e15,
  reversion: 1 / 86400,
  volatility: 0.0002,
  jumpMeanInterval: 86400,
  jumpSize: 0.7,

  integrationStep: 1,
  sampleInterval: 30,

  blocks: 0,
  speed: 600,
  plain: false,
};

/**
 * Hashes expected per difficulty unit — Bitcoin's 2^32.
 *
 * The protocol constant is a bigint, because the rule is exact integer
 * arithmetic. This is the same number as a double, for the rate and display
 * calculations around it; 2^32 is exactly representable, so nothing is lost.
 */
export const HASHES_PER_DIFFICULTY = Number(HASHES_PER_DIFFICULTY_EXACT);

/** Difficulty at which `hashpower` finds a block every `targetBlockTime` on average. */
export function difficultyForHashpower(hashpower: number, targetBlockTime: number): number {
  return (hashpower * targetBlockTime) / HASHES_PER_DIFFICULTY;
}
