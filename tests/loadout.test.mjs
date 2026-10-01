import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";
import { nextQuestion, applyAnswer } from "../tools/lib/loadout.mjs";

const root = new URL("../", import.meta.url);
const workshop = parse(readFileSync(new URL("workshop.yaml", root), "utf8"));
const loadout = workshop.loadout;
const dir = new URL("conformance/v0/loadout/", root);
const cases = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

test("there are at least eight loadout cases", () => {
  assert.ok(cases.length >= 8);
});

for (const f of cases) {
  test(`loadout: ${f}`, () => {
    const c = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    assert.deepEqual(Object.keys(c).sort(), ["answers", "description", "expect"]);
    assert.deepEqual(Object.keys(c.expect).sort(), ["answers", "next"]);
    let answers = {};
    for (const [fact, value] of c.answers) {
      // The flow must ask for this fact at this point.
      assert.equal(nextQuestion(loadout, answers)?.fact, fact, `${f}: ${fact} is not the next question`);
      answers = applyAnswer(loadout, answers, fact, value);
    }
    assert.equal(nextQuestion(loadout, answers)?.fact ?? null, c.expect.next);
    assert.deepEqual(answers, c.expect.answers);
  });
}

test("the questions come in the order of the list", () => {
  assert.deepEqual(loadout.questions.map((q) => q.fact), ["os", "virtualization", "arch", "runtime"]);
});

test("applyAnswer does not change the answers it is given", () => {
  const before = { os: "linux" };
  const after = applyAnswer(loadout, before, "virtualization", "own");
  assert.deepEqual(before, { os: "linux" });
  assert.deepEqual(after, { os: "linux", virtualization: "own" });
});

test("applyAnswer adds the forces of the chosen option", () => {
  assert.deepEqual(applyAnswer(loadout, {}, "os", "windows"), { os: "windows", virtualization: "own" });
  assert.deepEqual(applyAnswer(loadout, {}, "os", "linux"), { os: "linux" });
});

test("applyAnswer rejects a fact the loadout does not ask and a value the question does not offer", () => {
  assert.throws(() => applyAnswer(loadout, {}, "colour", "red"), /colour/);
  assert.throws(() => applyAnswer(loadout, {}, "os", "beos"), /beos/);
});

test("a question with a condition is not asked while the fact it depends on is unanswered", () => {
  // `os` is not answered, so the questions that need it wait.
  assert.equal(nextQuestion(loadout, {}).fact, "os");
  const only = { questions: loadout.questions.filter((q) => q.fact !== "os") };
  assert.equal(nextQuestion(only, {}), null, "every remaining question needs os, which is unknown");
});

test("a question whose condition is false is skipped and the next one is asked", () => {
  const l = {
    questions: [
      { fact: "os", title: "T", options: [{ value: "linux", label: "L" }, { value: "macos", label: "M" }, { value: "windows", label: "W" }] },
      { fact: "virtualization", title: "T", when: { os: "macos" }, options: [{ value: "kairos-lab", label: "Z" }, { value: "own", label: "M" }] },
      { fact: "arch", title: "T", options: [{ value: "amd64", label: "a" }, { value: "arm64", label: "b" }] },
    ],
  };
  assert.equal(nextQuestion(l, { os: "linux" }).fact, "arch");
  assert.equal(nextQuestion(l, { os: "macos" }).fact, "virtualization");
});

test("a forced fact counts as answered and is not asked again", () => {
  const l = {
    questions: [
      { fact: "os", title: "T", options: [{ value: "linux", label: "L" }, { value: "windows", label: "W", forces: { virtualization: "own" } }] },
      { fact: "virtualization", title: "T", options: [{ value: "kairos-lab", label: "Z" }, { value: "own", label: "M" }] },
      { fact: "arch", title: "T", options: [{ value: "amd64", label: "a" }, { value: "arm64", label: "b" }] },
    ],
  };
  assert.equal(nextQuestion(l, { os: "linux" }).fact, "virtualization");
  assert.equal(nextQuestion(l, applyAnswer(l, {}, "os", "windows")).fact, "arch");
});

test("an ends option stops the flow even when later questions have no condition", () => {
  const l = {
    questions: [
      { fact: "os", title: "T", options: [{ value: "linux", label: "L" }, { value: "macos", label: "M" }, { value: "windows", label: "W", ends: true }] },
      { fact: "arch", title: "T", options: [{ value: "amd64", label: "a" }, { value: "arm64", label: "b" }] },
    ],
  };
  assert.equal(nextQuestion(l, { os: "linux" }).fact, "arch");
  assert.equal(nextQuestion(l, { os: "windows" }), null);
});

test("an ends option does not hide a question that comes before it and is still unanswered", () => {
  const l = {
    questions: [
      { fact: "os", title: "T", options: [{ value: "linux", label: "L" }, { value: "macos", label: "M" }] },
      { fact: "arch", title: "T", options: [{ value: "amd64", label: "a" }, { value: "arm64", label: "b", ends: true }] },
    ],
  };
  // os is asked first even if arch was answered out of order.
  assert.equal(nextQuestion(l, { arch: "arm64" }).fact, "os");
  assert.equal(nextQuestion(l, { arch: "arm64", os: "linux" }), null);
});
