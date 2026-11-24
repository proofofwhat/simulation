/**
 * Hashpower counted in machines rather than modelled as a process.
 *
 * `HashpowerProcess` answers "what does a chain's hashpower look like from the
 * outside" — a mean-reverting drift with fleet-sized jumps. This answers a
 * different question, the one somebody asks with their hand on a button: what
 * happens to this chain if I point one more rig at it?
 *
 * Both satisfy `HashpowerSource`, so the difficulty law, the Poisson discovery
 * process and the collision model are identical under either. Nothing here
 * reimplements any of that.
 *
 * ## The three rates
 *
 * All three are round numbers to one significant figure, and the precision
 * stops there on purpose. What this demonstrates is that the difficulty rule
 * answers a change of SCALE — the arrival of hashpower a million times what
 * was there — and the third digit of any one rate does not enter into that.
 * Being within an order of magnitude is the requirement.
 *
 * A **software miner** is the CPU miner that ships with the node, running
 * three workers at `nice -n 19`: **0.5 MH/s**, rounded from a bench reading of
 * 0.49.
 *
 * A **Bitaxe** is a Bitaxe Gamma 601: **1 TH/s**, the machine's rate.
 *
 * A **warehouse** is a stated construction, and the statement is the whole of
 * it: ten thousand current-generation ASICs at 200 TH/s each, **2 EH/s** — a
 * modest commercial site, not a large one. Anyone who disagrees with the
 * composition can read the figure straight off it, which is the point of
 * writing it as a product rather than as a number.
 *
 * ## The ratios are the demonstration
 *
 * One Bitaxe is about **two million** software miners, and one warehouse is
 * about **two million** Bitaxes. That is why the software counter stops
 * mattering the instant an ASIC appears, and why the ASIC counter stops
 * mattering the instant a warehouse does: hashpower arrives in units that
 * dwarf whatever came before, and the difficulty answers accordingly.
 *
 * The browser front end lets that be discovered rather than explained: it
 * opens with no ASIC, so software miners visibly drive the chain until one is
 * added.
 */

/** Hashes per second from one software miner: the node's CPU miner, 3 workers. */
export const SOFTWARE_MINER_HASHRATE = 0.5e6;

/** Hashes per second from one Bitaxe Gamma 601. */
export const BITAXE_HASHRATE = 1e12;

/** Hashes per second from one warehouse: 10,000 ASICs at 200 TH/s each. */
export const WAREHOUSE_HASHRATE = 10_000 * 200e12;

export class Fleet {
  software: number;
  bitaxes: number;
  warehouses: number;

  constructor(software = 1, bitaxes = 0, warehouses = 0) {
    this.software = Math.max(0, Math.floor(software));
    this.bitaxes = Math.max(0, Math.floor(bitaxes));
    this.warehouses = Math.max(0, Math.floor(warehouses));
  }

  get value(): number {
    return (
      this.software * SOFTWARE_MINER_HASHRATE +
      this.bitaxes * BITAXE_HASHRATE +
      this.warehouses * WAREHOUSE_HASHRATE
    );
  }

  /**
   * A counted fleet does not drift. It changes when somebody changes it, which
   * is the point of counting it — so there is nothing to advance here, and
   * nothing random. Two runs with the same button presses are the same run.
   */
  step(_dt: number): void {}

  /**
   * Always null. A jump annotation means "a fleet moved and nobody pressed
   * anything", which cannot happen here: every change has a cause the user
   * performed, and the front end already knows about it.
   */
  readonly lastJump: number | null = null;

  /** The share of total hashpower the software miners account for, 0 to 1. */
  get softwareShare(): number {
    const total = this.value;
    return total === 0 ? 0 : (this.software * SOFTWARE_MINER_HASHRATE) / total;
  }
}
