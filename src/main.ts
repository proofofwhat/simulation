import { DEFAULTS, type Config } from "./config.js";
import { blockLine, duration, tickLine } from "./format.js";
import { simulate, type Tick } from "./sim.js";
import { Tui } from "./tui.js";

const USAGE = `Proof of What? — difficulty simulation

  npx tsx src/main.ts [options]

  --seed N              RNG seed (default ${DEFAULTS.seed})
  --blocks N            stop after N WHAT blocks (0 = forever)
  --plain               one line per block on stdout, no UI (runs as fast as it can)
  --speed N             simulated seconds per real second in UI mode (default ${DEFAULTS.speed})
  --step S              integration step in seconds (default ${DEFAULTS.integrationStep})
  --sample S            seconds between chart samples / idle log lines (default ${DEFAULTS.sampleInterval})

  --target S            target WHAT block time in seconds (default ${DEFAULTS.targetBlockTime})
  --epoch N             Bitcoin-style upward retarget every N blocks, 0 = off (default ${DEFAULTS.epochBlocks})
  --half-life S         difficulty halves per S seconds a block is overdue (default ${DEFAULTS.decayHalfLife})
  --job-refresh S       Stratum job refresh interval in seconds (default ${DEFAULTS.jobRefresh})
  --max-up N            cap on a single upward retarget (default ${DEFAULTS.maxRetargetUp})
  --min-difficulty N    difficulty floor (default ${DEFAULTS.minDifficulty})
  --difficulty N        initial difficulty (default: matched to initial hashpower)

  --cardano S           mean Cardano block time in seconds (default ${DEFAULTS.cardanoMeanBlockTime})
  --hashpower H         initial hashpower in hashes/s, e.g. 1e15 (default ${DEFAULTS.initialHashpower})
  --mean-hashpower H    long-run mean hashpower (default ${DEFAULTS.meanHashpower})
  --reversion R         mean-reversion rate per second (default ${DEFAULTS.reversion})
  --volatility V        log-hashpower volatility per sqrt(s) (default ${DEFAULTS.volatility})
  --jump-interval S     mean seconds between fleet jumps, 0 to disable (default ${DEFAULTS.jumpMeanInterval})
  --jump-size N         jump magnitude in log space (default ${DEFAULTS.jumpSize})
`;

function parseArgs(argv: string[]): Config {
  const cfg: Config = { ...DEFAULTS };
  const num = (v: string | undefined, name: string): number => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n)) {
      console.error(`error: --${name} needs a number`);
      process.exit(1);
    }
    return n;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
      case "--plain":
        cfg.plain = true;
        continue;
      case "--seed": cfg.seed = num(next, "seed"); break;
      case "--blocks": cfg.blocks = num(next, "blocks"); break;
      case "--speed": cfg.speed = num(next, "speed"); break;
      case "--step": cfg.integrationStep = num(next, "step"); break;
      case "--sample": cfg.sampleInterval = num(next, "sample"); break;
      case "--target": cfg.targetBlockTime = num(next, "target"); break;
      case "--epoch": cfg.epochBlocks = num(next, "epoch"); break;
      case "--half-life": cfg.decayHalfLife = num(next, "half-life"); break;
      case "--job-refresh": cfg.jobRefresh = num(next, "job-refresh"); break;
      case "--max-up": cfg.maxRetargetUp = num(next, "max-up"); break;
      case "--min-difficulty": cfg.minDifficulty = num(next, "min-difficulty"); break;
      case "--difficulty": cfg.initialDifficulty = num(next, "difficulty"); break;
      case "--cardano": cfg.cardanoMeanBlockTime = num(next, "cardano"); break;
      case "--hashpower": cfg.initialHashpower = num(next, "hashpower"); break;
      case "--mean-hashpower": cfg.meanHashpower = num(next, "mean-hashpower"); break;
      case "--reversion": cfg.reversion = num(next, "reversion"); break;
      case "--volatility": cfg.volatility = num(next, "volatility"); break;
      case "--jump-interval": cfg.jumpMeanInterval = num(next, "jump-interval"); break;
      case "--jump-size": cfg.jumpSize = num(next, "jump-size"); break;
      default:
        console.error(`error: unknown option ${arg}\n`);
        process.stdout.write(USAGE);
        process.exit(1);
    }
    i += 1;
  }
  return cfg;
}

function lineFor(tick: Tick): string | null {
  return tick.block ? blockLine(tick, tick.block) : tickLine(tick);
}

function runPlain(cfg: Config): void {
  const intervals: number[] = [];
  let last: Tick | null = null;
  for (const tick of simulate(cfg)) {
    const line = lineFor(tick);
    if (line) console.log(line);
    if (tick.block) intervals.push(tick.block.interval);
    last = tick;
  }
  // Summary on stderr, so stdout stays one line per event.
  if (last && intervals.length > 0) {
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const stalls = intervals.filter((i) => i > cfg.targetBlockTime * 3).length;
    console.error(
      `summary: blocks=${intervals.length} mean=${mean.toFixed(0)}s median=${median.toFixed(0)}s ` +
        `target=${cfg.targetBlockTime}s max=${sorted[sorted.length - 1]!.toFixed(0)}s ` +
        `>3x-target=${stalls} orphans=${last.orphans} simTime=${duration(last.time)}`,
    );
  }
}

function runTui(cfg: Config): void {
  const sim = simulate(cfg);
  const tui = new Tui(cfg);
  let simTime = 0;
  let pending: Tick | null = null;
  let done = false;

  const quit = (): void => {
    tui.stop();
    process.exit(0);
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (buf) => {
      const key = buf.toString();
      if (key === "q" || key === "\x03") quit();
    });
  }
  process.on("SIGINT", quit);

  const frameMs = 80;
  const timer = setInterval(() => {
    simTime += (cfg.speed * frameMs) / 1000;

    for (;;) {
      if (!pending) {
        const next = sim.next();
        if (next.done) {
          done = true;
          break;
        }
        pending = next.value;
      }
      if (pending.time > simTime) break;
      tui.push(pending, lineFor(pending));
      pending = null;
    }

    tui.render();
    if (done) {
      clearInterval(timer);
      tui.stop();
      process.exit(0);
    }
  }, frameMs);
}

const cfg = parseArgs(process.argv.slice(2));
if (cfg.plain) runPlain(cfg);
else runTui(cfg);
