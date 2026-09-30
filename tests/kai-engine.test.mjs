import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { view } from "../tools/lib/view.mjs";
import { evaluate } from "../tools/lib/when.mjs";
import { VALUES, FACTS } from "../tools/lib/facts.mjs";
import { loadWorkshop } from "../tools/lib/load.mjs";
import { compileWorkshop } from "../tools/lib/kai.mjs";
import { serialize } from "../tools/compile-kai.mjs";
import { E, web } from "./helpers/kai-engine.mjs";

const root = new URL("../", import.meta.url).pathname;

const stageDoc = parse(readFileSync(join(root, "stages/kairos-lab.yaml"), "utf8"));
const CALLOUT = { note: "note", tip: "note", important: "warning", warning: "warning", caution: "caution" };

// The facts the reader knows. Unset is "unsure" in the engine and absent in the view function.
function combos() {
  const out = [{}];
  for (const v of VALUES.virtualization) for (const o of VALUES.os) for (const a of VALUES.arch) for (const r of VALUES.runtime) out.push({ virtualization: v, os: o, arch: a, runtime: r });
  return out;
}
const engineFacts = (facts) => Object.fromEntries(FACTS.map((f) => [f, facts[f] ?? "unsure"]));

// What the game shows for stage 1: commands and callouts in reading order. `stacked` shows every
// option that matches, like the terminal, instead of one tab at a time.
function shownByEngine(facts) {
  const commands = [];
  const callouts = [];
  for (const step of E.steps("kairos-lab", engineFacts(facts))) {
    const rows = E.flatten(step.blocks, { key: `kairos-lab/${step.id}`, facts: engineFacts(facts), sel: {}, showAll: {}, layout: "stacked" });
    for (const r of rows) {
      if (r.type === "command" && !r.isFile) commands.push(r.code.trimEnd());
      if (r.type === "callout") callouts.push({ kind: r.kind, paras: r.paras });
    }
  }
  return { commands, callouts };
}

// What our own model says is visible: commands from the view function, callouts by walking the
// stage with the same when evaluator, in the same order.
function shownByModel(facts) {
  const commands = view(stageDoc, facts).filter((i) => i.kind === "command").map((i) => i.text.trimEnd());
  const callouts = [];
  const warn = (list) => {
    for (const w of list ?? []) if (evaluate(w.when, facts) !== "false") callouts.push({ kind: CALLOUT[w.kind], paras: E.md(w.text.trimEnd()) });
  };
  for (const s of stageDoc.sections) {
    if (evaluate(s.when, facts) === "false") continue;
    warn(s.warnings);
    for (const st of s.steps ?? []) {
      if (evaluate(st.when, facts) === "false") continue;
      warn(st.warnings);
      for (const v of st.variants ?? []) if (evaluate(v.when, facts) !== "false") warn(v.warnings);
    }
  }
  // The view function must agree on which warnings are visible.
  const kinds = view(stageDoc, facts).filter((i) => i.kind === "warning").map((i) => CALLOUT[i.warningKind]);
  assert.deepEqual(callouts.map((c) => c.kind), kinds);
  return { commands, callouts };
}

test("the engine loads the generated content and sees seven stages", () => {
  assert.deepEqual(E.stageIds(), ["kairos-lab", "first-node", "build-image", "pipelines", "manual-upgrade", "multi-node", "operator-upgrade"]);
  assert.equal(E.stage("kairos-lab").steps.length, 9);
});

test("the committed kai/web/content.json equals the compiler output", () => {
  const out = serialize(compileWorkshop(loadWorkshop(root), parse(readFileSync(join(root, "kai/lines.yaml"), "utf8"))));
  assert.equal(readFileSync(join(web, "content.json"), "utf8"), out);
});

const all = combos();
test("there are 25 fact sets: 24 combinations and the all-unset case", () => {
  assert.equal(all.length, 25);
});

let n = 0;
for (const facts of all) {
  n++;
  const name = Object.keys(facts).length ? FACTS.map((f) => facts[f]).join("/") : "no facts";
  test(`cross-check ${String(n).padStart(2, "0")}/25: ${name}`, () => {
    const game = shownByEngine(facts);
    const model = shownByModel(facts);
    assert.deepEqual(game.commands, model.commands, "visible commands, in order");
    assert.deepEqual(game.callouts, model.callouts, "visible callouts, in order");
  });
}

// Partly known setups: every subset of facts, each one unset or set.
test("cross-check of every partly known setup (108 fact sets, including the 25 above)", () => {
  const opt = (f) => [undefined, ...VALUES[f]];
  let count = 0;
  for (const v of opt("virtualization")) for (const o of opt("os")) for (const a of opt("arch")) for (const r of opt("runtime")) {
    const facts = Object.fromEntries(Object.entries({ virtualization: v, os: o, arch: a, runtime: r }).filter(([, x]) => x));
    const game = shownByEngine(facts);
    const model = shownByModel(facts);
    assert.deepEqual(game.commands, model.commands, JSON.stringify(facts));
    assert.deepEqual(game.callouts, model.callouts, JSON.stringify(facts));
    count++;
  }
  assert.equal(count, 108);
});

test("the cross-check is not vacuous: commands and callouts are found, and they differ between setups", () => {
  const a = shownByEngine({ virtualization: "kairos-lab", os: "macos", arch: "arm64", runtime: "docker" });
  const b = shownByEngine({ virtualization: "own", os: "linux", arch: "amd64", runtime: "podman" });
  assert.ok(a.commands.length >= 4 && b.commands.length >= 4);
  assert.notDeepEqual(a.commands, b.commands);
  assert.ok(a.callouts.length >= 1);
  assert.equal(shownByEngine({}).callouts.length, 4, "with no facts all four warnings show");
  assert.ok(shownByEngine({}).commands.length > a.commands.length);
});

test("the macOS warning about building AuroraBoot shows on macOS with your own software, even though the build steps are hidden", () => {
  const { callouts } = shownByEngine({ virtualization: "own", os: "macos", arch: "arm64", runtime: "docker" });
  assert.ok(callouts.some((c) => c.kind === "warning" && JSON.stringify(c.paras).includes("Do not build AuroraBoot on macOS")));
});
