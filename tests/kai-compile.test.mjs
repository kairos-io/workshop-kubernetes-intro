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
import { normalizeWhen } from "../tools/lib/load.mjs";
import { compileStage, compileMarkdownStage, compileWorkshop, compileFacts, validateContent, CompileError, DEFAULT_TIP_WHEN, PROMPTS, MARKDOWN_STEP, stepLines, endingOptions } from "../tools/lib/kai.mjs";
import { serialize } from "../tools/compile-kai.mjs";
import { compileTheme, GENERATED_THEME_KEYS } from "../tools/lib/theme.mjs";

const root = new URL("../", import.meta.url).pathname;
const realLoadout = () => loadWorkshop(root).workshop.loadout;
const dir = new URL("../conformance/v0/kai/", import.meta.url);
const readYaml = (url) => parse(readFileSync(url, "utf8"));
const stageOf = (yamlText) => normalizeStage(parse(yamlText));

// Golden outputs. Each synthetic stage `<name>.yaml` has `<name>.json` and, if it needs game lines, `<name>.lines.yaml`.
const cases = readdirSync(dir).filter((f) => f.endsWith(".yaml") && !f.endsWith(".lines.yaml")).map((f) => f.replace(/\.yaml$/, "")).sort();

test("there is a golden case for every rule group", () => {
  assert.deepEqual(cases, ["help-and-skip", "lines", "sections-text-only", "step-shapes", "tip-default", "variants", "when-merge"]);
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
    validateContent({ facts: compileFacts(realLoadout()), stages: [got] });
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
  assert.equal(checkPrompt({ kind: "manual", text: "Setup finished." }), "Setup finished.");
  assert.equal(checkPrompt({ kind: "manual", text: "setup finished." }), "Setup finished.");
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
        check: { kind: "manual", prompt: "You finished this stage.", fail: [] },
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

test("facts are generated from the loadout, in the reader's shape and the order of the loadout", () => {
  const facts = compileFacts(realLoadout());
  assert.deepEqual(facts.map((f) => f.id), ["os", "virtualization", "arch", "runtime"], "the order of the questions");
  assert.deepEqual(facts[0], {
    id: "os",
    label: "OS",
    question: "What is your computer running?",
    options: [
      { id: "linux", label: "Linux" },
      { id: "macos", label: "macOS" },
      { id: "windows", label: "Windows", forces: { virtualization: "own" }, notice: "windows" },
    ],
  });
  assert.deepEqual(facts[1], {
    id: "virtualization",
    label: "Virtualization",
    question: "How will you run the VMs?",
    options: [{ id: "kairos-lab", label: "Zen" }, { id: "own", label: "Master" }],
    askIf: { os: ["linux", "macos"] },
  });
  assert.deepEqual(facts.map((f) => f.label), ["OS", "Virtualization", "Architecture", "Container runtime"]);
  assert.deepEqual(facts.map((f) => f.question), ["What is your computer running?", "How will you run the VMs?", "Which CPU architecture?", "Which container runtime?"]);
  assert.deepEqual(facts.map((f) => f.askIf), [undefined, { os: ["linux", "macos"] }, { os: ["linux", "macos"] }, { os: ["linux", "macos"] }]);
  for (const f of facts) assert.ok(Object.keys(f).every((k) => ["id", "label", "question", "options", "askIf"].includes(k)));
  assert.ok(!facts[0].options[0].forces && !facts[0].options[0].notice, "an option has forces and notice only when it has them");
});

test("a fact the loadout does not ask is not in the facts, and a scalar when becomes a list", () => {
  const loadout = { questions: realLoadout().questions.filter((q) => q.fact !== "arch") };
  assert.deepEqual(compileFacts(loadout).map((f) => f.id), ["os", "virtualization", "runtime"]);
  const scalar = { questions: realLoadout().questions.map((q) => (q.when ? { ...q, when: { os: "linux" } } : q)) };
  assert.deepEqual(compileFacts(scalar)[1].askIf, { os: ["linux"] });
});

test("an option that ends the loadout needs a when on every later question, because the reader has no ends", () => {
  const questions = realLoadout().questions;
  assert.doesNotThrow(() => compileFacts({ questions }));
  const noWhen = questions.map((q) => (q.fact === "arch" ? { ...q, when: undefined } : q));
  assert.throws(() => compileFacts({ questions: noWhen }), /"windows" of "os" ends the loadout, but the question about "arch" has no when/);
  const otherWhen = questions.map((q) => (q.fact === "runtime" ? { ...q, when: { virtualization: ["kairos-lab", "own"] } } : q));
  assert.throws(() => compileFacts({ questions: otherWhen }), /question about "runtime"/);
});

test("the content holds the facts and the stages and nothing of the welcome pages, the loadout or the prompts", () => {
  const loaded = loadWorkshop(root);
  const out = compileWorkshop(loaded, readYaml(join(root, "kai/lines.yaml")));
  assert.deepEqual(Object.keys(out), ["facts", "stages"]);
});

test("stage 1 carries the tool, the docs, the tip as text and the skip rule in the reader's shape", () => {
  const out = compileWorkshop(loadWorkshop(root), readYaml(join(root, "kai/lines.yaml")));
  const [one, two] = out.stages;
  assert.deepEqual(one.noSkip, { when: { virtualization: ["kairos-lab"] }, reason: "You play Zen, so every later stage uses kairos-lab. Set it up first." });
  assert.equal(one.tip, "Explain how to install {runtime} on {os} ({arch}) and how to check that it works.");
  assert.deepEqual(one.tool, { name: "kairos-lab", url: "https://github.com/kairos-io/kairos-lab" });
  assert.equal(one.docs, "https://github.com/kairos-io/kairos-lab#readme");
  assert.deepEqual(one.tipOnly, { virtualization: ["own"] }, "the stage sets no when for its tip, so the default applies");
  assert.deepEqual(Object.keys(one), ["id", "title", "goal", "steps", "tool", "docs", "tip", "tipOnly", "noSkip"]);
  assert.ok(!("notSkippableWhen" in one));
  for (const k of ["tool", "docs", "tip", "tipOnly", "noSkip"]) assert.ok(!(k in two), `a markdown stage has no ${k}`);
});

test("a step carries its goal in the reader's shape and its help as ours", () => {
  const out = compileWorkshop(loadWorkshop(root), readYaml(join(root, "kai/lines.yaml")));
  const byId = Object.fromEntries(out.stages[0].steps.map((s) => [s.id, s]));
  assert.equal(byId["install-kairos-lab"].goal, "Install the kairos-lab command");
  assert.deepEqual(byId["install-kairos-lab"].help, { tool: "kairos-lab", source: "https://github.com/kairos-io/kairos-lab", docs: "https://github.com/kairos-io/kairos-lab#readme", expect: "The kairos-lab command is available in a new terminal." });
  assert.deepEqual(byId["pull-auroraboot"].help, { tool: "AuroraBoot", source: "https://github.com/kairos-io/AuroraBoot", docs: "https://kairos.io/docs/reference/auroraboot/", expect: "The quay.io/kairos/auroraboot:latest image is present in your container runtime." });
  assert.equal(byId["build-it-locally-linux-only"].goal, undefined, "a section-only step has no goal");
  assert.equal(byId["build-it-locally-linux-only"].help, undefined);
  assert.deepEqual(Object.keys(byId["pull-auroraboot"]), ["id", "title", "line", "only", "blocks", "check", "goal", "help"]);
  for (const s of out.stages.slice(1)) for (const st of s.steps) assert.ok(!("goal" in st) && !("help" in st));
});

test("a stage with a tip always carries tipOnly: its own when, or the default { virtualization: own }", () => {
  const withTip = (tip) => stageOf(`format: kairos-workshop/v0\nid: t\ntitle: T\ngoal: try t\ntip: ${tip}\nsections:\n  - title: S\n    text: x\n`);
  const plain = compileStage(withTip('{ request: "R" }'));
  assert.deepEqual([plain.tip, plain.tipOnly], ["R", { virtualization: ["own"] }]);
  assert.deepEqual(plain.tipOnly, DEFAULT_TIP_WHEN);
  const t = compileStage(withTip('{ when: { virtualization: kairos-lab }, request: "R {os}" }'));
  assert.deepEqual([t.tip, t.tipOnly], ["R {os}", { virtualization: ["kairos-lab"] }]);
  const many = compileStage(withTip('{ when: { runtime: [podman, docker], os: linux }, request: "R" }'));
  assert.deepEqual(many.tipOnly, { os: ["linux"], runtime: ["podman", "docker"] }, "the fixed fact order, the list kept");
  const none = stageOf("format: kairos-workshop/v0\nid: t\ntitle: T\ngoal: try t\nsections:\n  - title: S\n    text: x\n");
  assert.ok(!("tip" in compileStage(none)) && !("tipOnly" in compileStage(none)), "no tip, no tipOnly");
});

test("a stage with a tool but no source has a name and no url, and no tool has no tool", () => {
  const doc = (help) => stageOf(`format: kairos-workshop/v0\nid: t\ntitle: T\ngoal: try t\nhelp: ${help}\nsections:\n  - title: S\n    text: x\n`);
  assert.deepEqual(compileStage(doc("{ tool: demo }")).tool, { name: "demo" });
  assert.ok(!("tool" in compileStage(doc("{ source: https://example.com }"))));
  assert.equal(compileStage(doc("{ docs: https://example.com/d }")).docs, "https://example.com/d");
});

test("a compile error names a workshop that lacks the welcome pages, the loadout or the prompts", () => {
  const loaded = loadWorkshop(root);
  for (const key of ["welcome", "loadout", "prompts"]) {
    const { [key]: _gone, ...rest } = loaded.workshop;
    assert.throws(() => compileWorkshop({ ...loaded, workshop: rest }, {}), new RegExp(`workshop.yaml needs ${key}`));
  }
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
  const steps = stepLines(lines);
  for (const step of out.stages[0].steps) assert.ok(steps[`kairos-lab/${step.id}`], step.id);
  for (const [k, v] of Object.entries(steps)) {
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

test("kai/lines.yaml has a welcome line for every welcome page and a notice for every option that ends the loadout", () => {
  const lines = readYaml(join(root, "kai/lines.yaml"));
  const { workshop } = loadWorkshop(root);
  assert.equal(lines.welcome.length, workshop.welcome.pages.length);
  for (const l of lines.welcome) assert.ok(l.length <= 40 && !/[\n<>\u2014]/.test(l), l);
  assert.deepEqual(Object.keys(lines.notices), endingOptions(workshop.loadout).map((o) => o.value));
  assert.deepEqual(lines.notices.windows, { title: "Windows: you play Master", line: "Not game over! You play MASTER." });
  for (const n of Object.values(lines.notices)) assert.ok(n.title.length <= 60 && n.line.length <= 60);
  compileWorkshop(loadWorkshop(root), lines);
});

test("the welcome and notices sections of kai/lines.yaml are checked", () => {
  const loaded = loadWorkshop(root);
  const good = readYaml(join(root, "kai/lines.yaml"));
  const bad = (patch) => compileWorkshop(loaded, { ...good, ...patch });
  assert.throws(() => bad({ welcome: good.welcome.slice(1) }), /one line for each of the 5 welcome pages/);
  assert.throws(() => bad({ welcome: [...good.welcome, "One too many."] }), /one line for each of the 5 welcome pages/);
  assert.throws(() => bad({ welcome: "Hi" }), /one line for each of the 5 welcome pages/);
  assert.throws(() => bad({ welcome: [...good.welcome.slice(0, 4), "x".repeat(41)] }), /welcome line 5 must be plain text of 1 to 40/);
  assert.throws(() => bad({ welcome: [...good.welcome.slice(0, 4), "Two\nlines"] }), /welcome line 5/);
  assert.throws(() => bad({ notices: { linux: { title: "T", line: "L" } } }), /the notice "linux" matches no option that has ends: true/);
  assert.throws(() => bad({ notices: { windows: { title: "T" } } }), /must have a title and a line/);
  assert.throws(() => bad({ notices: { windows: { title: "T", line: "L", md: "M" } } }), /must have a title and a line/);
  assert.throws(() => bad({ notices: { windows: { title: "T", line: "x".repeat(61) } } }), /the line of the notice "windows"/);
  assert.throws(() => bad({ notices: ["windows"] }), /notices must be a map|matches no option/);
});

// Validation of the output.
const good = () => ({ facts: compileFacts(realLoadout()), stages: [{ id: "s", title: "S", goal: "g", steps: [{ id: "a", title: "A", line: "L", blocks: [{ type: "text", md: "x" }], check: { prompt: "p", fail: [] } }] }] });
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

test("the validator checks the stage fields of the reader's shape", () => {
  const withStage = (mutate) => bad((_s, c) => mutate(c.stages[0], c));
  validateContent(withStage((st) => { st.noSkip = { when: { virtualization: ["kairos-lab"] }, reason: "R" }; st.tip = "T {os}"; st.tipOnly = { virtualization: ["own"] }; st.tool = { name: "n", url: "https://x" }; st.docs = "https://d"; }));
  assert.throws(() => validateContent(withStage((st) => { st.noSkip = { when: { virtualization: ["other"] }, reason: "R" }; })), /unknown value "other"/);
  assert.throws(() => validateContent(withStage((st) => { st.noSkip = { when: { virtualization: ["own"] } }; })), /missing "reason"/);
  assert.throws(() => validateContent(withStage((st) => { st.noSkip = { when: { virtualization: ["own"] }, reason: "" }; })), /"reason" must be text/);
  assert.throws(() => validateContent(withStage((st) => { st.notSkippableWhen = { virtualization: ["own"] }; })), /unknown field "notSkippableWhen"/);
  assert.throws(() => validateContent(withStage((st) => { st.tip = { request: "R" }; })), /"tip" must be text/);
  assert.throws(() => validateContent(withStage((st) => { st.tip = ""; })), /"tip" must be text/);
  assert.throws(() => validateContent(withStage((st) => { st.tool = { url: "https://x" }; })), /missing "name"/);
  assert.throws(() => validateContent(withStage((st) => { st.tool = { name: "n", url: "http://x" }; })), /https/);
  assert.throws(() => validateContent(withStage((st) => { st.docs = "http://d"; })), /https/);
});

test("the validator checks the step goal and the step help", () => {
  assert.throws(() => validateContent(bad((s) => { s.help = { tool: "t" }; })), /missing "expect"/);
  validateContent(bad((s) => { s.goal = "g"; s.help = { expect: "e", tool: "t", source: "https://x", docs: "https://y" }; }));
  assert.throws(() => validateContent(bad((s) => { s.help = { goal: "g", expect: "e" }; })), /unknown field "goal"/);
  assert.throws(() => validateContent(bad((s) => { s.help = { expect: "e", source: "http://x" }; })), /https/);
  assert.throws(() => validateContent(bad((s) => { s.goal = ""; })), /"goal" must be text/);
});

test("the validator checks the facts", () => {
  const withFacts = (mutate) => bad((_s, c) => mutate(c.facts, c));
  assert.throws(() => validateContent(withFacts((f) => { f[0].id = "colour"; })), /unknown fact "colour"/);
  assert.throws(() => validateContent(withFacts((f) => { f[0].options[0].id = "beos"; })), /unknown value "beos"/);
  assert.throws(() => validateContent(withFacts((f) => { delete f[0].question; })), /missing "question"/);
  assert.throws(() => validateContent(withFacts((f) => { f[1].askIf = { os: [] }; })), /non-empty list/);
  assert.throws(() => validateContent(withFacts((f) => { f[0].options[2].forces = { virtualization: "other" }; })), /forces.*"other"/);
  assert.throws(() => validateContent(withFacts((f) => { f[0].options[2].notice = ""; })), /notice/);
  assert.throws(() => validateContent(withFacts((f) => { f[0].options[0].extra = 1; })), /unknown field "extra"/);
  assert.throws(() => validateContent(withFacts((f) => { f.push({ ...f[0] }); })), /duplicate fact/);
  assert.throws(() => validateContent(bad((s, c) => { c.welcome = { pages: [] }; })), /unknown field "welcome"/);
  assert.throws(() => validateContent(bad((s, c) => { c.loadout = { questions: [] }; })), /unknown field "loadout"/);
  assert.throws(() => validateContent(bad((s, c) => { c.prompts = { step: "s", tip: "t" }; })), /unknown field "prompts"/);
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

test("kai/DATA.md names every field of the generated content and theme and has no em dash", () => {
  const doc = readFileSync(join(root, "kai/DATA.md"), "utf8");
  const loaded = loadWorkshop(root);
  const lines = readYaml(join(root, "kai/lines.yaml"));
  const out = compileWorkshop(loaded, lines);
  const theme = compileTheme(loaded, lines, JSON.parse(readFileSync(join(root, "kai/theme.base.json"), "utf8")));
  // Every key of the structure. Keys of an `only`, a `when` or `forces` are fact ids, and keys of the maps
  // of questions, options and notices are data. They are not field names.
  const used = new Set();
  const skip = new Set(["only", "when", "noSkip.when", "forces", "askIf", "tipOnly", "questions", "options", "notices"]);
  const collect = (v, name) => {
    if (Array.isArray(v)) return v.forEach((x) => collect(x, name));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (name !== "options" && name !== "questions" && name !== "notices") used.add(k);
        collect(skip.has(k) && !["questions", "options", "notices"].includes(k) ? {} : x, k);
      }
    }
  };
  collect(out);
  const contentKeys = new Set(used);
  assert.ok(contentKeys.size > 30);
  for (const k of contentKeys) assert.match(doc, new RegExp(`\\b${k}\\b`), `DATA.md does not mention ${k}`);
  // The generated keys of the theme: the structure of welcome, loadout, prompts and stages.
  const themeKeys = new Set();
  const walk = (v, inMap) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, false));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (!inMap) themeKeys.add(k);
        walk(["questions", "options", "notices"].includes(k) ? Object.values(x) : k === "only" ? {} : x, false);
      }
    }
  };
  for (const k of GENERATED_THEME_KEYS) { themeKeys.add(k); walk(theme[k]); }
  for (const k of ["welcome", "pages", "line", "md", "mentor", "badge", "help", "label", "code", "after", "title", "fail", "tip", "location", "nodes", "items", "notices", "questions", "options"]) assert.ok(themeKeys.has(k) || contentKeys.has(k), `theme key ${k} is not in the output`);
  for (const k of themeKeys) if (/^[a-zA-Z]+$/.test(k)) assert.match(doc, new RegExp(`\\b${k}\\b`), `DATA.md does not mention the theme key ${k}`);
  for (const f of ["theme.base.json", "content.json", "theme.json", "kai/lines.yaml", "What the reader reads", "Not used yet", "Where the reader and our reference differ"]) assert.ok(doc.includes(f), f);
  assert.ok(!doc.includes("\u2014"));
  for (const p of ["stage", "step", "os", "arch", "runtime", "virtualization", "goal", "tool", "source", "docs", "commands", "expect", "expected", "request", "ask", "logs"]) assert.ok(doc.includes(`\`{${p}}\``), `placeholder ${p}`);
  assert.ok(doc.includes("[YOUR VIRTUALIZATION: kairos-lab OR YOUR OWN SOFTWARE]"));
});

