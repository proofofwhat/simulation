/** Seeded RNG so a run can be reproduced exactly from its seed. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** mulberry32 — uniform on [0,1). */
  uniform(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Exponential interarrival time with the given mean. */
  exponential(mean: number): number {
    return -Math.log(1 - this.uniform()) * mean;
  }

  /** Standard normal (Box-Muller). */
  normal(): number {
    const u = 1 - this.uniform();
    const v = this.uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** True with probability p. */
  bernoulli(p: number): boolean {
    return this.uniform() < p;
  }
}
