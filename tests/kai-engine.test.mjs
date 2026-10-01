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
import { serialize, compileRootFiles } from "../tools/compile-kai.mjs";
import { nextQuestion, applyAnswer } from "../tools/lib/loadout.mjs";
import { buildStepPrompt, buildTipPrompt } from "../tools/lib/prompt.mjs";
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
      if (r.type === "callout") callouts.push({ kind: r.kind, blocks: r.blocks });
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
    for (const w of list ?? []) if (evaluate(w.when, facts) !== "false") callouts.push({ kind: CALLOUT[w.kind], blocks: E.md(w.text.trimEnd()) });
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

test("the committed kai/web/theme.json equals the compiler output", () => {
  const files = compileRootFiles(root);
  assert.equal(readFileSync(join(web, "theme.json"), "utf8"), files.theme);
});

test("the engine loads the generated content and sees seven stages", () => {
  assert.deepEqual(E.stageIds(), ["kairos-lab", "first-node", "build-image", "pipelines", "manual-upgrade", "multi-node", "operator-upgrade"]);
  assert.equal(E.stage("kairos-lab").steps.length, 8);
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
  assert.ok(callouts.some((c) => c.kind === "warning" && JSON.stringify(c.blocks).includes("Do not build AuroraBoot on macOS")));
});

// ---- the loadout: the reader asks the same questions as tools/lib/loadout.mjs ----

const workshop = loadWorkshop(root).workshop;
const loadout = workshop.loadout;
const factIds = (list) => list.filter((r) => r.type === "fact").map((r) => r.id);

// Every complete path through the loadout, by our reference functions. At every state on the way,
// `visit(answers, asked, next)` is called: the answers so far, the facts asked so far, and the next question.
function walkLoadout(visit) {
  const done = [];
  const walk = (answers, asked) => {
    const next = nextQuestion(loadout, answers);
    visit(answers, asked, next);
    if (!next) return void done.push({ answers, asked });
    for (const o of next.options) walk(applyAnswer(loadout, answers, next.fact, o.value), [...asked, next.fact]);
  };
  walk({}, []);
  return done;
}

test("loadout: the reader asks the same facts, in the same order, as nextQuestion on every answer path", () => {
  let states = 0;
  const paths = walkLoadout((answers, asked, next) => {
    states++;
    const reader = E.loadoutQuestions(engineFacts(answers));
    // The reader lists the questions that the answers so far allow, so it may list ones that come later.
    // The first ones are the facts asked so far and the next one.
    assert.deepEqual(factIds(reader).slice(0, asked.length + (next ? 1 : 0)), [...asked, ...(next ? [next.fact] : [])], JSON.stringify(answers));
  });
  assert.equal(paths.length, 17, "16 paths for Linux and macOS, and one for Windows");
  assert.ok(states > 17);
  for (const { answers, asked } of paths) {
    const reader = E.loadoutQuestions(engineFacts(answers));
    assert.deepEqual(factIds(reader), asked, `at the end of ${JSON.stringify(answers)} the reader asks nothing more`);
    // A notice follows the answer of an option that ends the flow, and only that one.
    const notices = reader.filter((r) => r.type === "notice");
    const ending = loadout.questions.flatMap((q) => q.options.filter((o) => o.ends && answers[q.fact] === o.value));
    assert.deepEqual(notices.map((n) => n.id), ending.map((o) => o.value));
  }
});

test("loadout: applying an answer sets the same facts in the reader as in applyAnswer, and Windows forces Master and ends the flow", () => {
  walkLoadout((answers, _asked, next) => {
    if (!next) return;
    for (const o of next.options) {
      assert.deepEqual(E.withFact(engineFacts(answers), next.fact, o.value), engineFacts(applyAnswer(loadout, answers, next.fact, o.value)), `${JSON.stringify(answers)} + ${next.fact}=${o.value}`);
    }
  });
  const win = applyAnswer(loadout, {}, "os", "windows");
  assert.deepEqual(win, { os: "windows", virtualization: "own" });
  assert.equal(nextQuestion(loadout, win), null, "Windows ends the flow");
  const fromReader = E.withFact(E.defaultFacts(), "os", "windows");
  assert.equal(fromReader.virtualization, "own");
  assert.equal(E.freeTextFact(fromReader), "virtualization", "the forced answer is the one that needs a free text");
  assert.equal(E.tipFor({ facts: fromReader }, "kairos-lab"), true, "own virtualization is offered the TIP");
  assert.deepEqual(E.loadoutQuestions(fromReader), [{ type: "fact", id: "os" }, { type: "notice", id: "windows", fact: "os" }]);
});

