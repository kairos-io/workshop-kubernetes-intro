import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";
import { validateStageSchema, validateWorkshopSchema } from "../tools/lib/schema.mjs";

const dir = new URL("../conformance/v0/schema/", import.meta.url);
const files = (kind) => readdirSync(new URL(`${kind}/`, dir)).filter((f) => f.endsWith(".yaml")).sort();
const load = (kind, f) => readFileSync(new URL(`${kind}/${f}`, dir), "utf8");
// Files named workshop-*.yaml are workshop indexes. Every other file is a stage.
const check = (f, doc) => (f.startsWith("workshop-") ? validateWorkshopSchema(doc) : validateStageSchema(doc));

test("there are valid and invalid fixtures", () => {
  assert.ok(files("valid").length >= 3);
  assert.ok(files("invalid").length >= 10);
});

for (const f of files("valid")) {
  test(`valid: ${f}`, () => {
    const result = check(f, parse(load("valid", f)));
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });
}

for (const f of files("invalid")) {
  test(`invalid: ${f}`, () => {
    const text = load("invalid", f);
    assert.match(text.split("\n")[0], /^# expect-error: \S/, "first line must state the expected error");
    const result = check(f, parse(text));
    assert.equal(result.ok, false, "the schema must reject this file");
    assert.ok(result.errors.length > 0);
  });
}

test("the schemas compile in strict mode", () => {
  assert.equal(validateStageSchema({}).ok, false);
  assert.equal(validateWorkshopSchema({}).ok, false);
});

test("a skip rule needs its reason, and a reason needs its rule", () => {
  const errorsOf = (f) => validateStageSchema(parse(load("invalid", f))).errors.join("\n");
  assert.match(errorsOf("not-skippable-reason-missing.yaml"), /must have property not_skippable_reason when property not_skippable_when is present/);
  assert.match(errorsOf("not-skippable-reason-without-when.yaml"), /must have property not_skippable_when when property not_skippable_reason is present/);
  assert.match(errorsOf("not-skippable-reason-too-long.yaml"), /not_skippable_reason must NOT have more than 160 characters/);
  assert.match(errorsOf("not-skippable-reason-markup.yaml"), /not_skippable_reason must match pattern/);
});

test("a reason of 160 characters is valid", () => {
  const doc = parse(load("valid", "full.yaml"));
  doc.not_skippable_reason = "x".repeat(160);
  assert.equal(validateStageSchema(doc).ok, true);
  doc.not_skippable_reason = "x".repeat(161);
  assert.equal(validateStageSchema(doc).ok, false);
});

test("verify is optional, belongs to a check, and needs one line of command", () => {
  const errorsOf = (f) => validateStageSchema(parse(load("invalid", f))).errors.join("\n");
  assert.match(errorsOf("verify-without-check.yaml"), /must NOT have additional properties/);
  assert.match(errorsOf("verify-without-command.yaml"), /must have required property 'command'/);
  assert.match(errorsOf("verify-multiline-command.yaml"), /command must match pattern/);
  assert.match(errorsOf("verify-unknown-key.yaml"), /must NOT have additional properties/);
  assert.match(errorsOf("verify-empty-output.yaml"), /output must NOT have fewer than 1 characters/);
  const doc = parse(load("valid", "full.yaml"));
  const checks = doc.sections.flatMap((s) => s.steps ?? []).map((st) => st.check).filter(Boolean);
  assert.ok(checks.some((c) => c.verify?.output) && checks.some((c) => c.verify && c.verify.output === undefined), "full.yaml has a verify with and without output");
});

test("a manual check needs its text: one plain line of at most 160 characters", () => {
  const errorsOf = (f) => validateStageSchema(parse(load("invalid", f))).errors.join("\n");
  assert.match(errorsOf("manual-without-text.yaml"), /must have required property 'text'/);
  assert.match(errorsOf("manual-text-too-long.yaml"), /text must NOT have more than 160 characters/);
  assert.match(errorsOf("manual-unknown-key.yaml"), /must NOT have additional properties/);
  assert.match(errorsOf("manual-text-markdown.yaml"), /text must match pattern/);
  const doc = parse(load("valid", "full.yaml"));
  const manual = doc.sections.flatMap((s) => s.steps ?? []).map((st) => st.check).filter((c) => c?.kind === "manual");
  assert.ok(manual.some((c) => c.verify) && manual.some((c) => !c.verify), "full.yaml has a manual check with and without verify");
});
