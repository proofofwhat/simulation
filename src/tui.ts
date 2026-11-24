import type { Config } from "./config.js";
import { duration, hashrate, si } from "./format.js";
import type { Tick } from "./sim.js";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

export interface Sample {
  hashpower: number;
  difficulty: number;
}

/**
 * Column chart of `values` on a log scale, `height` rows tall, newest at the
 * right. Returns rows top-to-bottom.
 */
function chart(values: number[], width: number, height: number, color: string): string[] {
  const rows: string[] = [];
  const data = values.slice(-width);
  if (data.length === 0) return Array.from({ length: height }, () => " ".repeat(width));

  const logs = data.map((v) => Math.log(Math.max(v, Number.MIN_VALUE)));
  let lo = Math.min(...logs);
  let hi = Math.max(...logs);
  if (hi - lo < 1e-9) {
    hi += 0.5;
    lo -= 0.5;
  }

  const levels = height * BLOCKS.length;
  const filled = logs.map((l) => Math.max(1, Math.round(((l - lo) / (hi - lo)) * levels)));

  for (let row = height - 1; row >= 0; row -= 1) {
    let line = "";
    for (const f of filled) {
      const inRow = f - row * BLOCKS.length;
      if (inRow <= 0) line += " ";
      else if (inRow >= BLOCKS.length) line += BLOCKS[BLOCKS.length - 1];
      else line += BLOCKS[inRow - 1];
    }
    line += " ".repeat(Math.max(0, width - filled.length));
    rows.push(color + line + RESET);
  }
  return rows;
}

/**
 * Extremes over the whole run. The charts and the interval mean read from ring
 * buffers that discard old samples, so they cannot be used for this: an extreme
 * would silently vanish once it aged out of the window.
 */
class Extent {
  lo = Infinity;
  hi = -Infinity;

  add(v: number): void {
    if (v < this.lo) this.lo = v;
    if (v > this.hi) this.hi = v;
  }

  get empty(): boolean {
    return this.lo === Infinity;
  }
}

function axis(e: Extent, fmt: (n: number) => string): string {
  if (e.empty) return "";
  return `${DIM}run min ${fmt(e.lo)}  max ${fmt(e.hi)}${RESET}`;
}

export class Tui {
  private samples: Sample[] = [];
  private log: string[] = [];
  private latest: Tick | null = null;
  private blockCount = 0;
  /** Rolling window, for the recent-behavior mean only. */
  private intervals: number[] = [];
  /** Whole-run extremes, unaffected by the ring buffers above. */
  private readonly hpExtent = new Extent();
  private readonly ddExtent = new Extent();
  private readonly intervalExtent = new Extent();

  constructor(private readonly cfg: Config) {
    process.stdout.write("\x1b[?1049h\x1b[?25l");
  }

  stop(): void {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }

  push(tick: Tick, line: string | null): void {
    this.latest = tick;
    this.samples.push({
      hashpower: tick.hashpower,
      difficulty: tick.difficulty,
    });
    if (this.samples.length > 4000) this.samples.splice(0, this.samples.length - 4000);
    this.hpExtent.add(tick.hashpower);
    this.ddExtent.add(tick.difficulty);
    if (tick.block) {
      this.blockCount += 1;
      this.intervalExtent.add(tick.block.interval);
      this.intervals.push(tick.block.interval);
      if (this.intervals.length > 200) this.intervals.shift();
    }
    if (line) {
      this.log.push(line);
      if (this.log.length > 500) this.log.shift();
    }
  }

  render(): void {
    const t = this.latest;
    if (!t) return;
    const width = Math.max(40, (process.stdout.columns ?? 100) - 2);
    const rows = Math.max(20, process.stdout.rows ?? 40);

    const chartH = Math.max(4, Math.min(10, Math.floor((rows - 12) / 2)));
    const logH = rows - 2 * chartH - 10;

    const hp = this.samples.map((s) => s.hashpower);
    const dd = this.samples.map((s) => s.difficulty);
    const mean =
      this.intervals.length > 0
        ? this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length
        : 0;
    const min = this.intervalExtent.empty ? 0 : this.intervalExtent.lo;
    const max = this.intervalExtent.empty ? 0 : this.intervalExtent.hi;

    const out: string[] = [];
    out.push(
      `${BOLD}Proof of What? — difficulty adjustment${RESET}  ` +
        `${DIM}seed=${this.cfg.seed} speed=${this.cfg.speed}x target=${duration(this.cfg.targetBlockTime)} ` +
        `epoch=${this.cfg.epochBlocks}blk half-life=${duration(this.cfg.decayHalfLife)}  (q to quit)${RESET}`,
    );
    out.push(
      `sim t=${BOLD}${duration(t.time)}${RESET}  cardano=${t.cardanoHeight}  ` +
        `WHAT blocks=${BOLD}${this.blockCount}${RESET}  orphaned=${t.orphans}  ` +
        `interval mean=${BOLD}${duration(mean)}${RESET}${DIM}(last ${this.intervals.length})${RESET} ` +
        `min=${duration(min)} max=${duration(max)}${DIM}(run) ` +
        `target ${duration(this.cfg.targetBlockTime)}${RESET}`,
    );
    out.push("");
    out.push(`${CYAN}hashpower${RESET}  now ${BOLD}${hashrate(t.hashpower)}${RESET}   ${axis(this.hpExtent, hashrate)}`);
    out.push(...chart(hp, width, chartH, CYAN));
    out.push("");

    const overdue = t.overage > 0;
    out.push(
      `${YELLOW}difficulty${RESET} eff ${BOLD}${si(t.difficulty)}${RESET}  ` +
        `decay ${overdue ? RED : ""}x${t.decay.toFixed(3)}${RESET}  ` +
        `overdue ${overdue ? RED : DIM}${duration(t.overage)}${RESET}  ` +
        `E[interval] ${duration(t.expectedInterval)}   ${axis(this.ddExtent, si)}`,
    );
    out.push(...chart(dd, width, chartH, YELLOW));
    out.push(`${DIM}${"─".repeat(width)}${RESET}`);

    const tail = this.log.slice(-Math.max(3, logH));
    out.push(...tail);

    process.stdout.write("\x1b[H\x1b[2J" + out.join("\n") + "\n");
  }
}