test("every check has a kind: the named kind, or manual for a default prompt", () => {
  const out = compileWorkshop(loadWorkshop(root), readYaml(join(root, "kai/lines.yaml")));
  const byId = Object.fromEntries(out.stages[0].steps.map((s) => [s.id, s.check]));
  assert.deepEqual(byId["install-kairos-lab"], { kind: "command-available", prompt: "The kairos-lab command is available in a new terminal.", verify: { command: "kairos-lab --version", output: "0.1.3" }, fail: [] });
  assert.equal(byId["pull-auroraboot"].kind, "image-exists");
  assert.equal(byId["kairos-lab-setup"].kind, "manual");
  assert.equal(byId["kairos-lab-setup"].prompt, PROMPTS.step);
  assert.equal(byId["build-it-locally-linux-only"].kind, "manual");
  assert.equal(byId["build-it-locally-linux-only"].prompt, PROMPTS.read);
  for (const s of out.stages.slice(1)) assert.deepEqual([s.steps[0].check.kind, s.steps[0].check.prompt], ["manual", PROMPTS.stage]);
  for (const st of out.stages.flatMap((s) => s.steps)) {
    assert.ok(["command-available", "image-exists", "iso-exists", "vm-running", "manual"].includes(st.check.kind), st.id);
    assert.equal(st.check.kind === "manual", [PROMPTS.step, PROMPTS.read, PROMPTS.stage].includes(st.check.prompt), st.id);
  }
});

