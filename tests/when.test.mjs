import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate } from "../tools/lib/when.mjs";

const fixture = JSON.parse(readFileSync(new URL("../conformance/v0/when.json", import.meta.url), "utf8"));

test("when.json has the minimum number of rows", () => {
  assert.ok(fixture.rows.length >= 12);
});

for (const row of fixture.rows) {
  test(`when.json: ${row.name}`, () => {
    assert.equal(evaluate(row.when ?? undefined, row.facts), row.result);
  });
}

test("every result is one of the three values", () => {
  for (const row of fixture.rows) assert.ok(["true", "false", "unknown"].includes(row.result), row.name);
});

test("evaluate tolerates missing facts", () => {
  assert.equal(evaluate({ os: "linux" }, undefined), "unknown");
});
