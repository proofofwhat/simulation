/**
 * The simulation, in a browser, driven by a counted fleet.
 *
 * This is a renderer and nothing else. Every number it shows comes out of
 * `simulate()` in `../src/sim.ts` — the same generator the terminal UI
 * consumes, running the same difficulty law, the same Poisson discovery and
 * the same collision model. The only thing that differs is where hashpower
 * comes from: a `Fleet` the buttons mutate, instead of the stochastic process
 * the CLI uses.
 *
 * ## Why it runs on a clock rather than as fast as it can
 *
 * The generator is synchronous and will happily produce a year of chain in a
 * second. That is right for a batch run and wrong here: the thing worth seeing
 * is the difficulty *answering* a fleet change, which takes simulated hours.
 * So it is pulled on a timer at a speed the user sets, and the fleet is read
 * fresh on every tick — press `+` and the next step already includes it.
 */

import {
  Fleet,
  SOFTWARE_MINER_HASHRATE,
  BITAXE_HASHRATE,
  WAREHOUSE_HASHRATE,
} from "../src/fleet.js";
import {
  DEFAULTS,
  HASHES_PER_DIFFICULTY,
  difficultyForHashpower,
  type Config,
} from "../src/config.js";
import { simulate, type Tick } from "../src/sim.js";

/* ---- the run ------------------------------------------------------------ */

/* Opening state from the query string, so a particular run is a link:
   ?software=1&bitaxes=1&warehouses=0&speed=600&window=21600. It also makes the
   page renderable without a human: headless browsers fire requestAnimationFrame
   sparingly, so a screenshot at an ordinary speed shows almost no chain, and a
   high `speed` is what gets a meaningful picture out of one. */
const params = new URLSearchParams(location.search);
/* Read and floored at zero, and nothing more. WHICH values are admissible
   depends on the control that displays them, so that is settled where the
   control is bound — against the element itself, so the list of choices stays
   in the markup alone. A range test is not enough: `?window=3600` sits inside
   the select's range and matches no option, which leaves the select at
   selectedIndex -1 — blank, beside a chart plotting an hour. */
const num = (key: string, fallback: number): number => {
  const raw = params.get(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
};

const fleet = new Fleet(num("software", 1), num("bitaxes", 0), num("warehouses", 0));

/* `initialDifficulty` stays "auto", which derives the opening difficulty from
   `initialHashpower`. A counted fleet has no such figure, so `initialHashpower`
   is pinned to one software miner's rate and the chain starts where that miner
   can actually find a block; the law takes it from there. Starting above what
   the hashpower present can meet is then reachable deliberately, by opening
   with a fleet smaller than that. */
const cfg: Config = {
  ...DEFAULTS,
  seed: 1,
  initialHashpower: SOFTWARE_MINER_HASHRATE,
  meanHashpower: SOFTWARE_MINER_HASHRATE,
};

let run = simulate(cfg, fleet);
let tick: Tick | null = null;

/** Seconds of simulated time per real second. Set from the slider below. */
let speed = 600;
let running = true;

/* ---- history, for the chart --------------------------------------------- */

/**
 * History is kept against the WIDEST window the control offers, not the one in
 * force, so switching from 30 minutes to 48 hours shows the chain that was
 * already mined rather than redrawing it from the moment of the switch. The
 * window chooses what is plotted; this chooses what is remembered.
 */
const MAX_WINDOW = 48 * 3600;

/**
 * How much SIMULATED TIME the chart covers.
 *
 * A duration, not a count of samples. The generator yields on events, so a
 * fixed number of samples covers wildly different stretches depending on how
 * often blocks are landing: raising the event rate would narrow the view
 * silently, and "a Bitaxe started" and "a Bitaxe stopped" could not be held on
 * screen together. A duration is what the question is about, so it is what the
 * control sets.
 *
 * Set from the <select> below, which is where the admissible values are.
 */
let windowSeconds = 6 * 3600;

/**
 * Samples are capped as well, because 48 hours at a high event rate is
 * unbounded — an ASIC on a fast chain yields far more often than a lone CPU
 * miner. Past this the oldest go, and the chart covers less than the window
 * asks for rather than growing without limit.
 */
const MAX_SAMPLES = 40000;

const difficulty: number[] = [];
const hashpower: number[] = [];
const times: number[] = [];
/** Which recorded samples were the instant a block confirmed. */
const blockAt: boolean[] = [];

function record(t: Tick): void {
  difficulty.push(t.difficulty);
  hashpower.push(t.hashpower);
  times.push(t.time);
  blockAt.push(t.block !== null);

  const cutoff = t.time - MAX_WINDOW;
  while (times.length > 1 && (times[0]! < cutoff || times.length > MAX_SAMPLES)) {
    difficulty.shift();
    hashpower.shift();
    times.shift();
    blockAt.shift();
  }
}

/* ---- formatting --------------------------------------------------------- */

const UNITS = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];

