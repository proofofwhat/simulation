import type { Config } from "./config.js";
import type { Rng } from "./rng.js";

/**
 * Instantaneous hashpower as a mean-reverting process in log space, with
 * Poisson jumps standing in for fleets of rigs being pointed at (or away from)
 * the chain all at once.
 *
 *   d(ln H) = reversion * (ln Hbar - ln H) dt + volatility dW   + jumps
 */
export class HashpowerProcess {
  private logH: number;
  private readonly logMean: number;
  /** Set for one step after a jump, for the log to annotate. */
  lastJump: number | null = null;

  constructor(private readonly cfg: Config, private readonly rng: Rng) {
    this.logH = Math.log(cfg.initialHashpower);
    this.logMean = Math.log(cfg.meanHashpower);
  }

  get value(): number {
    return Math.exp(this.logH);
  }

  /** Advance the process by `dt` seconds. */
  step(dt: number): void {
    this.lastJump = null;
    const { reversion, volatility, jumpMeanInterval, jumpSize } = this.cfg;

    this.logH +=
      reversion * (this.logMean - this.logH) * dt +
      volatility * Math.sqrt(dt) * this.rng.normal();

    // At most one jump per step; dt is small relative to jumpMeanInterval.
    if (jumpMeanInterval > 0 && this.rng.bernoulli(1 - Math.exp(-dt / jumpMeanInterval))) {
      const magnitude = jumpSize * Math.abs(this.rng.normal());
      const sign = this.rng.bernoulli(0.5) ? 1 : -1;
      this.logH += sign * magnitude;
      this.lastJump = Math.exp(sign * magnitude);
    }
  }
}
