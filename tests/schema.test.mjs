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
