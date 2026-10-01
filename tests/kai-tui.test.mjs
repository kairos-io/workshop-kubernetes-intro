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
// from another folder, for example a newer copy of the file. The tests are
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

// The terminal starts each command with a "$ " prompt, and indents the continuation lines of a command that ends
// with a backslash. Our data has neither: the prompt is the reader's, and `code` holds the bare command.
const promptOf = (command) => {
  const out = [];
  let continued = false;
  for (const l of command.split("\n")) {
    if (l.trim() === "") continue;
    out.push({ line: l.trim(), prompt: !continued });
    continued = l.trimEnd().endsWith("\\");
  }
  return out;
};

FACT_SETS.forEach((facts, i) => {
  test(`the terminal shows the commands for ${Object.values(facts).join(" / ")} and no others`, { skip: !haveGo && "no go toolchain" }, () => {
    const rows = render(facts);
    const commands = view(stageDoc, facts).filter((x) => x.kind === "command").map((x) => x.text);
    const visible = new Set(linesOf(commands));
    // Hidden means that the line is not there with the prompt and not there as a continuation either.
    const shown = (line) => rows.includes(`$ ${line}`) || rows.includes(line);
    assert.ok(visible.size >= 2, "the fact set has commands");
    for (const line of visible) assert.ok(shown(line), `missing for ${JSON.stringify(facts)}: ${line}`);
    // Every command starts with the prompt, and a continuation line does not.
    for (const c of commands) {
      assert.ok(!c.startsWith("$ "), "the data holds no prompt");
      for (const { line, prompt } of promptOf(c)) assert.ok(prompt ? rows.includes(`$ ${line}`) : rows.includes(line) && !rows.includes(`$ ${line}`), `${prompt ? "prompt" : "continuation"}: ${line}`);
    }
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

// ---- the screens that read the generated theme.json: loadout, welcome, mentor, stage with the loadout facts ----
const web = join(root, "kai/web");
const screen = (...args) => {
  const r = spawnSync(bin, ["render", "--assets", web, "--color", "none", "--size", "220x70", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  // One entry per screen row, with the padding removed and the lines of wrapped text joined by a space.
  return r.stdout.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join(" ");
};
const shows = (name, fn) => test(`terminal: ${name}`, { skip: !haveGo && "no go toolchain" }, fn);

const zenText = "kairos-lab creates and boots the VMs and sets up their network for you, so you can focus on Kairos.";

shows("the loadout asks the virtualization question with the Zen and Master descriptions for Linux", () => {
  const out = screen("--screen", "loadout", "--lq", "1", "--facts", "os=linux");
  assert.match(out, /Question 2 of 4/);
  assert.match(out, /How will you run the VMs\?/);
  assert.match(out, /Zen \[recommended\]/);
  assert.ok(out.includes(zenText), "the Zen description");
  assert.match(out, /Master/);
  assert.match(out, /You bring your own virtualization software\. You must know how to create a VM/);
});

shows("the loadout shows the Windows notice and ends after it", () => {
  const out = screen("--screen", "loadout", "--lq", "1", "--facts", "os=windows,virtualization=own");
  assert.match(out, /Question 2 of 2/);
  assert.match(out, /Windows: you play Master/);
  assert.match(out, /This is not game over\. Zen is not available on Windows, so you play Master\./);
  assert.doesNotMatch(out, /How will you run the VMs/);
});

shows("the last loadout question carries its note for Zen, and the architecture question its help", () => {
  const runtime = screen("--screen", "loadout", "--lq", "3", "--facts", "os=linux,virtualization=kairos-lab,arch=amd64,runtime=docker");
  assert.match(runtime, /Which container runtime\?/);
  assert.match(runtime, /It is your choice, but Docker is the more battle-tested one for this workshop\./);
  assert.match(runtime, /If you already have a runtime, kairos-lab setup uses it\./);
  const master = screen("--screen", "loadout", "--lq", "3", "--facts", "os=linux,virtualization=own,arch=amd64,runtime=docker");
  assert.doesNotMatch(master, /If you already have a runtime/);
});

shows("the welcome page shows our text, with the link to the patron", () => {
  const first = screen("--screen", "welcome", "--welcome-page", "0", "--name", "Ana");
  assert.match(first, /Hi Ana! I'm Mauro, one of the maintainers of Kairos/);
  const last = screen("--screen", "welcome", "--welcome-page", "4", "--name", "Ana");
  assert.match(last, /This workshop is brought to you by our generous patron, Spectro Cloud/);
  assert.match(last, /https:\/\/www\.spectrocloud\.com\/solutions\/kairos-support/);
});

shows("the mentor screen says what we learn, from the goal of the stage", () => {
  const out = screen("--screen", "mentor", "--stage", "kairos-lab", "--name", "Ana");
  assert.match(out, /will teach us today how to set up kairos-lab\./);
});

shows("the stage screen shows a command for the chosen facts and the loadout line", () => {
  const out = screen("--screen", "stage", "--stage", "kairos-lab", "--step", "0", "--facts", "os=linux,virtualization=kairos-lab,arch=amd64,runtime=docker");
  assert.match(out, /Linux · Zen · amd64 · Docker/);
  assert.ok(out.includes("curl -sSL https://raw.githubusercontent.com/kairos-io/kairos-lab/main/install.sh | sh"), "the install script for Linux");
  assert.doesNotMatch(out, /brew install kairos-lab/);
});

shows("the route screen says why Zen cannot skip the first stage", () => {
  const out = screen("--screen", "map", "--name", "Ana", "--facts", "os=linux,virtualization=kairos-lab");
  assert.match(out, /can't skip: You play Zen, so every later stage uses kairos-lab\. Set it up first\./);
  const master = screen("--screen", "map", "--name", "Ana", "--facts", "os=linux,virtualization=own");
  assert.doesNotMatch(master, /can't skip/);
});

shows("the help prompt of a failed step is built from our template", () => {
  const out = screen("--screen", "stage", "--stage", "kairos-lab", "--step", "1", "--status", "failed", "--facts", "os=linux,virtualization=own,arch=amd64,runtime=docker");
  assert.match(out, /Remove tokens, passwords and private addresses before/);
  assert.match(out, /I'm following the Kairos workshop, stage "Setting up kairos-lab"/);
  assert.match(out, /My setup: Linux, amd64, container runtime Docker, VMs with \[NAME OF YOUR VIRTUALIZATION SOFTWARE, e\.g\. VirtualBox\]\./);
});

// ---- the round 4 terminal: step help, check kind, only label, stage links, prompt from the step help ----

const content = JSON.parse(readFileSync(join(web, "content.json"), "utf8"));
const theme = JSON.parse(readFileSync(join(web, "theme.json"), "utf8"));
const lab = "os=linux,virtualization=kairos-lab,arch=amd64,runtime=docker";
const stage1 = content.stages.find((s) => s.id === "kairos-lab");

const ownFacts = { os: "linux", virtualization: "own", arch: "amd64", runtime: "docker" };
const ownFlag = Object.entries(ownFacts).map(([k, v]) => `${k}=${v}`).join(",");
const ownShown = E.steps("kairos-lab", ownFacts);

shows("the stage screen writes the tool, source and docs of the step help, and the name of the check kind", () => {
  const first = stage1.steps[0];
  const out = screen("--screen", "stage", "--stage", "kairos-lab", "--step", "0", "--facts", lab);
  assert.ok(out.includes(`Tool: ${first.help.tool} <${first.help.source}> Docs: <${first.help.docs}>`), "tool line of the first step");
  assert.ok(out.includes(`Check (${theme.checkKinds[first.check.kind]}): ${first.check.prompt.slice(0, 30)}`), "check kind and sentence");
  // A step that names its own tool shows that tool, not the one of the stage.
  const own = ownShown.find((s) => s.help && s.help.tool !== stage1.tool.name);
  assert.ok(own, "stage 1 has a step with its own tool");
  const ownOut = screen("--screen", "stage", "--stage", "kairos-lab", "--step", String(ownShown.indexOf(own)), "--facts", ownFlag);
  assert.ok(ownOut.includes(`Tool: ${own.help.tool} <${own.help.source}>`), own.id);
});

shows("a link to another stage reads (stage N)", () => {
  const at = ownShown.findIndex((s) => /stage:[a-z0-9-]+/.test(JSON.stringify(s)));
  assert.ok(at >= 0, "a shown step links to another stage by its id");
  const target = JSON.stringify(ownShown[at]).match(/stage:([a-z0-9-]+)/)[1];
  const out = screen("--screen", "stage", "--stage", "kairos-lab", "--step", String(at), "--facts", ownFlag);
  assert.match(out, new RegExp(`\\(stage ${content.stages.findIndex((s) => s.id === target) + 1}\\)`));
  assert.doesNotMatch(out, /<stage:/);
});

shows("the help prompt of a failed step names the tool of the step and its goal", () => {
  const own = ownShown.find((s) => s.help && s.help.tool !== stage1.tool.name);
  const out = screen("--screen", "stage", "--stage", "kairos-lab", "--step", String(ownShown.indexOf(own)), "--status", "failed", "--facts", ownFlag);
  assert.ok(out.includes(`Goal of this step: ${own.goal}.`));
  assert.ok(out.includes(`Tool: ${own.help.tool} (${own.help.source}).`));
});
