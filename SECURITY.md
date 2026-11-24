# Security

This repository is a simulation. It holds no keys, signs nothing, touches no
chain and reaches no network. Running it cannot cost anyone anything, and a bug
in it cannot either.

One qualification, because it is the only socket in the tree: `npm run browser`
starts an HTTP server bound to `127.0.0.1` that serves this directory to your
own browser, and opens a tab. It is a development server — it does no access
control and will serve any file under the package root to anything that can
reach that port — so treat it as you would any other local dev server, and do
not expose it. Nothing else here listens, connects out, or resolves a name.

That is worth saying plainly, because it decides what is worth reporting here.

## Reporting

Most of what is listed below is not sensitive. A figure that does not
reproduce, or a flaw in the model, is a correctness bug — **open an issue**,
and a public thread is the better place for it anyway.

Use GitHub's **private vulnerability reporting** (the *Security* tab → *Report
a vulnerability*) when saying it in the open before it is fixed would do harm.
A finding against the validator is the clearest case, and it goes to
`proofofwhat/contracts` rather than here.

There is no bounty. Reports are read and acknowledged either way.

## What is actually in scope

The difficulty rule is not defined here. `src/what/difficulty.ts` and
`src/what/parameters.ts` are copied verbatim from the node software and are a
port of the Aiken validator, which is where the rule is specified and enforced:

  https://github.com/proofofwhat/contracts

**A flaw in the rule itself belongs there**, against `lib/what/difficulty.ak`,
and that repository's SECURITY.md explains why a finding against the validator
is unusually expensive — its hash is the chain's identity, so a fix is a new
chain rather than a patch.

You do not have to take the port on trust. `npm run parity` checks it against
the 224 vectors in that repository's `lib/what/parity.ak` — the same assertions
`aiken check` runs against the validator — from a committed file, with no Aiken
and no network:

```sh
npm run parity
```

Read `tools/parity.ts` before relying on it: the vectors were generated from
this TypeScript and are asserted against the Aiken, so running them this way is
the same evidence read backwards, and a bug shared by both implementations
would satisfy it. What it establishes is that the file here is the file the
validator's tests pass against.

What is in scope here is anything that makes this repository **misrepresent**
that rule:

- `npm run parity` failing, or the vectors in `test/parity-vectors.json` not
  matching `lib/what/parity.ak` at the revision that file names.
- The model around the rule being wrong in a way that flatters it: the Poisson
  discovery process, the Cardano block-rate ceiling, the collision and orphan
  accounting, or the hashpower process.
- A figure in `README.md` that the stated command does not reproduce. Every
  number the simulation produces names its seed, block count and parameters;
  if one does not come out, that is a defect.

  This is about the simulation's own output. The three hashrates and the
  `model` row of the orphan-rate table are not that — see below.

## Out of scope

- **Floating point in the display layer.** Difficulty is a reciprocal of an
  exact integer target; the conversion for charts and logs loses precision
  below about 2^-53 relative and is deliberately display-only. The rule itself
  never touches a float.
- **The optional epoch retarget** (`--epoch N`). That is Bitcoin's rule, kept
  for comparison, off by default, and not part of this chain.
- **Calibration defaults.** `--volatility`, `--jump-interval` and the rest are
  modelling choices, documented in `README.md`, and arguing with them is a
  discussion rather than a report.
- **The `model` row** of the orphan-rate table in `README.md`. It is an
  analytic figure worked out by hand from the hazard, and the README says so.
  Nothing here computes it, so nothing here can be wrong about it; an error in
  the derivation is a correction, not a vulnerability.
- **The three hashrates**, to better than an order of magnitude. A software
  miner at 0.5 MH/s, an ASIC at 1 TH/s and a warehouse at 2 EH/s are there to
  set the scale between the three, and the thing being demonstrated is that the
  rule answers a change of that size. Whether an ASIC is 1.0 or 1.2 TH/s does
  not move the chart or any conclusion drawn from it. A report that one is out
  by a factor of ten is worth making; a report that one is out by 20% is not.
- **Dependency advisories against `tsx` or `typescript`.** They are development
  dependencies; nothing here ships or runs them in production, because there is
  no production.

## Supported versions

The tip of `main`. There are no releases.
