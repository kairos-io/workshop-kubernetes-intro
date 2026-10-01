import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { githubSlug } from "../tools/lib/slug.mjs";
import { loadWorkshop, normalizeWhen, normalizeStage } from "../tools/lib/load.mjs";
import { validateWorkshop, checkStage, checkWorkshop, buildContext } from "../tools/validate.mjs";
import { validateStageSchema, validateWorkshopSchema } from "../tools/lib/schema.mjs";

const root = new URL("../", import.meta.url).pathname;

// A small throwaway workshop directory for tests that need a broken tree.
function scratch(files) {
  const dir = mkdtempSync(join(tmpdir(), "ws-compile-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}
const workshopYaml = (stages) =>
  `format: kairos-workshop/v0\nid: t\ntitle: T\nrepository: kairos-io/t\nstages:\n${stages}\n`;
const stageYaml = (id, extra = "") =>
  `format: kairos-workshop/v0\nid: ${id}\ntitle: S\ngoal: do s\nsections:\n  - title: One\n${extra}`;

test("githubSlug matches GitHub for the headings we care about", () => {
  assert.equal(githubSlug("Before we begin"), "before-we-begin");
  assert.equal(githubSlug("Not using kairos-lab? Get AuroraBoot yourself"), "not-using-kairos-lab-get-auroraboot-yourself");
  assert.equal(githubSlug("Build it locally (Linux only)"), "build-it-locally-linux-only");
  assert.equal(githubSlug("Alternative: Using Podman on MacOS"), "alternative-using-podman-on-macos");
});

test("stage 1 and the workshop index validate", () => {
  assert.deepEqual(validateWorkshop(root), []);
});

test("stage 1 section slugs equal the five published anchors", () => {
  const loaded = loadWorkshop(root);
  assert.equal(loaded.ok, true);
  const stage1 = loaded.stages.find((s) => s.id === "kairos-lab");
  assert.deepEqual(stage1.slugs, [
    "before-we-begin",
    "installing-kairos-lab",
    "set-up-dependencies",
    "not-using-kairos-lab-get-auroraboot-yourself",
    "build-it-locally-linux-only",
  ]);
});

test("stage 3 heading slug matches the outbound anchor", () => {
  const text = readFileSync(join(root, "stage-3.md"), "utf8");
  const heading = text.split("\n").find((l) => l.startsWith("## Alternative"));
  assert.equal(githubSlug(heading.replace(/^##\s+/, "")), "alternative-using-podman-on-macos");
  const stage1 = readFileSync(join(root, "stages/kairos-lab.yaml"), "utf8");
  assert.ok(stage1.includes("stage:build-image#alternative-using-podman-on-macos"));
});

test("scalar when is normalized to a list", () => {
  assert.deepEqual(normalizeWhen({ os: "macos", runtime: ["docker", "podman"] }), { os: ["macos"], runtime: ["docker", "podman"] });
  assert.equal(normalizeWhen(undefined), undefined);
});

test("the loader normalizes every when in stage 1", () => {
  const stage1 = loadWorkshop(root).stages.find((s) => s.id === "kairos-lab");
  const homebrew = stage1.doc.sections[1].steps[0].variants[0];
  assert.deepEqual(homebrew.when, { os: ["macos"] });
  assert.deepEqual(stage1.doc.sections[1].when, { virtualization: ["kairos-lab"] });
});

test("the loader computes next links and referenced facts", () => {
  const loaded = loadWorkshop(root);
  const [one, two, , , , , seven] = loaded.stages;
  assert.equal(one.kind, "converted");
  assert.equal(two.kind, "markdown");
  assert.deepEqual(one.next, { id: "first-node", title: "Deploying a single node cluster", n: 2, file: "stage-2.md", converted: false });
  assert.equal(seven.next, null);
  assert.deepEqual(one.facts, ["virtualization", "os", "runtime"]);
  assert.deepEqual(loaded.facts, ["virtualization", "os", "runtime"]);
});

test("a converted stage links to its generated file name", () => {
  const dir = scratch({
    "workshop.yaml": workshopYaml("  - file: stages/a.yaml\n  - file: stages/b.yaml"),
    "stages/a.yaml": stageYaml("a"),
    "stages/b.yaml": stageYaml("b"),
  });
  const loaded = loadWorkshop(dir);
  assert.deepEqual(loaded.stages[0].next, { id: "b", title: "S", n: 2, file: "stage-2.md", converted: true });
});

// Semantic errors: each rule has a test that makes it fail.
// A file named workshop-*.yaml is a workshop index. Every other file is a stage.
const semDir = new URL("../conformance/v0/semantic/", import.meta.url);
const ctx = () => buildContext(loadWorkshop(root), root);
const isWorkshop = (f) => f.startsWith("workshop-");
const schemaOf = (f, doc) => (isWorkshop(f) ? validateWorkshopSchema(doc) : validateStageSchema(doc));
const semanticOf = (f, doc) => (isWorkshop(f) ? checkWorkshop(doc) : checkStage(doc, ctx()));

// The message each new workshop rule must give, so a fixture cannot pass for the wrong reason.
const WANTED = {
  "workshop-question-refs-later-fact.yaml": /questions\[0\] \(virtualization\): when names "os", which is not asked before this question/,
  "workshop-question-refs-missing-fact.yaml": /when names "runtime", which is not asked before this question/,
  "workshop-question-refs-itself.yaml": /when names "os", which is not asked before this question/,
  "workshop-option-missing-value.yaml": /questions\[0\] \(os\): no option for the value "windows"/,
  "workshop-option-duplicate-value.yaml": /offers the value "linux" twice/,
  "workshop-duplicate-fact.yaml": /questions\[1\]: the fact "os" is already asked by questions\[0\]/,
  "workshop-forces-own-fact.yaml": /forces its own fact "os"/,
  "workshop-two-recommended.yaml": /more than one recommended option/,
  "workshop-note-refs-later-fact.yaml": /notes\[0\]: when names "runtime", which is not asked before this question/,
  "workshop-prompt-unknown-placeholder.yaml": /prompts\.step: unknown placeholder \{colour\}/,
  "workshop-prompt-spaced-placeholder.yaml": /prompts\.tip: unknown placeholder \{ stage \}/,
  "workshop-welcome-unknown-placeholder.yaml": /welcome\.pages\[0\]: unknown placeholder \{place\}/,
  "workshop-welcome-http-link.yaml": /welcome\.pages\[0\]: a link must use https/,
  "workshop-welcome-relative-link.yaml": /welcome\.pages\[0\]: a link must use https/,
  "workshop-welcome-list.yaml": /welcome\.pages\[0\]: only one paragraph of inline markdown is allowed/,
  "workshop-welcome-two-paragraphs.yaml": /welcome\.pages\[0\]: only one paragraph of inline markdown is allowed/,
  "workshop-welcome-raw-html.yaml": /welcome\.pages\[0\]: raw HTML is not allowed/,
  "workshop-welcome-image.yaml": /welcome\.pages\[0\]: only one paragraph of inline markdown is allowed/,
  "workshop-option-text-html.yaml": /options\[0\]\.text: raw HTML is not allowed/,
  "workshop-note-alert.yaml": /notes\[0\]\.text: GitHub alert syntax is not allowed/,
  "tip-unknown-placeholder.yaml": /tip\.request: unknown placeholder \{stage\}/,
  "tip-spaced-placeholder.yaml": /tip\.request: unknown placeholder \{ runtime \}/,
};

for (const f of readdirSync(new URL("invalid/", semDir)).filter((n) => n.endsWith(".yaml")).sort()) {
  test(`semantic invalid: ${f}`, () => {
    const text = readFileSync(new URL(`invalid/${f}`, semDir), "utf8");
    assert.match(text.split("\n")[0], /^# expect-error: \S/);
    const doc = parse(text);
    assert.equal(schemaOf(f, doc).ok, true, "a semantic fixture must pass the schema");
    const errors = semanticOf(f, doc);
    assert.ok(errors.length > 0, "the semantic rules must reject this file");
    if (isWorkshop(f) || f.startsWith("tip-")) {
      assert.ok(WANTED[f], `${f} needs an entry in WANTED`);
      assert.match(errors.join("\n"), WANTED[f]);
    }
  });
}

for (const f of readdirSync(new URL("valid/", semDir)).filter((n) => n.endsWith(".yaml")).sort()) {
  test(`semantic valid: ${f}`, () => {
    const doc = parse(readFileSync(new URL(`valid/${f}`, semDir), "utf8"));
    assert.equal(schemaOf(f, doc).ok, true, "a semantic fixture must pass the schema");
    assert.deepEqual(semanticOf(f, doc), []);
  });
}

test("every valid workshop fixture of the schema also passes the semantic rules", () => {
  const dir = new URL("../conformance/v0/schema/valid/", import.meta.url);
  const names = readdirSync(dir).filter((n) => n.startsWith("workshop-") && n.endsWith(".yaml"));
  assert.ok(names.length >= 2);
  for (const f of names) assert.deepEqual(checkWorkshop(parse(readFileSync(new URL(f, dir), "utf8"))), [], f);
});

test("the schema valid stage fixtures also pass the semantic rules", () => {
  const dir = new URL("../conformance/v0/schema/valid/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => !n.startsWith("workshop-") && n.endsWith(".yaml"))) {
    assert.deepEqual(checkStage(parse(readFileSync(new URL(f, dir), "utf8")), ctx()), [], f);
  }
});

test("errors name the rule", () => {
  const doc = parse(readFileSync(new URL("invalid/duplicate-step-id.yaml", semDir), "utf8"));
  assert.match(checkStage(doc, ctx()).join("\n"), /duplicate step id "same"/);
});

test("a stage id that differs from its file name fails", () => {
  const dir = scratch({
    "workshop.yaml": workshopYaml("  - file: stages/a.yaml"),
    "stages/a.yaml": stageYaml("other"),
  });
  assert.match(validateWorkshop(dir).join("\n"), /id "other" does not match its file name/);
});

test("a markdown stage whose file is missing fails", () => {
  const dir = scratch({
    "workshop.yaml": workshopYaml("  - { id: stage-2, title: Two, markdown: stage-2.md }"),
  });
  assert.match(validateWorkshop(dir).join("\n"), /stage-2\.md does not exist/);
});

test("a stage file that is missing fails", () => {
  const dir = scratch({ "workshop.yaml": workshopYaml("  - file: stages/a.yaml") });
  assert.match(validateWorkshop(dir).join("\n"), /stages\/a\.yaml/);
});

test("a schema error in a stage is reported with the file name", () => {
  const dir = scratch({
    "workshop.yaml": workshopYaml("  - file: stages/a.yaml"),
    "stages/a.yaml": "format: kairos-workshop/v1\nid: a\ntitle: S\ngoal: do s\nsections:\n  - title: One\n",
  });
  assert.match(validateWorkshop(dir).join("\n"), /stages\/a\.yaml/);
});

test("duplicate stage ids in the workshop fail", () => {
  const dir = scratch({
    "workshop.yaml": workshopYaml("  - { id: same, title: A, markdown: a.md }\n  - { id: same, title: B, markdown: b.md }"),
    "a.md": "# a\n",
    "b.md": "# b\n",
  });
  assert.match(validateWorkshop(dir).join("\n"), /duplicate stage id "same"/);
});

test("a link from one converted stage to a section of another must resolve", () => {
  const dir = scratch({
    "workshop.yaml": workshopYaml("  - file: stages/a.yaml\n  - file: stages/b.yaml"),
    "stages/a.yaml": stageYaml("a", "    text: See [b](stage-2.md#nope).\n"),
    "stages/b.yaml": stageYaml("b"),
  });
  assert.match(validateWorkshop(dir).join("\n"), /no section "nope"/);
  const ok = scratch({
    "workshop.yaml": workshopYaml("  - file: stages/a.yaml\n  - file: stages/b.yaml"),
    "stages/a.yaml": stageYaml("a", "    text: See [b](stage-2.md#one).\n"),
    "stages/b.yaml": stageYaml("b"),
  });
  assert.deepEqual(validateWorkshop(ok), []);
});

test("raw HTML in the workshop intro fails", () => {
  const dir = scratch({
    "workshop.yaml": `format: kairos-workshop/v0\nid: t\ntitle: T\nrepository: kairos-io/t\nintro: "<b>hi</b>"\nstages:\n  - { id: s, title: S, markdown: s.md }\n`,
    "s.md": "# s\n",
  });
  assert.match(validateWorkshop(dir).join("\n"), /intro/);
});

test("the validate script exits 0 on this repository", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [join(root, "tools/validate.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("the validate script exits 1 on a broken tree", async () => {
  const { spawnSync } = await import("node:child_process");
  const dir = scratch({ "workshop.yaml": workshopYaml("  - file: stages/a.yaml") });
  const r = spawnSync(process.execPath, [join(root, "tools/validate.mjs"), dir], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /stages\/a\.yaml/);
});

// A1: goals.
test("every converted stage has a goal and stage 1 says what it is", () => {
  const loaded = loadWorkshop(root);
  assert.equal(loaded.stages[0].goal, "set up kairos-lab");
  assert.deepEqual(loaded.stages.map((s) => s.goal), [
    "set up kairos-lab",
    "boot a first node",
    "build an image",
    "build images automatically",
    "upgrade a node by hand",
    "write a cloud-config",
    "upgrade through Kubernetes",
  ]);
  for (const s of loaded.stages) assert.ok(s.goal.length <= 60 && !/[\n<>`*[\]]/.test(s.goal), s.id);
});

test("a goal of exactly 60 characters is accepted and 61 is rejected", () => {
  const base = parse(readFileSync(new URL("../conformance/v0/schema/valid/minimal.yaml", import.meta.url), "utf8"));
  assert.equal(validateStageSchema({ ...base, goal: "a".repeat(60) }).ok, true);
  assert.equal(validateStageSchema({ ...base, goal: "a".repeat(61) }).ok, false);
  assert.equal(validateStageSchema({ ...base, goal: "" }).ok, false);
});

// A2: slug ids and computed numbers.
test("stage ids are unique kebab-case slugs and the numbers are positions", () => {
  const loaded = loadWorkshop(root);
  assert.deepEqual(loaded.stages.map((s) => s.id), [
    "kairos-lab", "first-node", "build-image", "pipelines", "manual-upgrade", "multi-node", "operator-upgrade",
  ]);
  assert.equal(new Set(loaded.stages.map((s) => s.id)).size, loaded.stages.length);
  for (const s of loaded.stages) assert.match(s.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.deepEqual(loaded.stages.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7]);
  for (const s of loaded.stages) assert.ok(!/^Stage \d+:/.test(s.title), s.title);
});

test("a markdown stage title is what its file's first heading says, minus the number", () => {
  for (const s of loadWorkshop(root).stages.filter((x) => x.kind === "markdown")) {
    const heading = readFileSync(join(root, s.markdown), "utf8").split("\n").find((l) => l.startsWith("# "));
    assert.equal(heading, `# Stage ${s.n}: ${s.title}`);
  }
});

// A3: links by id.
const linked = (text, extra = "") => scratch({
  "workshop.yaml": workshopYaml("  - file: stages/a.yaml\n  - { id: md-stage, title: M, markdown: m.md }") + extra,
  "stages/a.yaml": stageYaml("a", `    text: ${JSON.stringify(text)}\n`),
  "m.md": "# M\n",
});

test("a link by id to a known stage is valid, with or without an anchor", () => {
  assert.deepEqual(validateWorkshop(linked("[x](stage:a) [y](stage:a#one) [z](stage:md-stage) [w](stage:md-stage#any-anchor)")), []);
});

test("a link by id to an unknown stage is rejected", () => {
  assert.match(validateWorkshop(linked("[x](stage:nope)")).join("\n"), /names the stage "nope", which does not exist/);
});

test("a link by id with an anchor a converted stage does not have is rejected", () => {
  assert.match(validateWorkshop(linked("[x](stage:a#two)")).join("\n"), /names no section "two" in stage "a"/);
});

test("a link by id is checked in every markdown field", () => {
  const doc = (field) => {
    const base = { format: "kairos-workshop/v0", id: "a", title: "S", goal: "do s", sections: [{ title: "One" }] };
    const bad = "[x](stage:nope)";
    if (field === "section.text") base.sections[0].text = bad;
    if (field === "section.warning") base.sections[0].warnings = [{ kind: "note", text: bad }];
    if (field === "step.after") base.sections[0].steps = [{ id: "s", commands: ["x"], after: bad }];
    if (field === "step.onFail") base.sections[0].steps = [{ id: "s", onFail: bad }];
    if (field === "variant.text") base.sections[0].steps = [{ id: "s", variants: [{ id: "v1", title: "V1", text: bad }, { id: "v2", title: "V2" }] }];
    return base;
  };
  for (const field of ["section.text", "section.warning", "step.after", "step.onFail", "variant.text"]) {
    assert.ok(checkStage(doc(field), buildContext(loadWorkshop(root), root)).length > 0, field);
  }
  const dir = scratch({
    "workshop.yaml": `format: kairos-workshop/v0\nid: t\ntitle: T\nrepository: kairos-io/t\nintro: "See [x](stage:nope)."\nstages:\n  - { id: s, title: S, markdown: s.md }\n`,
    "s.md": "# s\n",
  });
  assert.match(validateWorkshop(dir).join("\n"), /intro.*stage "nope"/);
});

test("a stage link that publishers cannot resolve is rejected", () => {
  assert.match(validateWorkshop(linked("[x][r]\n\n[r]: stage:a")).join("\n"), /write a stage link as/);
});

test("the stage 1 file links to stage 3 by id and no hard-coded stage-N.md link is left", () => {
  const text = readFileSync(join(root, "stages/kairos-lab.yaml"), "utf8");
  assert.ok(text.includes("(stage:build-image#alternative-using-podman-on-macos)"));
  assert.ok(!/\]\(stage-\d+\.md/.test(text));
});

// A4: fact values.
test("the virtualization values are kairos-lab and own, and every fact and option has a question and a label", async () => {
  const { FACT_DEFS, VALUES, LABELS } = await import("../tools/lib/facts.mjs");
  assert.deepEqual(VALUES.virtualization, ["kairos-lab", "own"]);
  assert.equal(LABELS.virtualization.own, "your own virtualization software");
  assert.equal(FACT_DEFS[0].question, "What runs your VMs?");
  assert.equal(FACT_DEFS[0].options[1].label, "My own software");
  for (const f of FACT_DEFS) {
    assert.ok(f.label && f.question, f.id);
    for (const o of f.options) assert.ok(o.id && o.label && o.phrase, `${f.id}/${o.id}`);
  }
});

// Welcome, loadout and prompts in workshop.yaml.
test("a workshop with a broken loadout fails validation with the file name", () => {
  const dir = scratch({
    "workshop.yaml": `format: kairos-workshop/v0\nid: t\ntitle: T\nrepository: kairos-io/t\nloadout:\n  questions:\n    - fact: os\n      title: Which?\n      options:\n        - { value: linux, label: Linux }\n        - { value: macos, label: macOS }\nstages:\n  - { id: s, title: S, markdown: s.md }\n`,
    "s.md": "# s\n",
  });
  assert.match(validateWorkshop(dir).join("\n"), /workshop\.yaml: loadout\.questions\[0\] \(os\): no option for the value "windows"/);
});

test("the real workshop has five welcome pages, four loadout questions and both prompts", () => {
  const { workshop } = loadWorkshop(root);
  assert.equal(workshop.welcome.pages.length, 5);
  assert.deepEqual(workshop.loadout.questions.map((q) => q.fact), ["os", "virtualization", "arch", "runtime"]);
  assert.deepEqual(Object.keys(workshop.prompts), ["step", "tip"]);
  assert.ok(workshop.welcome.pages[0].includes("{name}"));
  assert.ok(workshop.welcome.pages[4].includes("(https://www.spectrocloud.com/solutions/kairos-support)"));
});

test("the welcome, loadout and prompt copy has no em dash", () => {
  const { workshop } = loadWorkshop(root);
  assert.ok(!JSON.stringify([workshop.welcome, workshop.loadout, workshop.prompts]).includes("—"));
});

test("a stage help, tip and skip rule are normalized by the loader", () => {
  const raw = parse("format: kairos-workshop/v0\nid: t\ntitle: T\ngoal: try t\ntip: { when: { virtualization: own }, request: R }\nnot_skippable_when: { virtualization: kairos-lab }\nsections:\n  - title: S\n    text: x\n");
  const doc = normalizeStage(raw);
  assert.deepEqual(doc.tip, { when: { virtualization: ["own"] }, request: "R" });
  assert.deepEqual(doc.not_skippable_when, { virtualization: ["kairos-lab"] });
  const bare = normalizeStage(parse("format: kairos-workshop/v0\nid: t\ntitle: T\ngoal: try t\ntip: { request: R }\nsections:\n  - title: S\n    text: x\n"));
  assert.deepEqual(bare.tip, { request: "R" });
  assert.equal("not_skippable_when" in bare, false);
});
