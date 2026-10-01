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
  assert.equal(E.isMaster(fromReader), true);
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

test("prompts: for every answered fact set the reader's step prompt says what ours says, apart from three known differences", () => {
  const stage = stageDoc;
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

      // The lines before the commands are the same except the tool line: the reader has one tool for the stage,
      // and we have one for each step.
      const toolAt = b.head.findIndex((l) => l.startsWith("Tool: "));
      for (let i = 0; i < b.head.length; i++) if (i !== toolAt) assert.equal(a.head[i], b.head[i], `${step.id}, line ${i}`);
      assert.equal(a.head.length, b.head.length);
      const stageTool = "Tool: kairos-lab (https://github.com/kairos-io/kairos-lab). Docs: https://github.com/kairos-io/kairos-lab#readme.";
      assert.equal(a.head[toolAt], stageTool);
      if (b.head[toolAt] !== stageTool) ownTool++;
      assert.equal(b.head[toolAt] !== stageTool, "tool" in stageDoc.sections.flatMap((x) => x.steps ?? []).find((x) => x.id === step.id).help, "the tool line differs when the step names its own tool");

      // The commands are the same. We start each command line with "$ ", the reader does not, and it
      // separates commands with a blank line.
      assert.deepEqual(stripPrompt(a.commands), stripPrompt(b.commands), `${step.id} commands`);
      if (b.commands[0] === "(this step has no commands)") assert.deepEqual(a.commands, b.commands);
      else {
        withCommands++;
        assert.ok(b.commands[0].startsWith("$ "), "ours starts a command with $ ");
        assert.ok(!a.commands[0].startsWith("$ "));
      }

      // The expected line: the same sentence when the step has a named check. For a step with no named check,
      // the reader says the prompt of its default check and we say the default sentence.
      if (step.check.kind !== "manual") {
        assert.ok(a.expected.startsWith(b.expected), `${step.id}: the reader's line starts with ours`);
        assert.equal(a.expected, b.expected);
      } else {
        manual++;
        assert.equal(a.expected, "What I expected: You finished this step.");
        assert.equal(b.expected, "What I expected: the step finishes without errors");
      }
      assert.deepEqual(a.tail, b.tail, `${step.id} tail`);
    }
    // A step that the facts hide has no prompt of ours, and the reader does not list it.
    for (const doc of stageDoc.sections.flatMap((x) => x.steps ?? []).filter((x) => x.help)) {
      if (!shown.some((x) => x.id === doc.id)) assert.equal(buildStepPrompt(workshop, stage, doc.id, facts), null, `${doc.id} is hidden for ${JSON.stringify(facts)}`);
    }
  }
  assert.ok(compared >= 60, `compared ${compared} prompts`);
  assert.ok(ownTool > 0 && manual > 0 && withCommands > 30, "the known differences were seen");
});

test("prompts: the reader writes the output of the step before the check sentence, in the expected line", () => {
  const step = { id: "t", title: "T", goal: "g", blocks: [{ type: "command", code: "echo hi" }, { type: "output", text: "hi" }], check: { prompt: "It says hi.", fail: [] } };
  const lines = E.prompt("fail", progress({ os: "linux", arch: "amd64", runtime: "docker", virtualization: "kairos-lab" }), "kairos-lab", step).split("\n");
  const at = lines.indexOf("What I expected: hi");
  assert.ok(at > 0 && lines[at + 1] === "(It says hi.)", lines.join("\n"));
});

test("prompts: for every answered fact set the tip prompt is the same text", () => {
  for (const facts of fullyAnswered) {
    assert.equal(E.prompt("tip", progress(facts), "kairos-lab"), buildTipPrompt(workshop, stageDoc, facts), JSON.stringify(facts));
  }
});

test("prompts: with some facts unset the reader and our reference write different stand-ins, and the reader keeps a line with no value", () => {
  const unset = progress({});
  const reader = E.prompt("tip", unset, "kairos-lab");
  const ours = buildTipPrompt(workshop, stageDoc, {});
  assert.match(reader, /My setup: \[YOUR OS\], \[YOUR ARCHITECTURE\], container runtime \[YOUR CONTAINER RUNTIME\], VMs with \[NAME OF YOUR VIRTUALIZATION SOFTWARE, e\.g\. VirtualBox\]\./);
  assert.match(ours, /My setup: \[YOUR OPERATING SYSTEM\], \[YOUR CPU ARCHITECTURE\], container runtime \[YOUR CONTAINER RUNTIME\], VMs with \[YOUR VIRTUALIZATION: kairos-lab OR YOUR OWN SOFTWARE\]\./);
  // A step of a stage with no tool: the reader fills an empty value, we drop the line.
  const step = E.stage("first-node").steps[0];
  assert.match(E.prompt("fail", progress({ os: "linux", arch: "amd64", runtime: "docker", virtualization: "own" }), "first-node", step), /^Tool:  \(\)\. Docs: \.$/m);
});
