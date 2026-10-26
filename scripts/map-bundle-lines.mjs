#!/usr/bin/env node
// Maintainer tool (not shipped in the npm package): maps `flowly-bundle.js:<line>` frames of a
// `$exception` event back to source files (docs/TELEMETRY-SPEC.md §8).
//
//   node scripts/map-bundle-lines.mjs --flowly 1.6.0 --paseo 0.13.0 104683 102566:12 flowly-bundle.js:99
//
// Rebuilds the plugin's server bundle the way Paseo 0.13 does (`compileTarget` in
// @getpaseo/server/dist/server/server/plugins/compiler.js, then `wrapCommonJsBundle`), with the
// esbuild version Paseo ships, and looks every line up in a source map of that same build.
// Options: --ref <git ref> (default v<flowly>), --dir <folder> (use a checkout, e.g. `.`, instead
// of a git ref), --grep <text> (list bundle lines containing text), --esbuild <version> (default: Paseo's dependency range), --work <folder>.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    flowly: { type: "string" },
    paseo: { type: "string" },
    ref: { type: "string" },
    dir: { type: "string" },
    esbuild: { type: "string" },
    work: { type: "string" },
    grep: { type: "string" },
  },
});
if (!opts.paseo || (!opts.flowly && !opts.dir && !opts.ref) || positionals.length === 0 && !opts.grep) {
  console.error("usage: map-bundle-lines.mjs --flowly <version> --paseo <version> <line[:col] | flowly-bundle.js:line[:col]>...");
  process.exit(2);
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const label = `${opts.flowly ?? opts.ref ?? "dir"}-${opts.paseo}`;
const work = path.resolve(opts.work ?? path.join(tmpdir(), "flowly-bundle-map", label));
mkdirSync(work, { recursive: true });

// Source tree: a checkout, or `git archive` of the release tag, with its locked dependencies.
let tree = opts.dir ? path.resolve(opts.dir) : path.join(work, "src");
if (!opts.dir && !existsSync(path.join(tree, "node_modules"))) {
  const ref = opts.ref ?? `v${opts.flowly}`;
  mkdirSync(tree, { recursive: true });
  const repo = run("git", ["rev-parse", "--show-toplevel"], process.cwd());
  execFileSync("sh", ["-c", `git -C "$1" archive "$2" | tar -x -C "$3"`, "sh", repo, ref, tree], { stdio: "inherit" });
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], tree);
}
const entry = ["index.server.ts", "index.server.tsx"].map((f) => path.join(tree, f)).find(existsSync);
if (!entry) throw new Error(`No index.server.ts in ${tree}`);

// esbuild: the version Paseo depends on (its range, unless --esbuild pins one).
const esbuildDir = path.join(work, "esbuild");
if (!existsSync(path.join(esbuildDir, "node_modules", "esbuild"))) {
  mkdirSync(esbuildDir, { recursive: true });
  const range = opts.esbuild ?? JSON.parse(run("npm", ["view", `@getpaseo/server@${opts.paseo}`, "dependencies.esbuild", "--json"]));
  writeFileSync(path.join(esbuildDir, "package.json"), "{}");
  run("npm", ["install", `esbuild@${range}`, "--no-audit", "--no-fund"], esbuildDir);
}
const esbuildPkg = path.join(esbuildDir, "node_modules", "esbuild");
const { build } = createRequire(path.join(esbuildDir, "x.js"))("esbuild");
const esbuildVersion = JSON.parse(readFileSync(path.join(esbuildPkg, "package.json"), "utf8")).version;

// plugin-sdk-specifiers.js + SERVER_HOST_MODULES of Paseo 0.13.
const EXTERNAL = [
  "@getpaseo/plugin",
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/usage",
  "@getpaseo/plugin/server/acp",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/client/react-native",
  "zod",
];
const options = {
  entryPoints: [realpathSync.native(entry)],
  absWorkingDir: realpathSync.native(tree),
  bundle: true,
  format: "cjs",
  jsx: "automatic",
  loader: { ".svg": "text" },
  platform: "node",
  target: "node20",
  external: EXTERNAL,
  metafile: true,
  logLevel: "silent",
  treeShaking: true,
  write: false,
};
// wrapCommonJsBundle: three lines come before the bundle.
const WRAP_LINES = 3;
const wrap = (code) => `(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n${code}\nreturn module.exports;\n})`;
// makeHermesInteropEager rewrites inside a line; it never changes line numbers.
const eager = (code) => code.replaceAll("get: () => from[key]", "value: from[key]");