test("a check verify is carried over: the command, and the output only when the stage has one", () => {
  const steps = stepsOf("  - title: S\n    text: T\n    steps:\n      - id: a\n        commands: [c]\n        check: { kind: iso-exists, verify: { command: ls build, output: \"a.iso\\nb.iso\\n\" } }\n      - id: b\n        commands: [c]\n        check: { kind: iso-exists, verify: { command: ls build } }\n      - id: c\n        commands: [c]\n        check: { kind: iso-exists }\n      - id: d\n        commands: [c]\n");
  assert.deepEqual(steps[0].check.verify, { command: "ls build", output: "a.iso\nb.iso" });
  assert.deepEqual(steps[1].check.verify, { command: "ls build" });
  assert.equal("verify" in steps[2].check, false);
  assert.equal("verify" in steps[3].check, false, "a step with no named check has no verify");
  assert.deepEqual(Object.keys(steps[0].check), ["kind", "prompt", "verify", "fail"]);
});

test("the validator checks the verify of a check", () => {
  const bad = (fn) => { const c = good(); fn(c.stages[0].steps[0].check); return c; };
  validateContent(bad((c) => { c.verify = { command: "x" }; }));
  validateContent(bad((c) => { c.verify = { command: "x", output: "y" }; }));
  assert.throws(() => validateContent(bad((c) => { c.verify = {}; })), /check.verify: missing "command"/);
  assert.throws(() => validateContent(bad((c) => { c.verify = { command: "a\nb" }; })), /"command" must be text on one line/);
  assert.throws(() => validateContent(bad((c) => { c.verify = { command: "x", output: "" }; })), /"output" must be text/);
  assert.throws(() => validateContent(bad((c) => { c.verify = { command: "x", run: 1 }; })), /unknown field "run"/);
});

test("every help has an expect: the check sentence, or the default sentence", () => {
  const out = compileWorkshop(loadWorkshop(root), readYaml(join(root, "kai/lines.yaml")));
  const steps = out.stages[0].steps.filter((s) => s.help);
  assert.equal(steps.length, 7);
  for (const s of steps) {
    assert.equal(s.help.expect, s.check.kind === "manual" ? "the step finishes without errors" : s.check.prompt, s.id);
    assert.deepEqual(Object.keys(s.help), ["tool", "source", "docs", "expect"]);
  }
  assert.equal(steps.find((s) => s.id === "auroraboot-version").help.expect, "The auroraboot command is available in a new terminal.");
  assert.equal(steps.find((s) => s.id === "kairos-lab-setup").help.expect, "the step finishes without errors");
});

test("the validator checks check.kind and help.expect", () => {
  validateContent(bad((s) => { s.check.kind = "manual"; s.help = { expect: "e" }; }));
  assert.throws(() => validateContent(bad((s) => { s.check.kind = "telepathy"; })), /check kind "telepathy"/);
  assert.throws(() => validateContent(bad((s) => { s.help = { expect: "" }; })), /"expect" must be text/);
});
