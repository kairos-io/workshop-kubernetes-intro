import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { normalizeStage, loadWorkshop } from "../tools/lib/load.mjs";
import { validateStageSchema } from "../tools/lib/schema.mjs";
import { checkStage, buildContext } from "../tools/validate.mjs";
import { checkPrompt } from "../tools/lib/labels.mjs";
import { FACT_DEFS } from "../tools/lib/facts.mjs";
import { compileStage, compileMarkdownStage, compileWorkshop, compileFacts, validateContent, CompileError, PROMPTS, MARKDOWN_STEP } from "../tools/lib/kai.mjs";
import { serialize } from "../tools/compile-kai.mjs";

const root = new URL("../", import.meta.url).pathname;
const dir = new URL("../conformance/v0/kai/", import.meta.url);
const readYaml = (url) => parse(readFileSync(url, "utf8"));
const stageOf = (yamlText) => normalizeStage(parse(yamlText));

// Golden outputs. Each synthetic stage `<name>.yaml` has `<name>.json` and, if it needs game lines, `<name>.lines.yaml`.
const cases = readdirSync(dir).filter((f) => f.endsWith(".yaml") && !f.endsWith(".lines.yaml")).map((f) => f.replace(/\.yaml$/, "")).sort();

test("there is a golden case for every rule group", () => {
  assert.deepEqual(cases, ["lines", "sections-text-only", "step-shapes", "variants", "when-merge"]);
});

for (const name of cases) {
  test(`golden: ${name}`, () => {
    const raw = readYaml(new URL(`${name}.yaml`, dir));
    assert.equal(validateStageSchema(raw).ok, true, "the fixture must pass the schema");
    const ctx = buildContext(loadWorkshop(root), root);
    ctx.stages.set(raw.id, { slugs: null });
    assert.deepEqual(checkStage(raw, ctx), [], "the fixture must pass the semantic rules");
    let lines = {};
    try {
      lines = readYaml(new URL(`${name}.lines.yaml`, dir));
    } catch {}
    const got = compileStage(normalizeStage(raw), lines);
    const want = JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
    assert.deepEqual(got, want);
    assert.equal(serialize(got), readFileSync(new URL(`${name}.json`, dir), "utf8"), "stable key order and formatting");
    validateContent({ facts: compileFacts(), stages: [got] });
  });
}

test("golden: the real stage 1", () => {
  const lines = readYaml(join(root, "kai/lines.yaml"));
  const got = compileStage(stageOf(readFileSync(join(root, "stages/kairos-lab.yaml"), "utf8")), lines);
  assert.equal(serialize(got), readFileSync(new URL("kairos-lab.json", dir), "utf8"));
  assert.deepEqual(got.steps.map((s) => s.id), [
    "install-kairos-lab", "kairos-lab-setup", "auroraboot-version", "pull-auroraboot",
    "run-auroraboot-container", "build-it-locally-linux-only", "build-auroraboot", "run-auroraboot-local",
  ]);
});

// Rule by rule, on small stages written in the test.
const stage = (sections) => stageOf(`format: kairos-workshop/v0\nid: t\ntitle: T\ngoal: try t\nsections:\n${sections}`);
const stepsOf = (sections, lines) => compileStage(stage(sections), lines).steps;

test("rule 1: a section with no steps becomes one step named by the section slug", () => {
  const [s] = stepsOf("  - title: Hello, World!\n    text: Hi.\n");
  assert.deepEqual([s.id, s.title], ["hello-world", "Hello, World!"]);
  assert.deepEqual(s.blocks, [{ type: "text", md: "Hi." }]);
  assert.equal(s.check.prompt, PROMPTS.read);
});

test("rule 1: a section with nothing in it is an error", () => {
  assert.throws(() => stepsOf("  - title: Empty\n"), /nothing to show/);
});