test("loadout: the reader clears the answers that a changed answer makes impossible", () => {
  const all = engineFacts({ os: "linux", virtualization: "kairos-lab", arch: "amd64", runtime: "docker" });
  const win = E.withFact(all, "os", "windows");
  assert.deepEqual(win, { os: "windows", virtualization: "own", arch: "unsure", runtime: "unsure" });
  const back = E.withFact(win, "os", "macos");
  assert.deepEqual(back.virtualization, "unsure", "the forced answer goes when Windows goes");
});

test("loadout: the reader finds the question texts of every fact in the theme we generate", () => {
  const theme = E.W.loadout;
  for (const f of E.C.facts) {
    const q = theme.questions[f.id];
    assert.ok(q, `theme.loadout.questions.${f.id}`);
    assert.equal(q.title, f.question, "the title in the theme and the question in the content are the same text");
    for (const o of f.options) assert.ok(o.id in q.options, `${f.id}/${o.id}`);
    for (const o of f.options.filter((x) => x.notice)) assert.ok(theme.notices[o.notice], o.notice);
  }
  assert.equal(E.W.welcome.pages.length, workshop.welcome.pages.length);
});

// ---- skipping ----

test("skipping: the reader gives the reason for Zen, and nothing for Master or when virtualization is not set", () => {
  const reason = "You play Zen, so every later stage uses kairos-lab. Set it up first.";
  const zen = { facts: engineFacts({ virtualization: "kairos-lab", os: "linux" }) };
  assert.equal(E.skipBlock(zen, "kairos-lab"), reason);
  assert.equal(E.skipBlock(zen, "kairos-lab"), E.stage("kairos-lab").noSkip.reason);
  assert.equal(E.skipBlock({ facts: engineFacts({ virtualization: "own", os: "linux" }) }, "kairos-lab"), "");
  assert.equal(E.skipBlock({ facts: engineFacts({}) }, "kairos-lab"), "", "unset is conditional, so skipping is the reader's choice");
  assert.equal(E.skipBlock(zen, "first-node"), "", "a stage without a skip rule can always be skipped");
  assert.equal(E.skipBlock({ facts: engineFacts({ virtualization: "kairos-lab" }) }, "kairos-lab"), reason);
});

// ---- help prompts: the reader's prompt for stage 1 against buildStepPrompt and buildTipPrompt ----

const fullyAnswered = combos().slice(1);
const progress = (facts) => ({ facts: engineFacts(facts), virtName: "" });

// A prompt as sections: the lines before the commands, the commands, the expected line, and the rest.
function sections(text) {
  const lines = text.split("\n");
  const ran = lines.indexOf("What I ran:");
  const expected = lines.findIndex((l) => l.startsWith("What I expected: "));
  assert.ok(ran > 0 && expected > ran, text);
  return { head: lines.slice(0, ran + 1), commands: lines.slice(ran + 1, expected), expected: lines[expected], tail: lines.slice(expected + 1) };
}
const stripPrompt = (lines) => lines.map((l) => l.replace(/^\$ /, "")).filter((l) => l !== "");

