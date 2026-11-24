import type { Block, Tick } from "./sim.js";

const HASH_UNITS = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s", "ZH/s"];

export function hashrate(h: number): string {
  let i = 0;
  let v = h;
  while (v >= 1000 && i < HASH_UNITS.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${HASH_UNITS[i]}`;
}

export function duration(s: number): string {
  const sec = Math.round(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

export function si(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(3)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(3)}G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(3)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(3)}k`;
  return n.toFixed(3);
}

/** One line per WHAT block — the primary output. */
export function blockLine(tick: Tick, block: Block): string {
  const parts = [
    `t=${duration(tick.time)}`,
    `blk=${String(block.height).padStart(5)}`,
    `int=${duration(block.interval).padStart(7)}`,
    `hash=${hashrate(tick.hashpower).padStart(11)}`,
    `diff=${si(block.difficulty).padStart(9)}`,
    `decay=${tick.decay.toFixed(3)}`,
    `E[int]=${duration(tick.expectedInterval).padStart(7)}`,
    `conf=${block.confirmationDelay.toFixed(0).padStart(2)}s`,
    `cardano=${tick.cardanoHeight}`,
  ];
  if (block.orphaned > 0) parts.push(`orphaned=${block.orphaned}`);
  if (block.retarget !== null) parts.push(`RETARGET x${block.retarget.toFixed(3)} epoch=${block.epoch}`);
  if (tick.jump !== null) parts.push(`JUMP x${tick.jump.toFixed(2)}`);
  return parts.join("  ");
}

/**
 * Notable non-block events, so the log shows the decay working while a block is
 * overdue: hashpower jumps, and the decay state once a block is late.
 */
export function tickLine(tick: Tick): string | null {
  const jumped = tick.jump !== null;
  const overdue = tick.overage > 0;
  if (!jumped && !overdue) return null;

  const what = jumped
    ? `hashpower JUMP x${tick.jump!.toFixed(2)} -> ${hashrate(tick.hashpower)}`
    : `overdue ${duration(tick.overage).padStart(7)}  hash=${hashrate(tick.hashpower).padStart(11)}`;

  return [
    `t=${duration(tick.time)}`,
    `          `,
    what,
    `(diff=${si(tick.difficulty)} decay=${tick.decay.toFixed(3)} E[int]=${duration(tick.expectedInterval)})`,
  ].join("  ");
}