test("rule 2: only the first step of a section carries the section blocks", () => {
  const steps = stepsOf("  - title: S\n    text: Section text.\n    steps:\n      - id: a\n        commands: [x]\n      - id: b\n        commands: [y]\n");
  assert.deepEqual(steps[0].blocks.map((b) => b.type), ["text", "command"]);
  assert.deepEqual(steps[1].blocks.map((b) => b.type), ["command"]);
  assert.equal(steps[0].title, "S", "a step with no title takes the section title");
});

test("rule 2: a first step with its own condition gets the section blocks in a step of its own", () => {
  const steps = stepsOf("  - title: S\n    text: Section text.\n    steps:\n      - id: a\n        when: { os: linux }\n        commands: [x]\n");
  assert.deepEqual(steps.map((s) => s.id), ["s", "a"]);
  assert.deepEqual(steps[0].blocks, [{ type: "text", md: "Section text." }]);
  assert.equal(steps[0].only, undefined);
});

test("rule 3: the section condition lands on every step and merges by intersection", () => {
  const steps = stepsOf("  - title: S\n    when: { os: [linux, macos] }\n    steps:\n      - id: a\n        when: { os: [macos, windows], runtime: podman }\n        commands: [x]\n      - id: b\n        commands: [y]\n");
  assert.deepEqual(steps[0].only, { os: ["macos"], runtime: ["podman"] });
  assert.deepEqual(steps[1].only, { os: ["linux", "macos"] });
});

test("rule 3: an empty intersection is an error that names the step", () => {
  assert.throws(
    () => stepsOf("  - title: S\n    when: { os: linux }\n    steps:\n      - id: never\n        when: { os: macos }\n        commands: [x]\n"),
    (e) => e instanceof CompileError && /step "never"/.test(e.message) && /os/.test(e.message),
  );
});

test("rule 4: step text, warnings, commands, expect and after map to blocks in order", () => {
  const [s] = stepsOf("  - title: S\n    steps:\n      - id: a\n        text: T\n        warnings:\n          - { kind: caution, when: { os: windows }, text: W }\n        commands: [c1, c2]\n        expect: out\n        after: A\n");
  assert.deepEqual(s.blocks, [
    { type: "text", md: "T" },
    { type: "callout", kind: "caution", only: { os: ["windows"] }, md: "W" },
    { type: "command", code: "c1" },
    { type: "command", code: "c2" },
    { type: "output", text: "out" },
    { type: "text", md: "A" },
  ]);
});

test("rule 4: the five warning kinds map to the three callout kinds", () => {
  const kinds = ["note", "tip", "important", "warning", "caution"];
  const warnings = kinds.map((k) => `          - { kind: ${k}, text: x }`).join("\n");
  const [s] = stepsOf(`  - title: S\n    steps:\n      - id: a\n        warnings:\n${warnings}\n        commands: [c]\n`);
  assert.deepEqual(s.blocks.filter((b) => b.type === "callout").map((b) => b.kind), ["note", "note", "warning", "warning", "caution"]);
});

test("rule 4: a command keeps its lines and loses only trailing blank space", () => {
  const [s] = stepsOf("  - title: S\n    steps:\n      - id: a\n        commands:\n          - |\n            one\n            two\n");
  assert.deepEqual(s.blocks, [{ type: "command", code: "one\ntwo" }]);
});

test("rule 5: variants become one alternatives block in render order", () => {
  const [s] = stepsOf("  - title: S\n    steps:\n      - id: pick\n        title: Pick one\n        text: T\n        variants:\n          - { id: a, title: A, when: { os: macos }, text: VT, warnings: [{ kind: note, text: VW }], commands: [c], expect: e, after: VA }\n          - { id: b, title: B, commands: [d] }\n        after: A\n");
  assert.deepEqual(s.blocks.map((b) => b.type), ["text", "alternatives", "text"]);
  const alt = s.blocks[1];
  assert.deepEqual([alt.id, alt.title], ["pick", "Pick one"]);
  assert.deepEqual(alt.items[0], {
    label: "A",
    only: { os: ["macos"] },
    blocks: [
      { type: "text", md: "VT" },
      { type: "callout", kind: "note", md: "VW" },
      { type: "command", code: "c" },
      { type: "output", text: "e" },
      { type: "text", md: "VA" },
    ],
  });
  assert.deepEqual(alt.items[1], { label: "B", blocks: [{ type: "command", code: "d" }] });
});

