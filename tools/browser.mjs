/* Serve the simulation's browser front end, and open a tab.
 *
 *   npm run browser              # port 8770
 *   npm run browser -- 8899      # somewhere else
 *   npm run browser -- --no-open # do not launch a browser (headless, scripts)
 *
 * Binds to 127.0.0.1 and serves the modules the page imports to your own
 * browser, and nothing else: `SERVABLE` below is the list of directories a
 * request can reach. Nothing here listens on any other interface.
 *
 * ## Why this transpiles rather than bundles
 *
 * The browser cannot load `.ts`, and the front end imports straight out of
 * `../src/` — deliberately, because the whole claim is that it runs the same
 * simulation the command line does. A bundler would make that true at build
 * time and then hide it behind an artifact; this keeps the import graph
 * literal, and a reader can follow `app.ts` into `sim.ts` and see there is no
 * second copy of the difficulty rule.
 *
 * `typescript` is already a devDependency, so `ts.transpileModule` costs
 * nothing new. It strips types without type-checking. `npm run typecheck`
 * covers the modules the page loads, so the only thing doing it again here
 * would add is latency on every request.
 *
 * Deliberately not a dependency: no bundler, no framework, no dev-server
 * package. The simulation has zero runtime dependencies and this does not
 * change that.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import ts from "typescript";

/* Everything the page imports lives inside this package, so the package
   is the server root, and the only directory a request can reach. */
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SERVABLE = [ROOT];
const BASE = "/browser/";
/* The first bare number is the port. Taking argv[2] blindly would read a flag
   like `--no-open` as the port, and `listen(NaN)` throws before anything is
   served. */
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 8770);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** `./fleet.js` in the source has to resolve to `./fleet.ts` on disk. */
function rewriteSpecifiers(code) {
  return code.replace(/(from\s*["'])([^"']+)\.js(["'])/g, "$1$2.ts$3");
}

function transpile(source, fileName) {
  const out = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
  });
  return rewriteSpecifiers(out.outputText);
}

const server = createServer(async (req, res) => {
  /* Parsing is inside the try. `decodeURIComponent` throws URIError on a
     malformed escape — `/%zz` is enough — and an uncaught throw in this
     handler takes the whole process down, leaving a dead port and no clue
     why. */
  try {
    await serve(req, res);
  } catch (err) {
    if (!res.headersSent) res.writeHead(err instanceof URIError ? 400 : 500, { "content-type": "text/plain" });
    res.end(String(err));
  }
});

async function serve(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let path = decodeURIComponent(url.pathname);
  /* Redirect rather than serve in place: the page asks for "./app.ts", which
     resolves against the URL it was served at. Serving the index AT "/" makes
     that "/app.ts", and the module 404s with no exception — a dead page that
     looks complete. */
  if (path === "/" || path === BASE.slice(0, -1)) {
    res.writeHead(302, { location: BASE });
    res.end();
    return;
  }
  if (path === BASE) path = `${BASE}index.html`;

  /* `normalize` plus the prefix test keeps `..` in a request from reaching
     outside the directories the page needs. */
  const file = join(ROOT, normalize(path));
  const allowed = SERVABLE.some((dir) => file === dir || file.startsWith(dir + sep));
  if (!allowed || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not found: ${path}`);
    return;
  }

  const ext = extname(file);
  if (ext === ".ts") {
    const source = await readFile(file, "utf8");
    res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
    res.end(transpile(source, file));
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`port ${PORT} is busy — try: npm run browser -- ${PORT + 1}`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", () => {
  const at = `http://127.0.0.1:${PORT}/`;
  console.log(`simulation on ${at}   (ctrl-c to stop)`);
  if (!process.argv.includes("--no-open")) {
    const cmd = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start" : "xdg-open";
    spawn(cmd, [at], { stdio: "ignore", detached: true, shell: process.platform === "win32" })
      .on("error", () => console.log("  (open it yourself — could not launch a browser)"))
      .unref();
  }
});