test("prompts: for every answered fact set the reader's step prompt, built from the step help, says what ours says, apart from the command prompt", () => {
  const stage = stageDoc;
  const docs = stageDoc.sections.flatMap((x) => x.steps ?? []);
  let compared = 0;
  let ownTool = 0;
  let manual = 0;
  let withCommands = 0;
  for (const facts of fullyAnswered) {
    const shown = E.steps("kairos-lab", engineFacts(facts));
    for (const step of shown.filter((s) => s.help)) {
      const ours = buildStepPrompt(workshop, stage, step.id, facts);
      assert.ok(ours, `${step.id} has a prompt for ${JSON.stringify(facts)}`);
      const reader = E.prompt("fail", progress(facts), "kairos-lab", step);
      const a = sections(reader);
      const b = sections(ours);
      compared++;

      // The step help in content.json holds the tool, source and docs with the stage defaults merged in, and the
      // reader reads them from the step. The lines before the commands are the same, including the tool line.
      assert.deepEqual(a.head, b.head, `${step.id}: lines before the commands`);
      const doc = docs.find((x) => x.id === step.id);
      const toolLine = b.head.find((l) => l.startsWith("Tool: "));
      assert.equal(toolLine, `Tool: ${step.help.tool} (${step.help.source}). Docs: ${step.help.docs}.`, "the tool line is the step help");
      if (doc.help.tool) {
        ownTool++;
        assert.match(toolLine, /^Tool: AuroraBoot /, "a step that names its own tool");
      }
      assert.ok(b.head.some((l) => l === `Goal of this step: ${step.goal}.`), "the goal is the goal of the step");

      // The commands are the same. We start each command line with "$ ", the reader does not, and it
      // separates commands with a blank line.
      assert.deepEqual(stripPrompt(a.commands), stripPrompt(b.commands), `${step.id} commands`);
      if (b.commands[0] === "(this step has no commands)") assert.deepEqual(a.commands, b.commands);
      else {
        withCommands++;
        assert.ok(b.commands[0].startsWith("$ "), "ours starts a command with $ ");
        assert.ok(!a.commands[0].startsWith("$ "));
      }

      // The expected line is help.expect, so it is the same text. A step with no named check says
      // "the step finishes without errors", where the reader used to say "You finished this step.".
      assert.equal(a.expected, `What I expected: ${step.help.expect}`);
      assert.equal(a.expected, b.expected);
      if (step.check.kind === "manual") {
        manual++;
        assert.equal(a.expected, "What I expected: the step finishes without errors");
        assert.notEqual(step.check.prompt, step.help.expect);
      }
      assert.deepEqual(a.tail, b.tail, `${step.id} tail`);
    }
    // A step that the facts hide has no prompt of ours, and the reader does not list it.
    for (const doc of docs.filter((x) => x.help)) {
      if (!shown.some((x) => x.id === doc.id)) assert.equal(buildStepPrompt(workshop, stage, doc.id, facts), null, `${doc.id} is hidden for ${JSON.stringify(facts)}`);
    }
  }
  assert.ok(compared >= 60, `compared ${compared} prompts`);
  assert.ok(ownTool > 0 && manual > 0 && withCommands > 30, "the cases were seen");
});

test("prompts: every stage 1 step that has help is read by the reader from the step, and the step help is complete", () => {
  const withHelp = E.stage("kairos-lab").steps.filter((s) => s.help);
  const docs = stageDoc.sections.flatMap((x) => x.steps ?? []).filter((x) => x.help);
  assert.equal(withHelp.length, docs.length);
  assert.ok(withHelp.length >= 7);
  for (const s of withHelp) {
    assert.deepEqual(Object.keys(s.help), ["tool", "source", "docs", "expect"]);
    const h = E.stepHelp(s);
    assert.equal(h.has, true);
    assert.deepEqual({ tool: h.tool, source: h.source, docs: h.docs, expect: h.expect }, s.help);
  }
});

test("verify: the reader reads the check verify of each step from content.json, and a step with none gets nothing", () => {
  const steps = E.stage("kairos-lab").steps;
  const byId = Object.fromEntries(steps.map((s) => [s.id, E.stepVerify(s)]));
  assert.deepEqual(byId["install-kairos-lab"], { has: true, command: "kairos-lab --version", output: "0.1.3", hasOutput: true });
  assert.deepEqual(byId["auroraboot-version"], { has: true, command: "auroraboot --version", output: "", hasOutput: false });
  assert.deepEqual(byId["pull-auroraboot"], { has: false, command: "", output: "", hasOutput: false });
  assert.equal(E.stepVerify(undefined).has, false);
});