test("rule 6: optional carries over and a step condition becomes only", () => {
  const [s] = stepsOf("  - title: S\n    steps:\n      - id: a\n        optional: true\n        when: { arch: arm64 }\n        commands: [c]\n");
  assert.equal(s.optional, true);
  assert.deepEqual(s.only, { arch: ["arm64"] });
  const [t] = stepsOf("  - title: S\n    steps:\n      - id: a\n        commands: [c]\n");
  assert.equal("optional" in t, false);
  assert.equal("only" in t, false);
});

test("rule 7: every step has a prompt, from the publisher's wording when there is a named check", () => {
  assert.equal(checkPrompt({ kind: "command-available", command: "x" }), "The x command is available in a new terminal.");
  assert.equal(checkPrompt({ kind: "image-exists", image: "a/b:c" }), "The a/b:c image is present in your container runtime.");
  assert.equal(checkPrompt({ kind: "iso-exists" }), "The ISO file exists.");
  assert.equal(checkPrompt({ kind: "vm-running" }), "The VM is running.");
  assert.equal(checkPrompt({ kind: "vm-running", name: "demo" }), "The demo VM is running.");
  assert.deepEqual(PROMPTS, { step: "You finished this step.", read: "You read this.", stage: "You finished this stage." });
  const steps = stepsOf("  - title: S\n    text: T\n    steps:\n      - id: a\n        commands: [c]\n        check: { kind: iso-exists }\n      - id: b\n        commands: [c]\n  - title: R\n    text: Read.\n");
  assert.deepEqual(steps.map((s) => s.check.prompt), ["The ISO file exists.", PROMPTS.step, PROMPTS.read]);
});

test("rule 7: fail is built from onFail and is an empty list without one", () => {
  const steps = stepsOf("  - title: S\n    steps:\n      - id: a\n        commands: [c]\n        onFail: Try again.\n      - id: b\n        commands: [c]\n");
  assert.deepEqual(steps[0].check.fail, [{ type: "text", md: "Try again." }]);
  assert.deepEqual(steps[1].check.fail, []);
});

test("rule 8: the line comes from lines.yaml by stage and step id and falls back to the title", () => {
  const steps = stepsOf("  - title: S\n    steps:\n      - id: a\n        title: Step A\n        commands: [c]\n      - id: b\n        title: Step B\n        commands: [c]\n", { "t/a": "A line." });
  assert.deepEqual(steps.map((s) => s.line), ["A line.", "Step B"]);
});

test("rule 9: title and goal come from the stage and a Stage N prefix is stripped", () => {
  const doc = stageOf("format: kairos-workshop/v0\nid: t\ntitle: \"Stage 4: Hello\"\ngoal: say hello\nsections:\n  - title: S\n    text: x\n");
  const out = compileStage(doc);
  assert.deepEqual([out.title, out.goal], ["Hello", "say hello"]);
});

test("rule 10: a markdown stage is one step that points at the file on GitHub", () => {
  const out = compileMarkdownStage({ id: "first-node", title: "Stage 2: Deploying a single node cluster", goal: "boot a first node", markdown: "stage-2.md" }, "kairos-io/workshop-kubernetes-intro", { "first-node/on-github": "A line." });
  assert.deepEqual(out, {
    id: "first-node",
    title: "Deploying a single node cluster",
    goal: "boot a first node",
    steps: [
      {
        id: "on-github",
        title: "Continue on GitHub",
        line: "A line.",
        blocks: [{ type: "text", md: "This stage is not in the game yet. [Open it on GitHub](https://github.com/kairos-io/workshop-kubernetes-intro/blob/main/stage-2.md)." }],
        check: { prompt: "You finished this stage.", fail: [] },
      },
    ],
  });
  assert.equal(compileMarkdownStage({ id: "x", title: "X", goal: "g", markdown: "x.md" }, "a/b").steps[0].line, MARKDOWN_STEP.line);
  assert.throws(() => compileMarkdownStage({ id: "x", title: "X", markdown: "x.md" }, "a/b"), /needs a goal/);
});

