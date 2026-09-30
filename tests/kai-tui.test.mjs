import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { view } from "../tools/lib/view.mjs";
import { FACTS } from "../tools/lib/facts.mjs";
import { E } from "./helpers/kai-engine.mjs";

// The designer's terminal app, built from kai/tui with the Go standard library only. The test is
// skipped when there is no Go toolchain. Set GO to name one, for example
// GO="$(GOENV_VERSION=1.26.8 goenv which go)". GOROOT is cleared so a stale value
// from another toolchain cannot break the build.
const root = new URL("../", import.meta.url).pathname;
// A version manager shim can try to write into its own install directory, so prefer the real binary.
function findGo() {
  const named = process.env.GO || "go";
  const r = spawnSync(named, ["env", "GOROOT"], { encoding: "utf8", env: { ...process.env, GOROOT: undefined } });
  const real = r.status === 0 ? join(r.stdout.trim(), "bin", "go") : "";
  return real && existsSync(real) ? real : named;
}
const go = findGo();
const env = (cache) => {
  const e = { ...process.env, GOCACHE: join(cache, "gocache"), GOMODCACHE: join(cache, "gomod"), GOPATH: join(cache, "gopath"), GOFLAGS: "-mod=mod" };
  delete e.GOROOT;
  return e;
};
const probe = spawnSync(go, ["version"], { encoding: "utf8", env: { ...process.env, GOROOT: undefined } });
const haveGo = probe.status === 0;

const stageDoc = parse(readFileSync(join(root, "stages/kairos-lab.yaml"), "utf8"));
const cache = haveGo ? mkdtempSync(join(tmpdir(), "ws-kai-go-")) : "";
const bin = join(cache, "kai");

test("the terminal app builds", { skip: !haveGo && "no go toolchain" }, () => {
  const r = spawnSync(go, ["build", "-o", bin, "."], { cwd: join(root, "kai/tui"), encoding: "utf8", env: env(cache) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

const FACT_SETS = [
  { os: "macos", virtualization: "kairos-lab", runtime: "docker" },
  { os: "linux", virtualization: "kairos-lab", runtime: "podman" },
  { os: "linux", virtualization: "own", runtime: "docker" },
  { os: "macos", virtualization: "own", runtime: "podman" },
  { os: "windows", virtualization: "own", runtime: "docker" },
];

// Every step of stage 1 that the game shows for these facts, as one text. The facts flag takes a
// comma separated list. A wide and tall screen keeps long commands and steps from being cut. The result is the
// trimmed text of the step column, one entry per screen row.
function render(facts) {
  const engineFacts = Object.fromEntries(FACTS.map((f) => [f, facts[f] ?? "unsure"]));
  const n = E.steps("kairos-lab", engineFacts).length;
  const flag = Object.entries(facts).map(([k, v]) => `${k}=${v}`).join(",");
  const rows = [];
  for (let step = 0; step < n; step++) {
    const r = spawnSync(bin, ["render", "--assets", join(root, "kai/web"), "--screen", "stage", "--stage", "kairos-lab", "--step", String(step), "--facts", flag, "--color", "none", "--size", "220x90"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    // Only the right hand column holds the step. Its left edge is where the "Step N of M" header starts.
    const lines = r.stdout.split("\n");
    const header = lines.find((l) => /Step \d+ of \d+/.test(l));
    assert.ok(header, `no step header for step ${step}`);
    const col = header.indexOf("Step ");
    rows.push(...lines.map((l) => l.slice(col).trim()));
  }
  return rows;
}

const linesOf = (commands) => commands.flatMap((c) => c.split("\n")).map((l) => l.trim()).filter(Boolean);
const allLines = new Set(linesOf(view(stageDoc, {}).filter((i) => i.kind === "command").map((i) => i.text)));

FACT_SETS.forEach((facts, i) => {
  test(`the terminal shows the commands for ${Object.values(facts).join(" / ")} and no others`, { skip: !haveGo && "no go toolchain" }, () => {
    const rows = render(facts);
    const visible = new Set(linesOf(view(stageDoc, facts).filter((x) => x.kind === "command").map((x) => x.text)));
    const shown = (line) => rows.includes(line);
    assert.ok(visible.size >= 2, "the fact set has commands");
    for (const line of visible) assert.ok(shown(line), `missing for ${JSON.stringify(facts)}: ${line}`);
    for (const line of allLines) if (!visible.has(line)) assert.ok(!shown(line), `should be hidden for ${JSON.stringify(facts)}: ${line}`);
  });
});

test("the terminal tells a Windows reader with kairos-lab that no install option matches", { skip: !haveGo && "no go toolchain" }, () => {
  const facts = { os: "windows", virtualization: "kairos-lab", runtime: "docker" };
  const flag = Object.entries(facts).map(([k, v]) => `${k}=${v}`).join(",");
  const r = spawnSync(bin, ["render", "--assets", join(root, "kai/web"), "--screen", "stage", "--stage", "kairos-lab", "--step", "1", "--facts", flag, "--color", "none", "--size", "220x90"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /only works on Linux and macOS/);
  assert.match(r.stdout, /None of the options here match your setup/);
});