test("prompts: a step with no help has no prompt of ours, and the reader drops the lines that need a tool and docs", () => {
  const bare = E.stage("kairos-lab").steps.find((s) => !s.help);
  assert.ok(bare, "stage 1 has a step without help");
  assert.equal(E.stepHelp(bare).has, false);
  const facts = { os: "linux", arch: "amd64", runtime: "docker", virtualization: "own" };
  const text = E.prompt("fail", progress(facts), "kairos-lab", bare);
  assert.doesNotMatch(text, /^Tool: /m);
  assert.doesNotMatch(text, /\(\)\./);
  assert.ok(text.split("\n").includes(`Goal of this step: ${bare.title}.`), "the title of the step stands in for the goal");
  assert.match(text, /^What I expected: .+$/m);
});

test("prompts: the reader writes the output of the step before the check sentence only when the step has no help", () => {
  const step = { id: "t", title: "T", goal: "g", blocks: [{ type: "command", code: "echo hi" }, { type: "output", text: "hi" }], check: { prompt: "It says hi.", fail: [] } };
  const lines = E.prompt("fail", progress({ os: "linux", arch: "amd64", runtime: "docker", virtualization: "kairos-lab" }), "kairos-lab", step).split("\n");
  assert.ok(lines.includes("What I expected: It says hi."), lines.join("\n"));
  assert.ok(!lines.some((l) => l.startsWith("(")), "the output block is not written any more");
  const helped = { ...step, help: { tool: "t", source: "https://example.com", docs: "https://example.com/d", expect: "it says hi" } };
  assert.ok(E.prompt("fail", progress({ os: "linux", arch: "amd64", runtime: "docker", virtualization: "kairos-lab" }), "kairos-lab", helped).split("\n").includes("What I expected: it says hi"));
});

test("prompts: for every answered fact set the tip prompt is the same text", () => {
  for (const facts of fullyAnswered) {
    assert.equal(E.prompt("tip", progress(facts), "kairos-lab"), buildTipPrompt(workshop, stageDoc, facts), JSON.stringify(facts));
  }
});

// ---- the TIP: who is offered it ----

// Our rule (SPEC, "Stage tip"): the `when` of the tip, `{ virtualization: own }` by default, is offered when
// it evaluates to true or unknown, and hidden when it evaluates to false.
const tipRule = (doc, facts) => evaluate(doc.tip.when ?? { virtualization: "own" }, facts) !== "false";
const virtualizations = ["kairos-lab", "own", undefined];
const tipCases = () => {
  const out = [];
  for (const virtualization of virtualizations) for (const os of [undefined, ...VALUES.os]) for (const arch of [undefined, ...VALUES.arch]) for (const runtime of [undefined, ...VALUES.runtime]) {
    out.push(Object.fromEntries(Object.entries({ virtualization, os, arch, runtime }).filter(([, v]) => v !== undefined)));
  }
  return out;
};

test("tip: the reader offers the stage TIP exactly when our rule does, in every case, including an unset virtualization", () => {
  let own = 0;
  let zen = 0;
  let unset = 0;
  for (const facts of tipCases()) {
    const reader = E.tipFor(progress(facts), "kairos-lab");
    assert.equal(reader, tipRule(stageDoc, facts), JSON.stringify(facts));
    if (facts.virtualization === "own") {
      own++;
      assert.equal(reader, true);
    } else if (facts.virtualization === "kairos-lab") {
      zen++;
      assert.equal(reader, false);
    } else {
      unset++;
      assert.equal(reader, true, "an unset virtualization is offered the TIP, as SPEC says");
    }
  }
  assert.ok(own >= 20 && zen >= 20 && unset >= 20, `${own} own, ${zen} kairos-lab, ${unset} unset cases`);
});

