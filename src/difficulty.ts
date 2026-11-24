import type { Config } from "./config.js";
import { difficultyForHashpower } from "./config.js";

import {
  allowedTarget,
  nextBaseTarget,
  type DifficultyParams,
} from "./what/difficulty.js";

/* The law lives in `what/difficulty.ts`; this module re-exports it so the
   parity runner and the simulation reach it by one import path. */
export { allowedTarget, nextBaseTarget };
import { DIFFICULTY_ONE_TARGET, POW_LIMIT } from "./what/parameters.js";

/**
 * Proof of What difficulty adjustment.
 *
 * One symmetric law in log space, with no epoch and no retarget:
 *
 *   in flight:  D(t) = base * 2^(-max(0, elapsed - target) / halfLife)
 *   on a block: base *= 2^((target - interval) / halfLife)
 *
 * Downward, this is the death-spiral fix: a block that is overdue sees its
 * target decay continuously against Cardano's clock, so a hashpower exodus
 * walks difficulty down within one block instead of stalling the chain. It is
 * only safe because Cardano keeps producing blocks — a trusted wall clock —
 * when WHAT hashpower is gone.
 *
 * Upward is the same law reflected: a block that arrives early raises the base
 * by exactly what the equivalent lateness would have lowered it. That makes the
 * controller unbiased — its drift vanishes only where E[interval] = target. A
 * down-only-per-block, up-only-per-epoch pair instead settles at a fixed point
 * running several times too fast. `halfLife` is the gain: smaller reacts faster
 * and churns difficulty harder.
 *
 * THIS FILE DOES NOT IMPLEMENT THAT LAW. It calls `what/difficulty.ts`, which
 * is the same code the Stratum server runs and a direct port of the Aiken
 * validator. A floating-point implementation here, computing the ideal
 * exponential, would agree with the law on paper and with nothing on chain:
 * the validator enforces a 16.16 fixed-point cubic approximation, so a
 * simulation using `Math.pow` would be modelling a rule that does not exist.
 * Any bias in that approximation is something this simulation can surface
 * rather than something it smooths away.
 *
 * What that costs: this class works in TARGETS internally, because the shared
 * rule does. Difficulty is the reciprocal and appears only at the boundary,
 * for the hashpower model and the display.
 *
 * Bitcoin's epoch retarget is kept behind `epochBlocks > 0` for comparison; it
 * is off by default, is not part of WHAT's rule, and is therefore the one piece
 * of arithmetic computed here rather than by the shared code.
 */

/** Difficulty one is `0xffff * 2^208`. Exact as a double; the ratio is not. */
const DIFFICULTY_ONE = Number(DIFFICULTY_ONE_TARGET);

/** Difficulty of a target. Loses precision below ~2^-53 relative; display-safe. */
export function difficultyForTarget(target: bigint): number {
  return DIFFICULTY_ONE / Number(target);
}

/**
 * The target a difficulty corresponds to, clamped to the protocol's range.
 *
 * Only used to seed the run and for the optional epoch retarget, so the ~53
 * bits of precision a double carries is not a constraint: every step after
 * this is exact bigint arithmetic inside the shared rule.
 */
export function targetForDifficulty(difficulty: number): bigint {
  if (!Number.isFinite(difficulty) || difficulty <= 0) return POW_LIMIT;
  const raw = DIFFICULTY_ONE / difficulty;
  if (!Number.isFinite(raw) || raw >= Number(POW_LIMIT)) return POW_LIMIT;
  const target = BigInt(Math.round(raw));
  return target < 1n ? 1n : target;
}

export class DifficultyController {
  /** Base target, before time decay. The quantity the rule actually moves. */
  baseTarget: bigint;
  /** Simulated time of the last WHAT block. */
  lastBlockTime = 0;
  /** Time the current epoch started. */
  private epochStart = 0;
  /** Blocks found in the current epoch. */
  private epochCount = 0;
  epoch = 0;

  /** The shared rule's constants, converted from the config's seconds to ms. */
  private readonly params: DifficultyParams;

  constructor(private readonly cfg: Config) {
    this.params = {
      targetSpacing: Math.round(cfg.targetBlockTime * 1000),
      halfLife: Math.round(cfg.decayHalfLife * 1000),
    };
    this.baseTarget = targetForDifficulty(
      cfg.initialDifficulty === "auto"
        ? difficultyForHashpower(cfg.initialHashpower, cfg.targetBlockTime)
        : cfg.initialDifficulty,
    );
  }

  /** Seconds a block has been overdue at simulated time `t`. */
  overage(t: number): number {
    return Math.max(0, t - this.lastBlockTime - this.cfg.targetBlockTime);
  }

  /**
   * Milliseconds since the last block, as an integer — which is what the chain
   * would see, Cardano's POSIX times being in whole milliseconds. The shared
   * rule refuses a fractional interval rather than rounding one, so the
   * rounding belongs here, at the simulation's boundary, not in protocol code.
   */
  private elapsedMs(t: number): number {
    return Math.max(0, Math.round((t - this.lastBlockTime) * 1000));
  }

  /** The largest target a block may commit to at simulated time `t`. */
  effectiveTarget(t: number): bigint {
    return allowedTarget(this.baseTarget, this.elapsedMs(t), this.params);
  }

  /**
   * Multiplier applied to base difficulty at simulated time `t`.
   *
   * Computed from the targets rather than from `2^(-overage/halfLife)`, so it
   * reports what the rule did including its clamps: at the pow limit the
   * target cannot loosen further and this correctly reads 1.
   */
  decayFactor(t: number): number {
    return Number(this.baseTarget) / Number(this.effectiveTarget(t));
  }

  /**
   * The difficulty miners are actually working against at time `t`.
   *
   * `minDifficulty` is a simulation-only floor on top of the protocol's own
   * clamp. It defaults to exactly the pow limit's difficulty, where it is a
   * no-op; raising it explores a chain whose floor is higher than WHAT's.
   */
  effective(t: number): number {
    return Math.max(this.cfg.minDifficulty, difficultyForTarget(this.effectiveTarget(t)));
  }

  /**
   * Record a block confirmed at on-chain time `t`. Returns the epoch retarget
   * factor if one was applied, and null otherwise.
   */
  onBlock(t: number): number | null {
    // Symmetric per-block update, the mirror of the decay:
    //
    //   base *= 2^((target - interval) / halfLife)
    //
    // For a late block (interval > target) this is exactly the decay the block
    // was already mined against, so nothing changes in that direction. For an
    // early block it raises the base by the same law. Both sides compute it
    // from the on-chain timestamps alone, with the same function.
    this.baseTarget = nextBaseTarget(this.baseTarget, this.elapsedMs(t), this.params);
    this.lastBlockTime = t;

    if (this.cfg.epochBlocks <= 0) return null;
    this.epochCount += 1;

    if (this.epochCount < this.cfg.epochBlocks) return null;

    const elapsed = t - this.epochStart;
    const expected = this.cfg.targetBlockTime * this.cfg.epochBlocks;
    // Upward only: the per-block rule above owns the downward direction. This
    // is Bitcoin's rule, not WHAT's, so it is the one place left that does its
    // own arithmetic — and the only place a float round-trip through the
    // target conversion happens.
    const retarget = Math.min(this.cfg.maxRetargetUp, Math.max(1, expected / elapsed));
    this.baseTarget = targetForDifficulty(difficultyForTarget(this.baseTarget) * retarget);
    this.epochStart = t;
    this.epochCount = 0;
    this.epoch += 1;
    return retarget;
  }
}