test("rule 11: the output is stable, two-space indented and ends with a newline", () => {
  const loaded = loadWorkshop(root);
  const lines = readYaml(join(root, "kai/lines.yaml"));
  const a = serialize(compileWorkshop(loaded, lines));
  assert.equal(serialize(compileWorkshop(loaded, lines)), a);
  assert.ok(a.endsWith("}\n") && !a.endsWith("\n\n"));
  assert.ok(a.startsWith('{\n  "facts": ['));
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(a), "no timestamps");
});

test("facts are emitted in the reader's shape from facts.mjs", () => {
  const facts = compileFacts();
  assert.deepEqual(facts[0], {
    id: "virtualization",
    label: "Virtualization",
    question: "What runs your VMs?",
    options: [{ id: "kairos-lab", label: "kairos-lab" }, { id: "own", label: "My own software" }],
  });
  assert.deepEqual(facts.map((f) => f.id), FACT_DEFS.map((f) => f.id));
  for (const f of facts) assert.deepEqual(Object.keys(f), ["id", "label", "question", "options"]);
});

test("the stage 1 steps have distinct titles, so the game never shows the same name twice", () => {
  const out = compileWorkshop(loadWorkshop(root), readYaml(join(root, "kai/lines.yaml")));
  const titles = out.stages[0].steps.map((s) => s.title);
  assert.deepEqual(titles, [
    "Install kairos-lab", "Run kairos-lab setup", "Check the auroraboot command", "Pull the image",
    "Run the container", "Build it locally (Linux only)", "Build AuroraBoot", "Run your local build",
  ]);
});

test("the whole workshop compiles to seven stages, stage 1 in full and six pointers", () => {
  const out = compileWorkshop(loadWorkshop(root), readYaml(join(root, "kai/lines.yaml")));
  assert.deepEqual(out.stages.map((s) => s.id), ["kairos-lab", "first-node", "build-image", "pipelines", "manual-upgrade", "multi-node", "operator-upgrade"]);
  assert.equal(out.stages[0].steps.length, 8);
  for (const s of out.stages.slice(1)) assert.deepEqual(s.steps.map((x) => x.id), ["on-github"]);
  for (const s of out.stages) assert.ok(s.goal.length > 0 && !/^Stage \d/.test(s.title));
});

test("kai/lines.yaml has a line for every stage 1 step, in at most 60 characters, and no key that matches nothing", () => {
  const lines = readYaml(join(root, "kai/lines.yaml"));
  const out = compileWorkshop(loadWorkshop(root), lines);
  for (const step of out.stages[0].steps) assert.ok(lines[`kairos-lab/${step.id}`], step.id);
  for (const [k, v] of Object.entries(lines)) {
    assert.ok(v.length <= 60, `${k}: ${v.length}`);
    assert.ok(!/[\n<>\u2014]/.test(v), k);
    assert.ok(!/wild|trainer|appeared|catch|capture/i.test(v), k);
  }
});

test("a line key that matches no step is an error and so is a line that is too long", () => {
  const loaded = loadWorkshop(root);
  assert.throws(() => compileWorkshop(loaded, { "kairos-lab/no-such-step": "x" }), /matches no stage and step/);
  assert.throws(() => compileWorkshop(loaded, { "kairos-lab/install-kairos-lab": "x".repeat(61) }), /1 to 60 characters/);
});