test("tip: a fact of tipOnly that is unset or unsure counts as a match, and a fact set to another value does not", () => {
  const unsure = progress({}).facts;
  for (const k of Object.keys(unsure)) assert.equal(unsure[k], "unsure", `${k} starts as unsure`);
  assert.equal(E.tipFor({ facts: unsure }, "kairos-lab"), true, "unsure virtualization");
  assert.equal(E.tipFor({ facts: {} }, "kairos-lab"), true, "no facts at all");
  assert.equal(E.tipFor({ facts: { virtualization: "kairos-lab" } }, "kairos-lab"), false, "set to another value");
  assert.equal(E.tipFor({ facts: { virtualization: "own" } }, "kairos-lab"), true);
  // E.strict is unchanged: it still wants every fact to be set (the loadout and noSkip use it).
  assert.equal(E.strict({ virtualization: ["own"] }, engineFacts({})), false);
  assert.equal(E.strict({ virtualization: ["own"] }, { virtualization: "unsure" }), false);
  assert.equal(E.strict({ virtualization: ["own"] }, { virtualization: "own" }), true);
});

test("tip: the reader reads the condition from content.stages[].tipOnly, and a stage with no tipOnly has no TIP", () => {
  const stage = E.stage("kairos-lab");
  assert.deepEqual(stage.tipOnly, { virtualization: ["own"] });
  assert.equal(E.tipFor(progress({ virtualization: "own" }), "kairos-lab"), true);
  // A stage that is still markdown has no tip and no tipOnly: no TIP for anybody.
  for (const s of E.C.stages.filter((x) => x.id !== "kairos-lab")) {
    assert.ok(!("tip" in s) && !("tipOnly" in s), s.id);
    assert.equal(E.tipFor(progress({ virtualization: "own" }), s.id), false, s.id);
  }
  // The reader decides from tipOnly alone: with tipOnly removed, the same facts get no TIP.
  const saved = stage.tipOnly;
  delete stage.tipOnly;
  try {
    assert.equal(E.tipFor(progress({ virtualization: "own" }), "kairos-lab"), false);
  } finally {
    stage.tipOnly = saved;
  }
  // And a condition of our own is read as given.
  stage.tipOnly = { virtualization: ["kairos-lab"], os: ["linux", "macos"] };
  try {
    assert.equal(E.tipFor(progress({ virtualization: "kairos-lab", os: "macos" }), "kairos-lab"), true);
    assert.equal(E.tipFor(progress({ virtualization: "kairos-lab", os: "windows" }), "kairos-lab"), false);
    assert.equal(E.tipFor(progress({ virtualization: "own", os: "macos" }), "kairos-lab"), false);
    assert.equal(E.tipFor(progress({ virtualization: "kairos-lab" }), "kairos-lab"), true, "os is unset, so the condition is unknown and the TIP is offered");
    assert.equal(E.tipFor(progress({ virtualization: "kairos-lab", os: "unsure" }), "kairos-lab"), true, "unsure counts as unset");
  } finally {
    stage.tipOnly = saved;
  }
});

test("tip: for every case where the reader offers the TIP its prompt is buildTipPrompt, with the name the learner typed", () => {
  let offered = 0;
  for (const facts of fullyAnswered) {
    const p = progress(facts);
    if (!E.tipFor(p, "kairos-lab")) continue;
    offered++;
    const named = { ...p, virtName: "VirtualBox" };
    // Not typed yet: the reader keeps our placeholder for the name of the software.
    assert.equal(E.prompt("tip", p, "kairos-lab"), buildTipPrompt(workshop, stageDoc, facts), JSON.stringify(facts));
    // Typed: the name stands where the placeholder stood.
    const want = buildTipPrompt(workshop, stageDoc, facts).split("[NAME OF YOUR VIRTUALIZATION SOFTWARE, e.g. VirtualBox]").join("VirtualBox");
    assert.equal(E.prompt("tip", named, "kairos-lab"), want, `${JSON.stringify(facts)} with a name`);
  }
  assert.equal(offered, fullyAnswered.filter((f) => f.virtualization === "own").length);
  assert.ok(offered >= 12);
  assert.equal(E.freeTextFact(engineFacts({ virtualization: "own" })), "virtualization");
  assert.equal(E.freeTextFact(engineFacts({ virtualization: "kairos-lab" })), null);
  assert.equal(E.freeTextFact(engineFacts({})), null);
});

