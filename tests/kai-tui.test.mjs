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

// The designer's terminal app, built from kai/tui with the Go standard library only. Set KAI_TUI_SRC to build
// from another folder, for example a fixed copy of the round 3 file. The test is
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
  const r = spawnSync(go, ["build", "-o", bin, "."], { cwd: process.env.KAI_TUI_SRC ?? join(root, "kai/tui"), encoding: "utf8", env: env(cache) });
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
  const r = spawnSync(bin, ["render", "--assets", join(root, "kai/web"), "--screen", "stage", "--stage", "kairos-lab", "--step", "0", "--facts", flag, "--color", "none", "--size", "220x90"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /only works on Linux and macOS/);
  assert.match(r.stdout, /None of the options here match your setup/);
});

// ---- the round 3 screens: loadout, welcome, mentor, stage with the loadout facts ----
//
// The round 3 terminal app has the `-welcome-page` flag and the `welcome` and `loadout` screens that read the
// generated theme.json. The vendored kai/tui/main.go is still round 2 (the round 3 file does not compile,
// see kai/README.md), so these tests say so and skip until the file is replaced.
const web = join(root, "kai/web");
const isRound3 = () => {
  const help = spawnSync(bin, ["render", "-h"], { encoding: "utf8" });
  return /welcome-page/.test(help.stdout + help.stderr);
};
const screen = (...args) => {
  const r = spawnSync(bin, ["render", "--assets", web, "--color", "none", "--size", "220x70", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // One entry per screen row, with the padding removed and the lines of wrapped text joined by a space.
  return r.stdout.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join(" ");
};
const round3 = (name, fn) =>
  test(`round 3 terminal: ${name}`, { skip: !haveGo && "no go toolchain" }, (t) => {
    if (!isRound3()) return t.skip("kai/tui/main.go is still the round 2 file, so it has no round 3 screens");
    fn();
  });

const zenText = "kairos-lab creates and boots the VMs and sets up their network for you, so you can focus on Kairos.";

round3("the loadout asks the virtualization question with the Zen and Master descriptions for Linux", () => {
  const out = screen("--screen", "loadout", "--lq", "1", "--facts", "os=linux");
  assert.match(out, /Question 2 of 4/);
  assert.match(out, /How will you run the VMs\?/);
  assert.match(out, /Zen \[recommended\]/);
  assert.ok(out.includes(zenText), "the Zen description");
  assert.match(out, /Master/);
  assert.match(out, /You bring your own virtualization software\. You must know how to create a VM/);
});

round3("the loadout shows the Windows notice and ends after it", () => {
  const out = screen("--screen", "loadout", "--lq", "1", "--facts", "os=windows,virtualization=own");
  assert.match(out, /Question 2 of 2/);
  assert.match(out, /Windows: you play Master/);
  assert.match(out, /This is not game over\. Zen is not available on Windows, so you play Master\./);
  assert.doesNotMatch(out, /How will you run the VMs/);
});

round3("the last loadout question carries its note for Zen, and the architecture question its help", () => {
  const runtime = screen("--screen", "loadout", "--lq", "3", "--facts", "os=linux,virtualization=kairos-lab,arch=amd64,runtime=docker");
  assert.match(runtime, /Which container runtime\?/);
  assert.match(runtime, /It is your choice, but Docker is the more battle-tested one for this workshop\./);
  assert.match(runtime, /If you already have a runtime, kairos-lab setup uses it\./);
  const master = screen("--screen", "loadout", "--lq", "3", "--facts", "os=linux,virtualization=own,arch=amd64,runtime=docker");
  assert.doesNotMatch(master, /If you already have a runtime/);
});

round3("the welcome page shows our text, with the link to the patron", () => {
  const first = screen("--screen", "welcome", "--welcome-page", "0", "--name", "Ana");
  assert.match(first, /Hi Ana! I'm Mauro, one of the maintainers of Kairos/);
  const last = screen("--screen", "welcome", "--welcome-page", "4", "--name", "Ana");
  assert.match(last, /This workshop is brought to you by our generous patron, Spectro Cloud/);
  assert.match(last, /https:\/\/www\.spectrocloud\.com\/solutions\/kairos-support/);
});

round3("the mentor screen says what we learn, from the goal of the stage", () => {
  const out = screen("--screen", "mentor", "--stage", "kairos-lab", "--name", "Ana");
  assert.match(out, /will teach us today how to set up kairos-lab\./);
});

round3("the stage screen shows a command for the chosen facts and the loadout line", () => {
  const out = screen("--screen", "stage", "--stage", "kairos-lab", "--step", "0", "--facts", "os=linux,virtualization=kairos-lab,arch=amd64,runtime=docker");
  assert.match(out, /Linux · Zen · amd64 · Docker/);
  assert.ok(out.includes("curl -sSL https://raw.githubusercontent.com/kairos-io/kairos-lab/main/install.sh | sh"), "the install script for Linux");
  assert.doesNotMatch(out, /brew install kairos-lab/);
});

round3("the route screen says why Zen cannot skip the first stage", () => {
  const out = screen("--screen", "map", "--name", "Ana", "--facts", "os=linux,virtualization=kairos-lab");
  assert.match(out, /can't skip: You play Zen, so every later stage uses kairos-lab\. Set it up first\./);
  const master = screen("--screen", "map", "--name", "Ana", "--facts", "os=linux,virtualization=own");
  assert.doesNotMatch(master, /can't skip/);
});

round3("the help prompt of a failed step is built from our template", () => {
  const out = screen("--screen", "stage", "--stage", "kairos-lab", "--step", "1", "--status", "failed", "--facts", "os=linux,virtualization=own,arch=amd64,runtime=docker");
  assert.match(out, /Remove tokens, passwords and private addresses before/);
  assert.match(out, /I'm following the Kairos workshop, stage "Setting up kairos-lab"/);
  assert.match(out, /My setup: Linux, amd64, container runtime Docker, VMs with \[NAME OF YOUR VIRTUALIZATION SOFTWARE, e\.g\. VirtualBox\]\./);
});