// Validation of the output.
const good = () => ({ facts: compileFacts(), stages: [{ id: "s", title: "S", goal: "g", steps: [{ id: "a", title: "A", line: "L", blocks: [{ type: "text", md: "x" }], check: { prompt: "p", fail: [] } }] }] });
const bad = (mutate) => {
  const c = good();
  mutate(c.stages[0].steps[0], c);
  return c;
};

test("the validator accepts a good content object", () => {
  validateContent(good());
});

test("the validator rejects a value that is not a known fact value", () => {
  assert.throws(() => validateContent(bad((s) => { s.only = { virtualization: ["other"] }; })), /unknown value "other"/);
  assert.throws(() => validateContent(bad((s) => { s.blocks[0].only = { colour: ["red"] }; })), /unknown fact "colour"/);
  assert.throws(() => validateContent(bad((s) => { s.blocks[0].only = { os: [] }; })), /non-empty list/);
});

test("the validator rejects blocks that lack the fields their type needs", () => {
  assert.throws(() => validateContent(bad((s) => { s.blocks = [{ type: "text" }]; })), /missing "md"/);
  assert.throws(() => validateContent(bad((s) => { s.blocks = [{ type: "command" }]; })), /missing "code"/);
  assert.throws(() => validateContent(bad((s) => { s.blocks = [{ type: "output", md: "x" }]; })), /missing "text"/);
  assert.throws(() => validateContent(bad((s) => { s.blocks = [{ type: "file", code: "x" }]; })), /missing "name"/);
  assert.throws(() => validateContent(bad((s) => { s.blocks = [{ type: "callout", kind: "tip", md: "x" }]; })), /unknown callout kind "tip"/);
  assert.throws(() => validateContent(bad((s) => { s.blocks = [{ type: "alternatives", id: "x", title: "T", items: [{ blocks: [] }] }]; })), /missing "label"|missing label/);
});

test("the validator rejects unknown block types, unknown fields and steps with no prompt", () => {
  assert.throws(() => validateContent(bad((s) => { s.blocks = [{ type: "video", url: "x" }]; })), /unknown block type "video"/);
  assert.throws(() => validateContent(bad((s) => { s.blocks[0].extra = 1; })), /unknown field "extra"/);
  assert.throws(() => validateContent(bad((s) => { s.surprise = true; })), /unknown field "surprise"/);
  assert.throws(() => validateContent(bad((s) => { delete s.check.prompt; })), /check.prompt is required/);
  assert.throws(() => validateContent(bad((s) => { s.blocks = []; })), /has no blocks/);
  assert.throws(() => validateContent(bad((s, c) => { c.stages[0].steps.push({ ...s }); })), /duplicate step id/);
});

// The command line tool.
const run = (...args) => spawnSync(process.execPath, [join(root, "tools/compile-kai.mjs"), ...args], { encoding: "utf8" });
const outDir = () => mkdtempSync(join(tmpdir(), "ws-kai-"));

test("the tool writes content.json, --check passes on it and fails when it is stale or missing", () => {
  const out = outDir();
  assert.equal(run("--out", out).status, 0);
  const text = readFileSync(join(out, "content.json"), "utf8");
  assert.equal(run("--check", "--out", out).status, 0);
  writeFileSync(join(out, "content.json"), text.replace("Setting up", "Setting Up"));
  const stale = run("--check", "--out", out);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /content\.json is generated from workshop\.yaml/);
  assert.equal(readFileSync(join(out, "content.json"), "utf8"), text.replace("Setting up", "Setting Up"), "--check must not write");
  assert.equal(run("--check", "--out", join(out, "missing")).status, 1);
});

test("the tool needs --out", () => {
  assert.equal(run().status, 2);
});

test("the tool refuses a workshop that does not validate", () => {
  const d = mkdtempSync(join(tmpdir(), "ws-kai-bad-"));
  mkdirSync(join(d, "stages"));
  cpSync(join(root, "workshop.yaml"), join(d, "workshop.yaml"));
  const r = run("--out", outDir(), d);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /error:/);
});