test("prompts: with some facts unset the reader writes our unsetPlaceholder with the label of the fact, and ours writes other stand-ins", () => {
  const unset = progress({});
  const reader = E.prompt("tip", unset, "kairos-lab");
  const ours = buildTipPrompt(workshop, stageDoc, {});
  const { unsetPlaceholder } = E.W.prompts;
  assert.equal(unsetPlaceholder, "[YOUR {fact}]", "the placeholder is the designer's base text, copied to theme.json");
  const stand = (id) => unsetPlaceholder.replace("{fact}", E.fact(id).label.toUpperCase());
  assert.deepEqual(["os", "arch", "runtime", "virtualization"].map(stand), ["[YOUR OS]", "[YOUR ARCHITECTURE]", "[YOUR CONTAINER RUNTIME]", "[YOUR VIRTUALIZATION]"]);
  assert.match(reader, /My setup: \[YOUR OS\], \[YOUR ARCHITECTURE\], container runtime \[YOUR CONTAINER RUNTIME\], VMs with \[YOUR VIRTUALIZATION\]\./);
  assert.match(reader, /Explain how to install \[YOUR CONTAINER RUNTIME\] on \[YOUR OS\] \(\[YOUR ARCHITECTURE\]\)/);
  assert.match(ours, /My setup: \[YOUR OPERATING SYSTEM\], \[YOUR CPU ARCHITECTURE\], container runtime \[YOUR CONTAINER RUNTIME\], VMs with \[YOUR VIRTUALIZATION: kairos-lab OR YOUR OWN SOFTWARE\]\./);
  // Each fact on its own: an unset fact is the stand-in and a set one is its label.
  const part = E.prompt("tip", progress({ os: "linux", virtualization: "own" }), "kairos-lab");
  assert.match(part, /My setup: Linux, \[YOUR ARCHITECTURE\], container runtime \[YOUR CONTAINER RUNTIME\], VMs with \[NAME OF YOUR VIRTUALIZATION SOFTWARE, e\.g\. VirtualBox\]\./);
  // A step of a stage with no tool: the reader now drops the line, like ours.
  const step = E.stage("first-node").steps[0];
  const text = E.prompt("fail", progress({ os: "linux", arch: "amd64", runtime: "docker", virtualization: "own" }), "first-node", step);
  assert.doesNotMatch(text, /^Tool:/m);
});

// ---- commands carry no "$ " in the data, and the reader shows one ----

test("commands: the data holds no $ prompt, and the reader shows a $ on the first line of each command", () => {
  const rowsOf = (step, facts) => E.flatten(step.blocks, { key: `kairos-lab/${step.id}`, facts: engineFacts(facts), sel: {}, showAll: {}, layout: "stacked" });
  let seen = 0;
  for (const stage of E.C.stages) {
    for (const step of stage.steps) {
      const walk = (blocks) => {
        for (const b of blocks) {
          if (b.type === "command") assert.ok(!/^\s*\$ /.test(b.code), `${stage.id}/${step.id}: the data starts a command with $`);
          if (b.type === "alternatives") b.items.forEach((i) => walk(i.blocks));
        }
      };
      walk(step.blocks);
    }
  }
  for (const step of E.steps("kairos-lab", engineFacts({}))) {
    for (const r of rowsOf(step, {}).filter((x) => x.type === "command" && !x.isFile)) {
      seen++;
      assert.ok(!r.code.startsWith("$"), "the row holds the raw command, which is what Copy copies");
    }
  }
  assert.ok(seen >= 8);
  const html = readFileSync(join(web, "KAI Workshop.dc.html"), "utf8") + readFileSync(join(web, "kai-term.js"), "utf8");
  assert.match(html, /'\$ '/, "the reader adds the prompt itself");
});
