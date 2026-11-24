/* ---------------------------------------------------------------------------
 * COPIED FILE. Edits here are overwritten.
 *
 * Copied verbatim from the Proof of What? node software by that project's
 * packaging step, which compares the two byte-for-byte every time it runs. It
 * is not maintained in this repository: a change made here is reverted by the
 * next packaging run, without a merge and without a warning.
 *
 * The constants that are the validator's live in the Aiken validator, and it
 * is the authority for them:
 *
 *     https://github.com/proofofwhat/contracts
 *     lib/what/parameters.ak, and `MIN_TARGET` in lib/what/difficulty.ak
 *
 * Not all of them are its. The difficulty-1 convention the rate calculations
 * read, and the two hashrate windows, are not script-hash constants and are in
 * no `.ak` file; each says below where it comes from, and the NOTICE in this
 * repository says the same. Nothing here is a rule — the rule is in
 * `difficulty.ts` beside this file, and `npm run parity` checks it.
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
 * Protocol constants.
 *
 * Those that exist in `contracts/lib/what/parameters.ak` must match it exactly:
 * they are baked into the validator's script hash, and the off-chain side has
 * to compute the same allowed target the validator will check against, or every
 * block it builds is rejected.
 *
 * Not all of them do. `MIN_TARGET` lives in `difficulty.ak`;
 * `HASHES_PER_DIFFICULTY` and `DIFFICULTY_ONE_TARGET` are Bitcoin's difficulty
 * convention, which the validator never needs because it works in targets; and
 * the two hashrate windows are a whitepaper section 9 convention rather than a
 * script-hash constant. Each says below where it comes from.
 *
 * `npm run parity` cross-checks the arithmetic that uses them against the
 * validator, by generating `contracts/lib/what/parity.ak` for `aiken check`.
 */

/** Token name of the WHAT native asset, minted one block reward at a time. */
export const TOKEN_NAME = "WHAT";

/** Token name of the state-thread NFT identifying the tip UTxO. */
export const TIP_TOKEN_NAME = "tip";

/** Magic prefix of the coinbase commitment, and the chain tag. */
export const CHAIN_TAG = "WHAT";

/**
 * Bitcoin's issuance schedule, unchanged: 50 WHAT a block, halving every
 * 210,000 blocks. WHAT carries 8 decimal places, so the payout is in the
 * smallest unit and 50 WHAT is 5,000,000,000 of them.
 */
export const HALVING_NUMBER = 210_000;
export const INITIAL_PAYOUT = 5_000_000_000n;

/** Target block interval, in milliseconds. Cardano's POSIX times are in ms. */
export const TARGET_SPACING = 600_000;

/** Half-life of the difficulty rule, in milliseconds. */
export const HALF_LIFE = 600_000;

/**
 * Easiest target the protocol will ever allow: `0x7fffff * 256^29`, about two
 * hashes a block. That is a full-width nBits mantissa at the loosest exponent
 * that still fits a 256-bit target — nBits can encode one step more with a
 * narrower mantissa, `0xffff * 256^30`, exactly twice as loose and one hash a
 * block, which is not worth the special case.
 *
 * Deliberately not Bitcoin's 2^224. Bitcoin stops loosening at difficulty 1
 * because it has to — a chain with no other clock cannot let blocks become
 * free. WHAT takes its time from Cardano and pays per block from a
 * height-indexed schedule, so the rate is governed by the decay law and the
 * per-block tightening, not by the cost of a hash: a lone CPU mints at ~600 s
 * whatever the target, and the moment it stops being lone the target tightens
 * under it. Clamping at 2^224 does not prevent cheap blocks, it only makes
 * issuance fall behind 600 s whenever the hashpower present is below Bitcoin's
 * floor — which is the one case this chain exists to serve.
 *
 * So the only ceiling left is the header format's. If nobody is hashing, the
 * first hash that shows up should win.
 */
export const POW_LIMIT = ((1n << 23n) - 1n) * (1n << 232n);

/** Hardest target the protocol will accept. In the validator this is in `difficulty.ak`. */
export const MIN_TARGET = 1n;

/**
 * A reference value for the validator's `initial_target` parameter: the base
 * target a single ~1 TH/s rig takes about five minutes a block at — 2^48
 * expected hashes, difficulty 65,535. `2^207` is the ten-minute figure for the
 * same rig.
 *
 * Not used by the validator. T0 is a per-chain parameter, so a local test
 * network can run the same code at `POW_LIMIT`, which a CPU can mine. This is
 * kept as a starting point to reason from, and the tests use it as a realistic
 * base.
 */
export const REFERENCE_INITIAL_TARGET = 1n << 208n;

/**
 * Beyond this many half-lives either side of schedule the exponential is
 * clamped instead of evaluated. Every target is below 2^255 and the base is at
 * least 1, so from 255 shifts up the law lands on the pow limit anyway: at this
 * value the clamp never changes a result, it only skips the arithmetic.
 *
 * It has to be this high. Any cutoff low enough to bite sends a tight base
 * straight to the pow limit after a long stall instead of following the law,
 * which then takes more blocks to climb back than the stall cost. The price of
 * 256 is integers of about 530 bits on the path where the clamp would have
 * fired.
 */
export const MAX_SHIFT = 256;

/** Longest coinbase commitment the validator will parse, in bytes. */
export const MAX_COINBASE_LENGTH = 256;

/** Longest serialised Cardano address the coinbase may commit to. */
export const MAX_ADDRESS_LENGTH = 128;

/** Widest transaction validity interval accepted, in milliseconds. */
export const MAX_VALIDITY_SPAN = 120_000;

/**
 * Hashes expected per difficulty unit — Bitcoin's 2^32. Not a validator
 * constant: the rule works in targets, and difficulty is a reading of one.
 */
export const HASHES_PER_DIFFICULTY = 2n ** 32n;

/** Bitcoin's difficulty-1 target, the denominator of that reading. */
export const DIFFICULTY_ONE_TARGET = 0xffffn * 2n ** 208n;

/**
 * The two hashrate windows whitepaper section 9 fixes, in blocks. A convention
 * of the measurement, not a validator constant — nothing on chain reads them.
 *
 * One window cannot do both jobs, so the paper names two and neither is a free
 * choice: six blocks is about an hour and its spread is near fifty per cent,
 * whose purpose is to show an arrival while it is happening; 144 blocks is
 * about a day, its spread is near eight per cent, and it is the figure to
 * quote. A Bitcoin hashrate set beside the second comes from a 24-hour window
 * of Bitcoin's own — a different estimator, which a comparison has to say.
 */
export const HASHRATE_WINDOW_FAST = 6;
export const HASHRATE_WINDOW_QUOTED = 144;

/** Bitcoin's schedule: 50 WHAT, halved every 210,000 blocks, to zero. */
export function blockReward(height: number): bigint {
  const halvings = Math.floor(height / HALVING_NUMBER);
  if (halvings > 32) return 0n;
  return INITIAL_PAYOUT / 2n ** BigInt(halvings);
}