const plain = await build(options);
const mapped = await build({ ...options, sourcemap: "external", outfile: path.join(realpathSync.native(tree), "flowly-bundle.js") });
const js = plain.outputFiles[0].text;
const mappedJs = mapped.outputFiles.find((f) => f.path.endsWith(".js")).text;
if (js !== mappedJs) throw new Error("The source map build differs from the plain build; line numbers cannot be trusted.");
const map = JSON.parse(mapped.outputFiles.find((f) => f.path.endsWith(".map")).text);
const bundle = wrap(eager(js)).split("\n");

// Source map decoding (VLQ): segments per generated line.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decode(mappings) {
  let source = 0, srcLine = 0, srcCol = 0;
  return mappings.split(";").map((line) => {
    let col = 0;
    return line === "" ? [] : line.split(",").map((seg) => {
      const nums = [];
      let value = 0, shift = 0;
      for (const ch of seg) {
        const digit = B64.indexOf(ch);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          nums.push(value & 1 ? -(value >> 1) : value >> 1);
          value = shift = 0;
        }
      }
      col += nums[0];
      if (nums.length > 1) {
        source += nums[1];
        srcLine += nums[2];
        srcCol += nums[3];
      }
      return { col, source: nums.length > 1 ? source : -1, line: srcLine, srcCol };
    });
  });
}
const lines = decode(map.mappings);
const treeReal = realpathSync.native(tree);
const moduleStart = /^\/\/ \S+\.[cm]?[jt]sx?$/;
function lookup(line, col) {
  // A line without mappings (a blank line, a comment): use the closest mapped line above it.
  let at = line;
  while (at > WRAP_LINES + 1 && !lines[at - 1 - WRAP_LINES]?.length && !moduleStart.test(bundle[at - 1])) at--;
  const segs = lines[at - 1 - WRAP_LINES];
  if (!segs?.length) return null;
  // The last segment starting at or before the column; without a column, the first of the line.
  let seg = segs[0];
  if (col !== undefined && at === line) for (const s of segs) if (s.col <= col - 1) seg = s;
  if (seg.source < 0) return null;
  // map.sources are relative to the output location (the tree); show them relative to the tree.
  const file = path.relative(treeReal, path.resolve(treeReal, map.sources[seg.source])).split(path.sep).join("/");
  const text = readSource(file, seg.line);
  return { file, line: seg.line + 1, col: seg.srcCol + 1, text, approx: at !== line };
}
function readSource(file, zeroBasedLine) {
  try {
    return readFileSync(path.join(treeReal, file), "utf8").split("\n")[zeroBasedLine]?.trim() ?? "";
  } catch {
    return "";
  }
}
// The `// server/xxx.ts` comment esbuild puts above every module, as a cross-check.
function moduleComment(line) {
  for (let i = Math.min(line, bundle.length) - 1; i >= 0; i--) {
    const m = moduleStart.exec(bundle[i]);
    if (m) return bundle[i].slice(3);
  }
  return "";
}

console.log(`bundle: ${bundle.length} lines, esbuild ${esbuildVersion}, ${opts.dir ? tree : `${opts.ref ?? `v${opts.flowly}`} (${tree})`}`);
if (opts.grep) bundle.forEach((text, i) => text.includes(opts.grep) && console.log(`${i + 1}\t${text.trim().slice(0, 100)}`));
let failed = false;
for (const arg of positionals) {
  const m = /^(?:flowly-bundle\.js)?:?(\d+)(?::(\d+))?$/.exec(arg);
  if (!m) {
    console.log(`${arg}\tnot a line reference`);
    failed = true;
    continue;
  }
  const line = Number(m[1]);
  const col = m[2] ? Number(m[2]) : undefined;
  if (line < 1 || line > bundle.length) {
    console.log(`${arg}\tout of range (bundle has ${bundle.length} lines): wrong Flowly or Paseo version?`);
    failed = true;
    continue;
  }
  const found = lookup(line, col);
  const comment = moduleComment(line);
  console.log(found ? `${arg}\t${found.approx ? "~" : ""}${found.file}:${found.line}:${found.col}\t${found.text}` : `${arg}\t(no source position)\tmodule ${comment || "?"}`);
  if (found && comment && comment !== found.file) console.log(`\t(module comment says ${comment})`);
}
process.exit(failed ? 1 : 0);
