import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";
import { view } from "../tools/lib/view.mjs";
import { normalizeStage } from "../tools/lib/load.mjs";
import { validateStageSchema } from "../tools/lib/schema.mjs";
import { checkStage } from "../tools/validate.mjs";
import { loadWorkshop } from "../tools/lib/load.mjs";
import { buildContext } from "../tools/validate.mjs";

const root = new URL("../", import.meta.url);
const viewDir = new URL("conformance/v0/view/", root);
const cases = readdirSync(viewDir).filter((f) => f.endsWith(".json")).sort();
const readCase = (f) => JSON.parse(readFileSync(new URL(f, viewDir), "utf8"));
const loadStage = (path) => parse(readFileSync(new URL(path, root), "utf8"));

test("the view directory has the five stage 1 cases and the synthetic cases", () => {
  const stage1 = cases.filter((f) => f.startsWith("stage-1-"));
  assert.equal(stage1.length, 5);
  assert.ok(cases.some((f) => f.startsWith("synthetic-expect")));
  assert.ok(cases.some((f) => f.startsWith("synthetic-variants-no-when")));
  assert.ok(cases.some((f) => f.startsWith("synthetic-step-when")));
  assert.ok(cases.some((f) => f.startsWith("synthetic-warning-when")));
});

for (const f of cases) {
  test(`view: ${f}`, () => {
    const c = readCase(f);
    assert.deepEqual(Object.keys(c).sort(), ["expect", "facts", "stage"]);
    const doc = loadStage(c.stage);
    assert.equal(validateStageSchema(doc).ok, true);
    assert.deepEqual(view(doc, c.facts), c.expect);
    // A reader that gets normalized input must give the same outline.
    assert.deepEqual(view(normalizeStage(doc), c.facts), c.expect);
  });
}

test("every item has a known kind and the right fields", () => {
  const shapes = {
    section: ["kind", "state", "title"],
    step: ["id", "kind", "state"],
    variant: ["id", "kind", "state"],
    warning: ["kind", "state", "warningKind"],
    command: ["kind", "text"],
    expect: ["kind"],
    check: ["checkKind", "kind"],
    "no-match": ["kind", "step"],
  };
  for (const f of cases) {
    for (const item of readCase(f).expect) {
      assert.ok(shapes[item.kind], `${f}: unknown kind ${item.kind}`);
      assert.deepEqual(Object.keys(item).sort(), shapes[item.kind], `${f}: ${JSON.stringify(item)}`);
      if (item.state) assert.ok(["shown", "conditional"].includes(item.state));
    }
  }
});

test("stage 1 fixture files agree with the stage file", () => {
  const items = readCase("stage-1-no-facts.json").expect;
  const titles = items.filter((i) => i.kind === "section").map((i) => i.title);
  assert.deepEqual(titles, loadStage("stages/kairos-lab.yaml").sections.map((s) => s.title));
});

// Independent checks that do not depend on the expected files.
const ids = (facts, kind, stage = "stages/kairos-lab.yaml") => view(loadStage(stage), facts).filter((i) => i.kind === kind);

test("with no facts every command of stage 1 is present", () => {
  const doc = loadStage("stages/kairos-lab.yaml");
  const want = [];
  for (const s of doc.sections) for (const st of s.steps ?? []) {
    want.push(...(st.commands ?? []));
    for (const v of st.variants ?? []) want.push(...(v.commands ?? []));
  }
  assert.deepEqual(ids({}, "command").map((i) => i.text), want);
});

test("macos with kairos-lab and docker shows homebrew and hides the podman variant", () => {
  const facts = { os: "macos", virtualization: "kairos-lab", runtime: "docker" };
  const variants = ids(facts, "variant").map((i) => i.id);
  assert.ok(variants.includes("homebrew"));
  assert.ok(!variants.includes("install-script"));
  assert.ok(!variants.includes("podman"));
  assert.ok(!ids(facts, "section").some((s) => s.title.startsWith("Not using")));
});

test("windows with kairos-lab shows the caution and no install option", () => {
  const facts = { os: "windows", virtualization: "kairos-lab" };
  assert.deepEqual(ids(facts, "no-match"), [{ kind: "no-match", step: "install-kairos-lab" }]);
  assert.equal(ids(facts, "warning")[0].warningKind, "caution");
});

test("a warning for macos is hidden on linux and the whole section still shows", () => {
  const facts = { os: "linux", virtualization: "own", runtime: "docker" };
  const items = view(loadStage("stages/kairos-lab.yaml"), facts);
  assert.ok(items.some((i) => i.kind === "section" && i.title === "Build it locally (Linux only)"));
  assert.ok(!items.some((i) => i.kind === "warning"));
});

test("unknown facts give conditional items and known facts give shown items", () => {
  const items = view(loadStage("stages/kairos-lab.yaml"), { os: "linux", virtualization: "own" });
  const build = items.find((i) => i.kind === "step" && i.id === "build-auroraboot");
  assert.equal(build.state, "shown");
  const docker = items.find((i) => i.kind === "variant" && i.id === "docker");
  assert.equal(docker.state, "conditional");
});

test("the outline is the same for two runs", () => {
  const doc = loadStage("stages/kairos-lab.yaml");
  assert.deepEqual(view(doc, {}), view(doc, {}));
});

// The synthetic fixture stages must themselves be valid.
test("synthetic fixtures pass the schema and the semantic rules", () => {
  const ctx = buildContext(loadWorkshop(root.pathname), root.pathname);
  for (const f of readdirSync(new URL("conformance/v0/fixtures/", root)).filter((n) => n.startsWith("synthetic-"))) {
    const doc = loadStage(`conformance/v0/fixtures/${f}`);
    assert.equal(validateStageSchema(doc).ok, true, f);
    assert.deepEqual(checkStage(doc, ctx), [], f);
  }
});