function rate(h: number): string {
  if (h <= 0) return "0 H/s";
  let i = 0;
  let v = h;
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${UNITS[i]}`;
}

/* Signed, because the x axis spans a fixed window that can begin before the
   run did. The window's start is then negative simulated time, and saying so
   is the honest reading of a chart whose left half is empty. */
function clock(s: number): string {
  if (!isFinite(s)) return "—";
  const sign = s < 0 ? "−" : "";
  const sec = Math.abs(Math.round(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  return h > 0
    ? `${sign}${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${sign}${m}:${String(r).padStart(2, "0")}`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

/* ---- the chart ---------------------------------------------------------- */

const canvas = document.getElementById("chart") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function fit(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", fit);

/* The window the x axis spans, recomputed each frame: it always ends at the
   newest sample and is always `windowSeconds` wide, however little data there
   is. Module scope so `series` can reach it without threading it through. */
let xStart = 0;
let xSpan = 1;

/** The plot area, inside the gutters the axis labels need. */
const PAD = { left: 62, right: 86, top: 12, bottom: 22 };

interface Scale {
  path: string;
  /**
   * The range of the DATA, in the series' own units — not the range plotted.
   *
   * A series that never moves still has to be drawn somewhere, so the plotted
   * range is padded to give it a band. Labelling that padding would announce a
   * spread the data does not have — a hashpower pinned at 500 kH/s reading as
   * a range of hundreds. These are the real figures.
   */
  lo: number;
  hi: number;
  /** True when the data does not vary enough to label two ends honestly. */
  flat: boolean;
  /** Where the line sits, for placing a single label when it is flat. */
  midY: number;
  /** Plotted position of every sample; null where the sample is absent. */
  points: Array<{ x: number; y: number } | null>;
}

/**
 * One scale for both lines, because they are the same quantity.
 *
 * Centring each series in its own band would draw them as two unrelated
 * wiggles sharing a box. They are not unrelated: at equilibrium
 * a hashpower H settles at a difficulty of `H × target / 2^32` — which is
 * exactly `difficultyForHashpower`, the function the simulation already uses
 * to derive a starting difficulty from a starting hashpower.
 *
 * So hashpower is plotted AS THE DIFFICULTY IT IMPLIES, on the same axis as
 * the difficulty actually in force. The amber line is then the level the blue
 * line is chasing, and the vertical gap between them is the lag — hashpower
 * steps the instant a rig is plugged in, difficulty climbs toward it one block
 * at a time. That lag is the thing worth seeing, and only a shared scale shows
 * it.
 *
 * The right-hand axis reads the same positions back as hashpower, so the
 * shared scale costs nothing: difficulty on the left, the hashpower that would
 * equilibrate to it on the right.
 */
function impliedDifficulty(h: number): number {
  return difficultyForHashpower(h, cfg.targetBlockTime);
}

/** Hashpower that settles at a given difficulty — the right axis's reading. */
function hashpowerFor(d: number): number {
  return (d * HASHES_PER_DIFFICULTY) / cfg.targetBlockTime;
}

/** Both series are plotted in log space: a fleet change moves them by factors. */
function series(
  values: number[],
  w: number,
  h: number,
  shared: { lo: number; hi: number } | undefined,
  /* First sample inside the window. History now runs back further than the
     window shows, so everything after this point — the range, the labels, the
     path — is computed from `i0` onward and the rest is simply not plotted. */
  i0: number,
): Scale | null {
  if (values.length - i0 < 2) return null;
  /* A non-positive value is absent, not small. With no miners at all the
     implied difficulty is zero — meaning "no hashpower will ever find a
     block", not "a very easy target". Clamping it to some tiny number would
     draw a line along the floor that is simply untrue, and drag the shared
     range down with it. Those samples become gaps instead. */
  const logs: Array<number | null> = [];
  for (let i = i0; i < values.length; i += 1) {
    const v = values[i]!;
    logs.push(v > 0 ? Math.log10(v) : null);
  }
  const present = logs.filter((v): v is number => v !== null);
  if (present.length < 2) return null;
  const dataLo = Math.min(...present);
  const dataHi = Math.max(...present);

  /* Pad a narrow range so a near-constant series is not drawn as a jagged
     magnification of rounding noise. The labels use the data range, not this. */
  const flat = dataHi - dataLo < 0.3;
  let lo = shared ? shared.lo : dataLo;
  let hi = shared ? shared.hi : dataHi;
  if (!shared && flat) {
    const mid = (dataHi + dataLo) / 2;
    lo = mid - 0.15;
    hi = mid + 0.15;
  }

  /* x is SIMULATED TIME across a FIXED window.
     Two things it is not. Not sample index: the generator yields on events, so
     evenly spaced samples would stretch busy stretches and compress quiet ones,
     drawing the 30-second job steps as treads of random width. And not the span
     of the data: mapping first sample to last across the full width makes a
     half-full chart a stretched chart, with the scale changing silently as it
     fills. The window is the window. Early on the data occupies only its
     right-hand part and the left is empty, which is the honest picture. */
  /* `k` indexes from the window start; `times` is indexed absolutely. */
  const x = (k: number) =>
    PAD.left + (((times[i0 + k] ?? xStart) - xStart) / xSpan) * (w - PAD.left - PAD.right);
  const y = (v: number) => h - PAD.bottom - ((v - lo) / (hi - lo)) * (h - PAD.top - PAD.bottom);
  const points = logs.map((v, i) => (v === null ? null : { x: x(i), y: y(v) }));
  /* `M` after every gap, so an absent stretch is a break in the line rather
     than a straight segment across it. */
  let pen = "M";
  const path = points
    .map((p) => {
      if (p === null) {
        pen = "M";
        return "";
      }
      const seg = `${pen}${p.x},${p.y}`;
      pen = "L";
      return seg;
    })
    .filter(Boolean)
    .join(" ");
  return {
    path,
    lo: 10 ** dataLo,
    hi: 10 ** dataHi,
    flat,
    midY: y((dataLo + dataHi) / 2),
    points,
  };
}

function stroke(path: string, colour: string, width: number): void {
  if (!path) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(new Path2D(path));
}

function draw(): void {
  const r = canvas.getBoundingClientRect();
  /* Re-fit when the backing store does not match the box. `fit()` at module
     load runs before layout has settled and sizes the canvas to zero, which
     paints nothing at all — not even the gridlines — while every other part of
     the page works. A blank chart beside live numbers is that symptom. */
  const dpr = window.devicePixelRatio || 1;
  if (Math.abs(canvas.width - r.width * dpr) > 1 || Math.abs(canvas.height - r.height * dpr) > 1) {
    fit();
  }
  const w = r.width;
  const h = r.height;
  ctx.clearRect(0, 0, w, h);

  const newest = times[times.length - 1] ?? 0;
  xSpan = windowSeconds;
  xStart = newest - windowSeconds;

  const top = PAD.top;
  const bottom = h - PAD.bottom;

  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const yy = top + ((bottom - top) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(PAD.left, yy);
    ctx.lineTo(w - PAD.right, yy);
    ctx.stroke();
  }

  /* Genesis, while it is still in view.
     Worth marking because the left end of the chart is not the start of the
     chain — the window is a fixed width and scrolls, so after a few hours t=0
     leaves the screen entirely. Until it does, this is the line everything to
     the right of it is measured from, including the mean interval. */
  if (xStart <= 0 && 0 <= xStart + xSpan) {
    const gx = PAD.left + ((0 - xStart) / xSpan) * (w - PAD.left - PAD.right);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#3fb950";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx, top);
    ctx.lineTo(gx, bottom);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = "#3fb950";
    ctx.textBaseline = "top";
    /* Always to the LEFT of the line. Everything the chart plots is to its
       right, so a label on that side sits on top of the data from the first
       block onwards; the space to the left is empty by definition. */
    ctx.textAlign = "right";
    ctx.fillText("genesis", gx - 4, top + 2);
    ctx.restore();
  }

  /* The first sample the window shows. History runs back as far as MAX_WINDOW
     regardless of the setting, so everything below has to start here — a
     30-minute view must not be scaled, labelled or ranged by two days of data
     sitting off the left of the screen. One sample earlier than the edge is
     deliberately included, so the line enters from the edge rather than
     starting in mid-air; the clip keeps it out of the gutter. */
  let i0 = 0;
  while (i0 + 1 < times.length && times[i0 + 1]! < xStart) i0 += 1;

  /* Both lines share one range, computed over both, so the vertical distance
     between them means something. */
  const implied = hashpower.map(impliedDifficulty);
  let shared: { lo: number; hi: number } | undefined;
  if (difficulty.length - i0 >= 2) {
    const all = [...difficulty.slice(i0), ...implied.slice(i0)]
      .filter((v) => v > 0)
      .map((v) => Math.log10(v));
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (hi - lo < 0.3) {
      const mid = (hi + lo) / 2;
      lo = mid - 0.15;
      hi = mid + 0.15;
    } else {
      /* A little headroom, so a line pinned to the top edge is still readable. */
      const pad = (hi - lo) * 0.06;
      lo -= pad;
      hi += pad;
    }
    shared = { lo, hi };
  }

  const hp = series(implied, w, h, shared, i0);
  const df = series(difficulty, w, h, shared, i0);
  /* Clipped to the plot area, because the sample that carries the line in from
     the left edge sits outside it by construction. */
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, w - PAD.left - PAD.right, h - PAD.top - PAD.bottom);
  ctx.clip();
  if (hp) stroke(hp.path, "#f0a132", 1.5);
  if (df) stroke(df.path, "#4a7dff", 2);
  ctx.restore();

  /* ---- block arrivals ---------------------------------------------------
     Marked on the DIFFICULTY line rather than as free-standing rules, because
     a block is not merely a thing that happened at a time — it is the moment
     the base target moves. Each dot sits exactly on the step it caused, so the
     sawtooth stops being a shape and becomes a sequence of events. A tick on
     the time axis underneath carries the same instants for anyone reading the
     chart as a timeline.

     EVERY block gets a dot, and none are thinned away. Thinning fails the case
     that matters: plug in an ASIC and the blocks arriving while the difficulty
     climbs are exactly what the chart is there to show. A count against a
     threshold also flips the whole row on and off as blocks cross it. Where
     dots are closer together than one is wide they merge into a thickened
     line, which reads as what it is.

     One path, one fill. At a 48-hour window with an ASIC running this is
     thousands of arcs a frame, and issuing them as separate fills is the
     difference between a smooth chart and a stuttering one. The axis ticks are
     thinned to a pixel gap because they are a timeline rather than a count, and
     a solid bar there tells the reader nothing. */
  if (df) {
    const dots = new Path2D();
    const ticks = new Path2D();
    let lastTick = -Infinity;
    for (let i = i0; i < blockAt.length; i += 1) {
      if (!blockAt[i]) continue;
      const p = df.points[i - i0];
      if (!p || p.x < PAD.left) continue;
      dots.moveTo(p.x + 2.4, p.y);
      dots.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      if (p.x - lastTick >= 2) {
        lastTick = p.x;
        ticks.moveTo(p.x, bottom);
        ticks.lineTo(p.x, bottom - 5);
      }
    }

    ctx.fillStyle = "#cfe0ff";
    ctx.fill(dots);
    ctx.strokeStyle = "rgba(207,224,255,0.45)";
    ctx.lineWidth = 1;
    ctx.stroke(ticks);
  }

  /* ---- labels ----------------------------------------------------------
     Each axis is annotated at the top and bottom of the range it actually
     plots, rather than with a fixed scale: both series are auto-ranged in log
     space, so a static axis would be wrong the moment a fleet changes. */
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = "middle";

  /* The floor, drawn whenever the view reaches it.
     Difficulty does not fall for ever: `minDifficulty` is the pow limit, the
     easiest target the header format can express — about two hashes a block.
     It is deliberately NOT difficulty 1, which is where Bitcoin stops: Bitcoin
     needs that floor because its only clock is its own accumulated work, while
     this chain reads Cardano's. A floor at 1 would hold the allowed target
     above what the hashpower present can meet, which is the case this chain
     exists to serve. With nobody mining, the decay runs down to this line and
     stays there. */
  if (shared) {
    const floorLog = Math.log10(cfg.minDifficulty);
    if (floorLog >= shared.lo && floorLog <= shared.hi) {
      const fy =
        h - PAD.bottom - ((floorLog - shared.lo) / (shared.hi - shared.lo)) * (h - PAD.top - PAD.bottom);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(240,161,50,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, fy);
      ctx.lineTo(w - PAD.right, fy);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "rgba(240,161,50,0.85)";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("floor — pow limit, ~2 hashes a block", PAD.left + 6, fy - 3);
      ctx.textBaseline = "middle";
    }
  }

  /* One scale, read two ways: difficulty on the left, and on the right the
     hashpower that would settle at that same difficulty. The two axes are the
     same axis — which is the point, and why the gap between the lines is
     readable as "how far behind the rule currently is". */
  if (shared) {
    const dHi = 10 ** shared.hi;
    const dLo = 10 ** shared.lo;

    ctx.fillStyle = "#4a7dff";
    ctx.textAlign = "right";
    ctx.fillText(difficultyLabel(dHi), PAD.left - 8, top);
    ctx.fillText(difficultyLabel(dLo), PAD.left - 8, bottom);

    /* The hashpower reading goes ON THE LINE, not on the axis ends.
       Those ends would be `hashpowerFor` of the plotted difficulty range, so
       they slide every time the range re-fits — drifting by tens of per cent
       under a fleet that has not changed at all. Anyone would read a figure in
       that position as "my hashpower". So there is one amber number, placed
       where the amber line is, and it is the fleet's real rate. The left axis
       carries the scale; the right axis carries a name and nothing numeric. */
    if (hp) {
      const latest = hashpower[hashpower.length - 1] ?? 0;
      const p = [...hp.points].reverse().find((q) => q !== null);
      if (latest > 0 && p) {
        ctx.fillStyle = "#f0a132";
        ctx.textAlign = "left";
        ctx.fillText(rate(latest), w - PAD.right + 8, p.y);
      }
    }
  }

  /* The window the chart covers, which scrolls once it is full. */
  ctx.fillStyle = "#8b949e";
  ctx.textBaseline = "top";
  if (times.length >= 2) {
    ctx.textAlign = "left";
    ctx.fillText(clock(xStart), PAD.left, bottom + 6);
    ctx.textAlign = "right";
    ctx.fillText(clock(xStart + xSpan), w - PAD.right, bottom + 6);
  }
  ctx.textAlign = "center";
  ctx.fillText(
    times.length >= 2 ? "simulated time" : "waiting for the first ticks",
    (PAD.left + (w - PAD.right)) / 2,
    bottom + 6,
  );

  /* Axis names, so neither colour has to be remembered from the key — and
     both carry "log", because a reader who misses that is reading a chart
     where a step of one gridline is a factor rather than an amount. */
  ctx.save();
  ctx.translate(13, (top + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#4a7dff";
  ctx.fillText("realtime chain difficulty (log)", 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(w - 13, (top + bottom) / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f0a132";
  ctx.fillText("hashpower, as difficulty (log)", 0, 0);
  ctx.restore();
}

/** Difficulty spans many orders of magnitude, so it needs its own compactor. */
function difficultyLabel(d: number): string {
  if (d >= 1e9) return `${(d / 1e9).toFixed(1)}G`;
  if (d >= 1e6) return `${(d / 1e6).toFixed(1)}M`;
  if (d >= 1e3) return `${(d / 1e3).toFixed(1)}k`;
  if (d >= 1) return d.toFixed(2);
  return d.toPrecision(2);
}

/* ---- stats -------------------------------------------------------------- */

const el = (id: string) => document.getElementById(id)!;

function render(): void {
  el("software-count").textContent = count(fleet.software);
  el("bitaxe-count").textContent = count(fleet.bitaxes);
  el("warehouse-count").textContent = count(fleet.warehouses);
  el("fleet-hashrate").textContent = rate(fleet.value);

  /* The ratio, stated rather than left to be inferred from the chart. */
  const ratio = BITAXE_HASHRATE / SOFTWARE_MINER_HASHRATE;
  const share = fleet.softwareShare;
  /* Branch on the share itself, not on "are there any Bitaxes" — that reads
     "all of it" for a fleet of one software miner and a warehouse. */
  el("share").textContent =
    fleet.value === 0
      ? "no miners"
      : share === 1
        ? "all of it"
        : share < 0.0005
          ? "under 0.05% of it"
          : `${(share * 100).toFixed(2)}% of it`;
  el("ratio").textContent = count(Math.round(ratio));
  el("ratio-warehouse").textContent = count(Math.round(WAREHOUSE_HASHRATE / BITAXE_HASHRATE));

  if (!tick) return;
  el("time").textContent = clock(tick.time);
  el("height").textContent = count(tick.block ? tick.block.height : blocks);
  /* The same compactor as the axis, because a fixed four decimal places
     prints the pow limit as "0.0000". At the floor the figure is 4.7e-10, and
     saying so is the whole answer to "does difficulty bottom out". */
  el("difficulty").textContent =
    difficultyLabel(tick.difficulty) +
    (tick.difficulty <= cfg.minDifficulty * 1.001 ? "  (floor)" : "");
  el("expected").textContent = clock(tick.expectedInterval);
  el("overdue").textContent = tick.overage > 0 ? clock(tick.overage) : "—";
  el("orphans").textContent = count(tick.orphans);

  /* Time since genesis divided by the blocks it produced — NOT an average of
     stored intervals. An average of intervals only moves when a block arrives,
     which is exactly backwards for the case worth watching: take a Bitaxe out
     and the thing to see is the figure climbing while nothing lands. The block
     in flight is part of the elapsed time, so it does.
     Before the first block the mean is unbounded, so it is reported as a floor
     that keeps rising and is true at every instant. */
  const height = tick.block ? tick.block.height : blocks;
  el("mean-interval").textContent =
    tick.time <= 0 ? "—" : height === 0 ? `> ${clock(tick.time)}` : clock(tick.time / height);
  el("mean-note").textContent = `${count(height)} block(s) since genesis`;

  /* The same figure over the visible window only, so a fleet change that is on
     screen can be read off the numbers as well as off the chart. The mean
     since genesis carries every block ever mined and barely moves after a few
     hundred of them; this one answers "what are block times doing NOW".
     It counts the chart's own samples, so what it reports and what is drawn
     cannot disagree — and it starts at the first sample rather than at the
     window's left edge while the window is not yet full. */
  const from = Math.max(0, times[0] ?? 0, tick.time - windowSeconds);
  let inWindow = 0;
  for (let i = 0; i < blockAt.length; i += 1) if (blockAt[i] && times[i]! > from) inWindow += 1;
  const span = tick.time - from;
  el("window-interval").textContent =
    span <= 0 ? "—" : inWindow === 0 ? `> ${clock(span)}` : clock(span / inWindow);
  el("window-note").textContent = `${count(inWindow)} block(s) in ${clock(span)}`;
}

/* ---- the loop ----------------------------------------------------------- */

let blocks = 0;
let target = 0;
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  if (running) {
    /* Pace on the tick's OWN clock, not on a step count.
       `simulate()` does not yield once per `integrationStep` — it yields on
       events, a block or a Cardano block or a job refresh, and one `next()`
       can advance half a minute. Six simulated hours is 753 ticks, not 21,600.
       Counting `next()` calls would therefore run the chain tens of times
       faster than the speed control claims, and look entirely plausible doing
       it, because the intervals BETWEEN blocks stay correct either way.
       Advancing until the simulation's own time reaches the target is what
       makes the speed mean what it says. */
    target += dt * speed;
    let guard = 5000; // a backgrounded tab must not try to catch up for ever
    while (tick === null || (tick.time < target && guard-- > 0)) {
      const next = run.next();
      if (next.done) break;
      tick = next.value;
      if (tick.block) blocks = tick.block.height;
      record(tick);
    }
    if (guard <= 0) target = tick ? tick.time : target;
  }

  draw();
  render();
  requestAnimationFrame(frame);
}

/* ---- controls ----------------------------------------------------------- */

function bind(id: string, fn: () => void): void {
  el(id).addEventListener("click", () => {
    fn();
    render();
  });
}

/* Steps that make the counter worth pressing: one at a time is right for ASICs
   and useless for software miners, where the interesting quantities are powers
   of ten. Shift multiplies by a hundred. */
const softwareStep = (e: MouseEvent) => (e.shiftKey ? 100 : 1);

el("software-plus").addEventListener("click", (e) => {
  fleet.software += softwareStep(e as MouseEvent);
  render();
});
el("software-minus").addEventListener("click", (e) => {
  fleet.software = Math.max(0, fleet.software - softwareStep(e as MouseEvent));
  render();
});
bind("bitaxe-plus", () => {
  fleet.bitaxes += 1;
});
bind("warehouse-plus", () => {
  fleet.warehouses += 1;
});
bind("warehouse-minus", () => {
  fleet.warehouses = Math.max(0, fleet.warehouses - 1);
});

bind("bitaxe-minus", () => {
  fleet.bitaxes = Math.max(0, fleet.bitaxes - 1);
});

bind("pause", () => {
  running = !running;
  el("pause").textContent = running ? "Pause" : "Resume";
});

bind("reset", () => {
  run = simulate(cfg, fleet);
  tick = null;
  blocks = 0;
  difficulty.length = 0;
  hashpower.length = 0;
  times.length = 0;
  blockAt.length = 0;
  target = 0;
});

/* The window only chooses what is plotted — samples are retained to
   MAX_WINDOW either way, so widening reveals history already recorded rather
   than starting a fresh fill from the moment of the switch. Beyond 48 hours,
   or past MAX_SAMPLES, the past really is gone. */
const windowInput = el("window") as HTMLSelectElement;
/* The options are the admissible values, so they are read off the element
   rather than restated here. Anything else from the query string lands on the
   nearest one, and the control and the chart therefore cannot disagree. */
const nearest = (v: number, choices: number[]): number =>
  choices.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
windowSeconds = nearest(num("window", windowSeconds), [...windowInput.options].map((o) => Number(o.value)));
windowInput.value = String(windowSeconds);
windowInput.addEventListener("change", () => {
  /* Set the view and nothing else — in particular, do not trim the history to
     the new window. Trimming here would make narrowing to 2 hours destroy
     everything older, so widening again could only show the 2 hours that
     survived. `record` is the one place samples are discarded, and it discards
     against MAX_WINDOW alone. */
  windowSeconds = Number(windowInput.value);
});

const speedInput = el("speed") as HTMLInputElement;
/* The same arithmetic the element applies to its own value: clamp to the ends,
   then land on the step grid. Without it `?speed=137` runs the chain at 137×
   while the thumb sits at 120, and `?speed=0` froze it outright. */
function snap(v: number, input: HTMLInputElement): number {
  const lo = Number(input.min);
  const hi = Number(input.max);
  const step = Number(input.step);
  const clamped = Math.min(hi, Math.max(lo, v));
  return Math.min(hi, lo + Math.round((clamped - lo) / step) * step);
}
speed = snap(num("speed", speed), speedInput);
speedInput.value = String(speed);
speedInput.addEventListener("input", () => {
  speed = Number(speedInput.value);
  el("speed-label").textContent = `${count(speed)}×`;
});

/* ---- go ----------------------------------------------------------------- */

el("rate-software").textContent = rate(SOFTWARE_MINER_HASHRATE);
el("rate-bitaxe").textContent = rate(BITAXE_HASHRATE);
el("rate-warehouse").textContent = rate(WAREHOUSE_HASHRATE);
el("speed-label").textContent = `${count(speed)}×`;
fit();
render();
requestAnimationFrame(frame);
