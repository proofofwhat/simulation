/* ---------------------------------------------------------------------------
 * COPIED FILE. Edits here are overwritten.
 *
 * Copied verbatim from the Proof of What? node software by that project's
 * packaging step, which compares the two byte-for-byte every time it runs. It
 * is not maintained in this repository: a change made here is reverted by the
 * next packaging run, without a merge and without a warning.
 *
 * The rule it implements is specified and enforced by the Aiken validator:
 *
 *     https://github.com/proofofwhat/contracts
 *     lib/what/difficulty.ak
 *
 * That validator is the authority and this is a direct port of it. The 224
 * vectors that pin the two together ship here too — run `npm run parity` to
 * check this file against them.
 *
 * Comments below were written for the node software and refer to it, not to
 * this repository. Its `npm run parity` GENERATES the vectors from the rule
 * in `difficulty.ts`; the `npm run parity` in this repository CHECKS that
 * file against them, and regenerating anything is not something it can do. The
 * `contracts/lib/what/*.ak` paths are the validator's, and the whitepaper
 * whose sections are cited ships in the same repository as the validator.
 *
 * To propose a change, open it against the validator.
 * --------------------------------------------------------------------------- */

/**
 * The WHAT difficulty rule, in the same integer arithmetic the validator uses.
 *
 * A direct port of `contracts/lib/what/difficulty.ak`. Not a reimplementation:
 * the shift/fraction split, the cubic coefficients and the clamp order are all
 * the same, because the off-chain side must predict the validator's answer
 * exactly. A target one unit too easy is a rejected transaction, and at ten
 * minutes a block that is an expensive way to find out.
 *
 *     in flight:  T_allowed(e) = T * 2^(max(0, e - 600s) / H)
 *     on a block: T            = T * 2^((interval - 600s) / H)
 *
 * `npm run parity` evaluates this rule over a spread of inputs and writes them
 * out as `contracts/lib/what/parity.ak`, which is committed; `aiken check` then
 * asserts the validator computes the same integer for every one. The flow is
 * one-way on purpose — the vectors are generated HERE and asserted THERE — so
 * if they disagree, fix the disagreement rather than regenerating the file to
 * make it pass.
 */

import { HALF_LIFE, MAX_SHIFT, MIN_TARGET, POW_LIMIT, TARGET_SPACING } from "./parameters.js";

/**
 * The rule's two time constants, in milliseconds.
 *
 * On chain these are fixed — they are baked into the script hash, and
 * `PROTOCOL` below is the only setting a node may ever use. They are arguments
 * rather than imports for one reason: the difficulty simulation sweeps them,
 * and the alternative is a second implementation of this law that nothing tests
 * against the validator. A third opinion about the difficulty rule is a worse
 * risk than a parameter the node never varies. The simulation is the one caller
 * that passes anything but `PROTOCOL`.
 *
 * The clamps are deliberately NOT parameterised. `MIN_TARGET`, `POW_LIMIT` and
 * `MAX_SHIFT` stay exactly the validator's, so a simulated chain cannot wander
 * into a range the real one refuses.
 */
export interface DifficultyParams {
  /** Target block interval. */
  targetSpacing: number;
  /** Seconds of overdue that double the allowed target. */
  halfLife: number;
}

/** The on-chain setting. The only one a node uses. */
export const PROTOCOL: DifficultyParams = {
  targetSpacing: TARGET_SPACING,
  halfLife: HALF_LIFE,
};

/** Floor division, matching Plutus `divideInteger`. BigInt `/` truncates. */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/** Floor modulo, matching Plutus `modInteger`: sign follows the divisor. */
function floorMod(a: bigint, b: bigint): bigint {
  return a - floorDiv(a, b) * b;
}

function clamp(target: bigint): bigint {
  if (target < MIN_TARGET) return MIN_TARGET;
  if (target > POW_LIMIT) return POW_LIMIT;
  return target;
}

/** 2^(frac / halfLife) in 16.16 fixed point, for 0 <= frac < halfLife. */
function twoToTheFraction(frac: bigint, halfLife: number): bigint {
  const x = (frac * 65536n) / BigInt(halfLife);
  return (
    65536n +
    (195766423245049n * x + 971821376n * x * x + 5127n * x * x * x + 140737488355328n) /
      281474976710656n
  );
}

/** `value * 2^(exponent / halfLife)`, clamped to a sane target range. */
function scaleByExp2(value: bigint, exponent: bigint, halfLife: number): bigint {
  const shifts = floorDiv(exponent, BigInt(halfLife));
  const frac = floorMod(exponent, BigInt(halfLife));

  if (shifts >= BigInt(MAX_SHIFT)) return POW_LIMIT;
  if (shifts <= BigInt(-MAX_SHIFT)) return MIN_TARGET;

  const scaled = value * twoToTheFraction(frac, halfLife);
  const target = shifts >= 0n ? (scaled << shifts) / 65536n : scaled / (1n << -shifts) / 65536n;

  return clamp(target);
}

/**
 * The largest target a block may commit to, `elapsed` ms after the tip's
 * Cardano-attested time. Non-decreasing in `elapsed`, so a hash found now is
 * still valid whenever it lands.
 */
export function allowedTarget(
  baseTarget: bigint,
  elapsed: number,
  params: DifficultyParams = PROTOCOL,
): bigint {
  const overdue = elapsed - params.targetSpacing;
  if (overdue <= 0) return clamp(baseTarget);
  return scaleByExp2(baseTarget, BigInt(overdue), params.halfLife);
}

/** The base target the next block inherits, after an interval of `interval` ms. */
export function nextBaseTarget(
  baseTarget: bigint,
  interval: number,
  params: DifficultyParams = PROTOCOL,
): bigint {
  return scaleByExp2(baseTarget, BigInt(interval - params.targetSpacing), params.halfLife);
}

/**
 * When the allowed target will first reach `target`, as ms after the tip.
 *
 * A miner handed a job may solve it against a target the clock has not reached
 * yet; this says how long the submission has to wait. Returns 0 if the target
 * is already allowed, and Infinity if no amount of waiting will allow it — so a
 * caller can tell a share that is a block now from one that is a block later
 * and one that never is.
 */
export function earliestTimeFor(
  baseTarget: bigint,
  target: bigint,
  params: DifficultyParams = PROTOCOL,
): number {
  if (target <= allowedTarget(baseTarget, 0, params)) return 0;
  if (target > POW_LIMIT) return Infinity;

  // The law is monotone in elapsed time, so bisect. Upper bound: MAX_SHIFT
  // half-lives past due is where the exponential clamps to the pow limit.
  let lo = params.targetSpacing;
  let hi = params.targetSpacing + MAX_SHIFT * params.halfLife;
  if (allowedTarget(baseTarget, hi, params) < target) return Infinity;

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (allowedTarget(baseTarget, mid, params) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}
