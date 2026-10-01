import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { loadWorkshop } from "../tools/lib/load.mjs";
import { CompileError } from "../tools/lib/kai.mjs";
import { compileTheme, GENERATED_THEME_KEYS } from "../tools/lib/theme.mjs";
import { serialize, compileRootFiles } from "../tools/compile-kai.mjs";
import { buildStepPrompt, buildTipPrompt } from "../tools/lib/prompt.mjs";

const root = new URL("../", import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const base = () => readJson(join(root, "kai/theme.base.json"));
const lines = () => parse(readFileSync(join(root, "kai/lines.yaml"), "utf8"));
const theme = () => compileTheme(loadWorkshop(root), lines(), base());

test("the generated keys are welcome, loadout, prompts and stages, and every other key is the base copied unchanged", () => {
  assert.deepEqual(GENERATED_THEME_KEYS, ["welcome", "loadout", "prompts", "stages"]);
  const b = base();
  const t = theme();
  assert.deepEqual(Object.keys(t), Object.keys(b), "the same keys in the same order");
  for (const k of Object.keys(b)) if (!GENERATED_THEME_KEYS.includes(k)) assert.deepEqual(t[k], b[k], k);
});

test("welcome: the mentor and the buttons come from the base, a page is our text with a short line", () => {
  const { workshop } = loadWorkshop(root);
  const t = theme();
  const b = base();
  assert.deepEqual(Object.keys(t.welcome), ["mentor", "pages", "next", "back", "start"]);
  for (const k of ["mentor", "next", "back", "start"]) assert.equal(t.welcome[k], b.welcome[k], k);
  assert.equal(t.welcome.pages.length, workshop.welcome.pages.length);
  t.welcome.pages.forEach((p, i) => {
    assert.deepEqual(Object.keys(p), ["line", "md"]);
    assert.equal(p.md, workshop.welcome.pages[i]);
    assert.equal(p.line, lines().welcome[i]);
  });
  assert.equal(t.welcome.pages[0].line, "Hi {name}! Welcome aboard.");
  assert.equal(t.welcome.pages[4].line, "Thanks to our patron!");
});

test("loadout: the labels come from the base and the questions from our loadout", () => {
  const { workshop } = loadWorkshop(root);
  const t = theme();
  const b = base();
  assert.deepEqual(Object.keys(t.loadout), ["title", "progress", "next", "back", "done", "questions", "notices"]);
  for (const k of ["title", "progress", "next", "back", "done"]) assert.equal(t.loadout[k], b.loadout[k], k);
  const q = t.loadout.questions;
  assert.deepEqual(Object.keys(q), ["os", "virtualization", "arch", "runtime"], "keyed by fact, in loadout order");
  const ours = Object.fromEntries(workshop.loadout.questions.map((x) => [x.fact, x]));

  assert.deepEqual(q.os, { title: "What is your computer running?", options: { linux: {}, macos: {}, windows: {} } });
  assert.deepEqual(q.virtualization, {
    title: "How will you run the VMs?",
    options: {
      "kairos-lab": { badge: "recommended", md: ours.virtualization.options[0].text },
      own: { md: ours.virtualization.options[1].text },
    },
  });
  assert.match(q.virtualization.options.own.md, /^You bring your own virtualization software\./);
  assert.deepEqual(q.arch, {
    title: "Which CPU architecture?",
    options: { amd64: {}, arm64: {} },
    help: { label: "Not sure?", md: b.loadout.questions.arch.help.md, code: "uname -m", after: "x86_64 means amd64. arm64 or aarch64 means arm64." },
  });
  assert.equal(q.arch.help.md, "Run this in a terminal:");
  assert.deepEqual(q.runtime, {
    title: "Which container runtime?",
    md: "It is your choice, but Docker is the more battle-tested one for this workshop.",
    options: { docker: {}, podman: {} },
    when: [{ only: { virtualization: ["kairos-lab"] }, md: ours.runtime.notes[0].text }],
  });
  assert.deepEqual(Object.keys(q.runtime), ["title", "md", "options", "when"]);
});

test("loadout: an option that ends the flow has its text in the notices and not in the options", () => {
  const t = theme();
  assert.deepEqual(t.loadout.questions.os.options.windows, {});
  assert.deepEqual(t.loadout.notices, {
    windows: {
      title: "Windows: you play Master",
      line: "Not game over! You play MASTER.",
      md: "This is not game over. Zen is not available on Windows, so you play Master.",
    },
  });
});

test("loadout: every option of a question is listed, and a note without a condition has no only", () => {
  const loaded = loadWorkshop(root);
  const w = structuredClone(loaded.workshop);
  w.loadout.questions[3].notes.push({ text: "Always shown." });
  const t = compileTheme({ ...loaded, workshop: w }, lines(), base());
  assert.deepEqual(t.loadout.questions.runtime.when[1], { md: "Always shown." });
  for (const q of w.loadout.questions) assert.deepEqual(Object.keys(t.loadout.questions[q.fact].options), q.options.map((o) => o.value));
});

test("loadout: a missing arch help intro in the base is an error", () => {
  const b = base();
  delete b.loadout.questions.arch.help.md;
  assert.throws(() => compileTheme(loadWorkshop(root), lines(), b), (e) => e instanceof CompileError && /loadout\.questions\.arch\.help\.md/.test(e.message));
});

test("prompts: our templates become lists of lines with the reader's placeholder names", () => {
  const { workshop } = loadWorkshop(root);
  const t = theme();
  const b = base();
  assert.deepEqual(Object.keys(t.prompts), ["virtPlaceholder", "logsPlaceholder", "unsetPlaceholder", "noCommands", "warning", "fail", "tip"]);
  for (const k of ["virtPlaceholder", "logsPlaceholder", "unsetPlaceholder", "noCommands", "warning"]) assert.equal(t.prompts[k], b.prompts[k], k);
  assert.deepEqual(t.prompts.fail, [
    "I'm following the Kairos workshop, stage \"{stage}\", step \"{step}\".",
    "My setup: {os}, {arch}, container runtime {runtime}, VMs with {virtualization}.",
    "Goal of this step: {goal}.",
    "Tool: {tool} ({source}). Docs: {docs}.",
    "What I ran:",
    "{commands}",
    "What I expected: {expected}",
    "What happened: {logs}",
    "Give me short numbered steps for my setup. If something is unclear, say what you need from me. Prefer the docs above over guesses.",
  ]);
  assert.deepEqual(t.prompts.tip, [
    "I'm following the Kairos workshop, stage \"{stage}\".",
    "My setup: {os}, {arch}, container runtime {runtime}, VMs with {virtualization}.",
    "{ask}",
    "Give me short numbered steps for my setup. If something is unclear, say what you need from me.",
  ]);
  assert.equal(t.prompts.fail.join("\n"), workshop.prompts.step.trimEnd().replace("{expect}", "{expected}").replace("[paste your logs or the error here]", "{logs}"));
  for (const l of [...t.prompts.fail, ...t.prompts.tip]) assert.ok(!/\{(expect|request)\}|\[paste your logs/.test(l), l);
});

test("prompts: a step template that cannot take the logs is an error", () => {
  const loaded = loadWorkshop(root);
  const w = structuredClone(loaded.workshop);
  w.prompts.step = "Stage {stage}. What happened?";
  assert.throws(() => compileTheme({ ...loaded, workshop: w }, lines(), base()), /prompts\.step.*\[paste your logs or the error here\]/);
});

test("stages: the base list filtered to the stages of the workshop, in the order of workshop.yaml", () => {
  const { stages } = loadWorkshop(root);
  const t = theme();
  const b = base();
  assert.deepEqual(t.stages.map((s) => s.id), stages.map((s) => s.id));
  assert.ok(b.stages.some((s) => s.id === "fleet") && b.stages.some((s) => s.id === "edgevpn"), "the base has stages that the workshop does not");
  assert.ok(!t.stages.some((s) => ["fleet", "edgevpn"].includes(s.id)));
  for (const s of t.stages) assert.deepEqual(s, b.stages.find((x) => x.id === s.id));
  // The order is the order of the workshop, not the order of the base.
  const loaded = loadWorkshop(root);
  const reversed = { ...loaded, stages: [...loaded.stages].reverse() };
  assert.deepEqual(compileTheme(reversed, lines(), b).stages.map((s) => s.id), [...stages.map((s) => s.id)].reverse());
});

test("a missing welcome line section or notice is an error that names kai/lines.yaml", () => {
  const loaded = loadWorkshop(root);
  const l = lines();
  const { welcome: _w, ...noWelcome } = l;
  const { notices: _n, ...noNotices } = l;
  assert.throws(() => compileTheme(loaded, noWelcome, base()), /kai\/lines\.yaml needs welcome/);
  assert.throws(() => compileTheme(loaded, noNotices, base()), /kai\/lines\.yaml needs a notice for the option "windows"/);
  assert.throws(() => compileTheme(loaded, { ...l, welcome: l.welcome.slice(1) }, base()), /one line for each of the 5 welcome pages/);
  assert.throws(() => compileTheme(loaded, { ...l, notices: { ...l.notices, linux: { title: "T", line: "L" } } }, base()), /matches no option that has ends: true/);
});

test("the output is deterministic: two runs give the same text, two-space indent, trailing newline", () => {
  const a = serialize(theme());
  assert.equal(serialize(theme()), a);
  assert.ok(a.endsWith("}\n") && !a.endsWith("\n\n"));
  assert.ok(a.startsWith('{\n  "game": {'));
});

test("golden: the generated part of the theme for the real workshop", () => {
  const t = theme();
  const generated = Object.fromEntries(GENERATED_THEME_KEYS.map((k) => [k, t[k]]));
  assert.equal(serialize(generated), readFileSync(join(root, "conformance/v0/kai/theme-generated.json"), "utf8"));
});

test("the committed kai/web/theme.json and content.json equal the compiler output", () => {
  const files = compileRootFiles(root);
  assert.equal(readFileSync(join(root, "kai/web/theme.json"), "utf8"), files.theme);
  assert.equal(readFileSync(join(root, "kai/web/content.json"), "utf8"), files.content);
});

test("the designer's base file is not a source for any generated key", () => {
  // Change every generated value in the base. The output must not change.
  const b = base();
  b.welcome.pages = [{ line: "X", md: "X" }];
  b.loadout.questions = { os: { title: "X", options: {} } };
  b.loadout.notices = { windows: { title: "X", line: "X", md: "X" } };
  b.prompts.fail = ["X"];
  b.prompts.tip = ["X"];
  b.stages = [{ id: "kairos-lab", location: "KAIROS-LAB", nodes: 0, items: ["kairos-lab"] }];
  b.loadout.questions.arch = { help: { md: base().loadout.questions.arch.help.md } };
  assert.deepEqual(compileTheme(loadWorkshop(root), lines(), b).loadout, theme().loadout);
  assert.deepEqual(compileTheme(loadWorkshop(root), lines(), b).welcome, theme().welcome);
  assert.deepEqual(compileTheme(loadWorkshop(root), lines(), b).prompts, theme().prompts);
});

test("the prompt lists are our templates and the reader's wording differs only by the renamed placeholders", () => {
  // Our template and the generated list say the same thing. Filling both by hand with the same values gives
  // the same text, except for the two renamed placeholders, which carry the same values.
  const loaded = loadWorkshop(root);
  const stage = parse(readFileSync(join(root, "stages/kairos-lab.yaml"), "utf8"));
  const facts = { os: "linux", arch: "amd64", runtime: "docker", virtualization: "kairos-lab" };
  const ours = buildTipPrompt(loaded.workshop, stage, facts);
  const t = theme();
  const vars = { stage: stage.title, os: "Linux", arch: "amd64", runtime: "Docker", virtualization: "kairos-lab", ask: "Explain how to install Docker on Linux (amd64) and how to check that it works." };
  const filled = t.prompts.tip.map((l) => l.replace(/\{(\w+)\}/g, (_, k) => vars[k])).join("\n");
  assert.equal(filled, ours);
  assert.ok(buildStepPrompt(loaded.workshop, stage, "kairos-lab-setup", facts));
});

test("the tool writes both files, and --check names the stale one", () => {
  const out = mkdtempSync(join(tmpdir(), "ws-kai-theme-"));
  const run = (...a) => spawnSync(process.execPath, [join(root, "tools/compile-kai.mjs"), ...a], { encoding: "utf8" });
  assert.equal(run("--out", out).status, 0);
  assert.equal(readFileSync(join(out, "theme.json"), "utf8"), readFileSync(join(root, "kai/web/theme.json"), "utf8"));
  assert.equal(readFileSync(join(out, "content.json"), "utf8"), readFileSync(join(root, "kai/web/content.json"), "utf8"));
  assert.equal(run("--check", "--out", out).status, 0);
  rmSync(join(out, "theme.json"));
  const missing = run("--check", "--out", out);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /theme\.json is generated/);
  assert.doesNotMatch(missing.stderr, /content\.json is generated/);
});

// ---- the keys that round 4 added to the designer's base ----

test("round 4: checkKinds, modes, sheet and the new labels are the base copied unchanged, and checkKinds names every check kind we emit", () => {
  const b = base();
  const t = theme();
  for (const k of ["checkKinds", "modes", "sheet"]) {
    assert.ok(b[k], `the base has ${k}`);
    assert.deepEqual(t[k], b[k], k);
  }
  for (const k of ["tool", "docs", "step_only", "text_bigger", "text_smaller", "theme_light", "theme_dark", "stages_nav"]) assert.equal(t.labels[k], b.labels[k], `labels.${k}`);
  const content = JSON.parse(readFileSync(join(root, "kai/web/content.json"), "utf8"));
  const kinds = new Set(content.stages.flatMap((s) => s.steps.map((st) => st.check.kind)));
  assert.ok(kinds.has("manual") && kinds.size >= 3, [...kinds].join(", "));
  for (const kind of kinds) assert.equal(typeof t.checkKinds[kind], "string", `theme.checkKinds.${kind}: the reader names the kind in the check row`);
  // The four generated keys are never taken from the new base keys.
  assert.deepEqual(GENERATED_THEME_KEYS, ["welcome", "loadout", "prompts", "stages"]);
});
