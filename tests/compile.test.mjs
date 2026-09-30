import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { githubSlug } from "../tools/lib/slug.mjs";
import { loadWorkshop, normalizeWhen } from "../tools/lib/load.mjs";
import { validateWorkshop, checkStage } from "../tools/validate.mjs";
import { validateStageSchema } from "../tools/lib/schema.mjs";

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
  `format: kairos-workshop/v0\nid: ${id}\ntitle: S\nsections:\n  - title: One\n${extra}`;

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
  const stage1 = loaded.stages.find((s) => s.id === "stage-1");
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
  const stage1 = readFileSync(join(root, "stages/stage-1.yaml"), "utf8");
  assert.ok(stage1.includes("stage-3.md#alternative-using-podman-on-macos"));
});

test("scalar when is normalized to a list", () => {
  assert.deepEqual(normalizeWhen({ os: "macos", runtime: ["docker", "podman"] }), { os: ["macos"], runtime: ["docker", "podman"] });
  assert.equal(normalizeWhen(undefined), undefined);
});

test("the loader normalizes every when in stage 1", () => {
  const stage1 = loadWorkshop(root).stages.find((s) => s.id === "stage-1");
  const homebrew = stage1.doc.sections[1].steps[0].variants[0];
  assert.deepEqual(homebrew.when, { os: ["macos"] });
  assert.deepEqual(stage1.doc.sections[1].when, { virtualization: ["kairos-lab"] });
});

test("the loader computes next links and referenced facts", () => {
  const loaded = loadWorkshop(root);
  const [one, two, , , , , seven] = loaded.stages;
  assert.equal(one.kind, "converted");
  assert.equal(two.kind, "markdown");
  assert.deepEqual(one.next, { id: "stage-2", title: "Stage 2: Deploying a single node cluster", file: "stage-2.md", converted: false });
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
  assert.deepEqual(loaded.stages[0].next, { id: "b", title: "S", file: "b.md", converted: true });
});

// Semantic errors: each rule has a test that makes it fail.
const semDir = new URL("../conformance/v0/semantic/", import.meta.url);
const ctx = () => ({ root, converted: new Map(loadWorkshop(root).stages.filter((s) => s.kind === "converted").map((s) => [`${s.id}.md`, new Set(s.slugs)])) });

for (const f of readdirSync(new URL("invalid/", semDir)).filter((n) => n.endsWith(".yaml")).sort()) {
  test(`semantic invalid: ${f}`, () => {
    const text = readFileSync(new URL(`invalid/${f}`, semDir), "utf8");
    assert.match(text.split("\n")[0], /^# expect-error: \S/);
    const doc = parse(text);
    assert.equal(validateStageSchema(doc).ok, true, "a semantic fixture must pass the schema");
    assert.ok(checkStage(doc, ctx()).length > 0, "the semantic rules must reject this file");
  });
}

for (const f of readdirSync(new URL("valid/", semDir)).filter((n) => n.endsWith(".yaml")).sort()) {
  test(`semantic valid: ${f}`, () => {
    const doc = parse(readFileSync(new URL(`valid/${f}`, semDir), "utf8"));
    assert.deepEqual(checkStage(doc, ctx()), []);
  });
}

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
    "stages/a.yaml": "format: kairos-workshop/v1\nid: a\ntitle: S\nsections:\n  - title: One\n",
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
    "stages/a.yaml": stageYaml("a", "    text: See [b](b.md#nope).\n"),
    "stages/b.yaml": stageYaml("b"),
  });
  assert.match(validateWorkshop(dir).join("\n"), /no section "nope"/);
  const ok = scratch({
    "workshop.yaml": workshopYaml("  - file: stages/a.yaml\n  - file: stages/b.yaml"),
    "stages/a.yaml": stageYaml("a", "    text: See [b](b.md#one).\n"),
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
