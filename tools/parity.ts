/**
 * Check the difficulty rule against the validator's own test vectors.
 *
 *   npm run parity
 *
 * `test/parity-vectors.json` holds the 224 assertions in `lib/what/parity.ak`
 * in the Aiken validator at https://github.com/proofofwhat/contracts, which is
 * where the rule is specified and enforced. `aiken check` asserts the validator
 * satisfies every one of them. This asserts the TypeScript here does too.
 *
 * No Aiken, no toolchain, no network: the vectors are a committed file and the
 * rule is a pure function of two integers. The file records the revision of the
 * validator it was taken from, so a reader can check out that commit and diff.
 *
 * Worth being exact about what this proves, since it is the evidence offered
 * for the claim that `src/what/difficulty.ts` is a port rather than a second
 * opinion. The vectors were generated from the TypeScript and are asserted
 * against the Aiken, so running them this way is reading the same evidence
 * backwards: a bug shared by both implementations would satisfy it. What it
 * does establish is that the file shipped here is the file the validator's
 * tests pass against — which is the claim being made, and which nothing else
 * in this repository could otherwise support.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allowedTarget, nextBaseTarget } from "../src/difficulty.js";

interface Vectors {
  source: string;
  revision: string;
  count: number;
  /** `[fn, baseTarget, elapsedMs, expectedTarget]`, targets in hex. */
  vectors: Array<[string, string, number, string]>;
}

const path = fileURLToPath(new URL("../test/parity-vectors.json", import.meta.url));
const data = JSON.parse(readFileSync(path, "utf8")) as Vectors;

let checked = 0;
const failures: string[] = [];

for (const [fn, base, elapsed, expected] of data.vectors) {
  const got =
    fn === "a"
      ? allowedTarget(BigInt(base), elapsed)
      : nextBaseTarget(BigInt(base), elapsed);
  checked += 1;
  if (got !== BigInt(expected)) {
    const name = fn === "a" ? "allowedTarget" : "nextBaseTarget";
    failures.push(`${name}(${base}, ${elapsed})\n  expected ${expected}\n  got      0x${got.toString(16)}`);
  }
}

/* The literal, not `data.count`. A vectors file truncated to ten entries with
   a matching `count` would otherwise pass and print "all 10 agree", while the
   README, SECURITY.md and both vendored headers say 224 in prose that nothing
   enforces. The number is part of the claim, so it is asserted here. */
const EXPECTED = 224;
if (checked !== EXPECTED || data.count !== EXPECTED) {
  console.error(
    `expected ${EXPECTED} vectors, the file declares ${data.count} and ${checked} ran.\n` +
      `Regenerate it from lib/what/parity.ak, or the count in prose is wrong.`,
  );
  process.exit(2);
}

console.log(`source    ${data.source}`);
console.log(`revision  ${data.revision}`);
console.log(`vectors   ${checked}\n`);

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL  ${f}\n`);
  console.error(
    `${failures.length} of ${checked} vectors disagree with the validator.\n` +
      `The two implementations have diverged. Fix the disagreement rather than\n` +
      `editing the vectors: the validator is the authority.`,
  );
  process.exit(1);
}

console.log(`all ${checked} agree with the validator.`);
