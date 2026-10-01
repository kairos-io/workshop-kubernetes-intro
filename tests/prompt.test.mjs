import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";
import { loadWorkshop } from "../tools/lib/load.mjs";
import { fillPrompt, buildStepPrompt, buildTipPrompt } from "../tools/lib/prompt.mjs";

const root = new URL("../", import.meta.url);
const workshop = parse(readFileSync(new URL("workshop.yaml", root), "utf8"));

// A small stage written for these tests, so the rules are checked without the real stage 1.
const stage = {
  id: "demo",
  title: "Demo stage",
  help: { tool: "demo-tool", source: "https://example.com/src", docs: "https://example.com/docs" },
  tip: { request: "Explain how to install {runtime} on {os} ({arch})." },
  sections: [
    {
      title: "Section title",
      steps: [
        { id: "a", title: "Step A", help: { goal: "Do the A thing" }, commands: ["echo a", "echo b"] },
        { id: "b", help: { goal: "Do the B thing", tool: "other-tool" }, check: { kind: "iso-exists" }, commands: ["make iso"] },
        { id: "c", title: "Step C", commands: ["echo c"] },
        { id: "d", title: "Step D", help: { goal: "Read about D" }, text: "Just read." },
        {
          id: "e",
          title: "Step E",
          help: { goal: "Pick a runtime" },
          variants: [
            { id: "docker", title: "Docker", when: { runtime: "docker" }, commands: ["docker pull x"] },
            { id: "podman", title: "Podman", when: { runtime: "podman" }, commands: ["podman pull x"] },
          ],
        },
        { id: "f", title: "Step F", when: { os: "linux" }, help: { goal: "Linux only" }, commands: ["uname"] },
        { id: "g", title: "Step G", help: { goal: "A long command" }, commands: ["docker run -it --rm \\\n  -v a:b \\\n  image run\nsecond"] },
      ],
    },
  ],
};

const TAIL = "Give me short numbered steps for my setup. If something is unclear, say what you need from me. Prefer the docs above over guesses.";

test("fillPrompt replaces placeholders and drops a line whose placeholder has no value", () => {
  assert.equal(fillPrompt("a {x}\nb {y}\nc", { x: "1" }), "a 1\nc");
  assert.equal(fillPrompt("a {x}\nb {y}\nc", { x: "1", y: "" }), "a 1\nc");
  assert.equal(fillPrompt("{x} and {x}", { x: "1" }), "1 and 1");
});

test("fillPrompt keeps a line that holds the paste marker even when a value is missing", () => {
  assert.equal(fillPrompt("What happened: [paste your logs or the error here] {x}", {}), "What happened: [paste your logs or the error here] ");
});

test("fillPrompt does not expand a placeholder that comes from a value", () => {
  assert.equal(fillPrompt("{x}", { x: "{y}", y: "no" }), "{y}");
});

test("fillPrompt drops the final newline of a template", () => {
  assert.equal(fillPrompt("a\nb\n", {}), "a\nb");
});

test("a step prompt for macOS, arm64, Docker and kairos-lab", () => {
  const facts = { os: "macos", arch: "arm64", runtime: "docker", virtualization: "kairos-lab" };
  assert.equal(
    buildStepPrompt(workshop, stage, "a", facts),
    [
      'I\'m following the Kairos workshop, stage "Demo stage", step "Step A".',
      "My setup: macOS, arm64, container runtime Docker, VMs with kairos-lab.",
      "Goal of this step: Do the A thing.",
      "Tool: demo-tool (https://example.com/src). Docs: https://example.com/docs.",
      "What I ran:",
      "$ echo a",
      "$ echo b",
      "What I expected: the step finishes without errors",
      "What happened: [paste your logs or the error here]",
      TAIL,
    ].join("\n"),
  );
});

test("a step prompt for Linux, amd64, Podman and your own software", () => {
  const facts = { os: "linux", arch: "amd64", runtime: "podman", virtualization: "own" };
  const text = buildStepPrompt(workshop, stage, "e", facts);
  assert.ok(text.includes("My setup: Linux, amd64, container runtime Podman, VMs with [NAME OF YOUR VIRTUALIZATION SOFTWARE, e.g. VirtualBox]."));
  assert.ok(text.includes("What I ran:\n$ podman pull x\nWhat I expected"));
  assert.ok(!text.includes("docker pull"));
});

test("a step prompt with no facts names a placeholder for each and lists every variant", () => {
  const text = buildStepPrompt(workshop, stage, "e", {});
  assert.ok(text.includes("My setup: [YOUR OPERATING SYSTEM], [YOUR CPU ARCHITECTURE], container runtime [YOUR CONTAINER RUNTIME], VMs with [YOUR VIRTUALIZATION: kairos-lab OR YOUR OWN SOFTWARE]."));
  assert.ok(text.includes("What I ran:\n$ docker pull x\n$ podman pull x\n"));
});

test("a step with no title uses its section title, a step with a check uses the check sentence, and a step help wins over the stage help", () => {
  const text = buildStepPrompt(workshop, stage, "b", { os: "linux" });
  assert.ok(text.includes('stage "Demo stage", step "Section title".'));
  assert.ok(text.includes("What I expected: The ISO file exists.\n"));
  assert.ok(text.includes("Tool: other-tool (https://example.com/src). Docs: https://example.com/docs."));
});

test("a step with no commands says so", () => {
  const text = buildStepPrompt(workshop, stage, "d", {});
  assert.ok(text.includes("What I ran:\n(this step has no commands)\nWhat I expected: the step finishes without errors\n"));
});

test("a step with no help has no prompt", () => {
  assert.equal(buildStepPrompt(workshop, stage, "c", {}), null);
});

test("a step that the facts hide has no prompt", () => {
  assert.equal(buildStepPrompt(workshop, stage, "f", { os: "macos" }), null);
  assert.ok(buildStepPrompt(workshop, stage, "f", { os: "linux" }));
  assert.ok(buildStepPrompt(workshop, stage, "f", {}), "an unset fact leaves the step conditional, so it still has a prompt");
});

test("an unknown step id is an error", () => {
  assert.throws(() => buildStepPrompt(workshop, stage, "nope", {}), /nope/);
});

test("a line is dropped when the step has help but no tool, source or docs", () => {
  const bare = { ...stage, help: undefined };
  const text = buildStepPrompt(workshop, bare, "a", {});
  assert.ok(!text.includes("Tool:"));
  assert.ok(text.includes("Goal of this step: Do the A thing."));
  const half = { ...stage, help: { tool: "demo-tool" } };
  assert.ok(!buildStepPrompt(workshop, half, "a", {}).includes("Tool:"), "a Tool line needs tool, source and docs");
});

test("a command that continues over lines with a backslash stays one command", () => {
  const text = buildStepPrompt(workshop, stage, "g", {});
  assert.ok(text.includes("What I ran:\n$ docker run -it --rm \\\n  -v a:b \\\n  image run\n$ second\nWhat I expected"));
});

test("the expected line of a manual check is its text, capitalized", () => {
  const manual = { ...stage, sections: [{ title: "S", steps: [{ id: "m", help: { goal: "Do M" }, commands: ["echo m"], check: { kind: "manual", text: "the setup finished." } }] }] };
  assert.ok(buildStepPrompt(workshop, manual, "m", {}).includes("What I expected: The setup finished."));
});

test("a tip prompt for your own software", () => {
  const facts = { os: "linux", arch: "amd64", runtime: "docker", virtualization: "own" };
  assert.equal(
    buildTipPrompt(workshop, stage, facts),
    [
      'I\'m following the Kairos workshop, stage "Demo stage".',
      "My setup: Linux, amd64, container runtime Docker, VMs with [NAME OF YOUR VIRTUALIZATION SOFTWARE, e.g. VirtualBox].",
      "Explain how to install Docker on Linux (amd64).",
      "Give me short numbered steps for my setup. If something is unclear, say what you need from me.",
    ].join("\n"),
  );
});

test("a tip prompt with no facts uses the placeholders in the request too", () => {
  const text = buildTipPrompt(workshop, stage, {});
  assert.ok(text.includes("Explain how to install [YOUR CONTAINER RUNTIME] on [YOUR OPERATING SYSTEM] ([YOUR CPU ARCHITECTURE])."));
});

test("a stage with no tip has no tip prompt", () => {
  assert.equal(buildTipPrompt(workshop, { ...stage, tip: undefined }, {}), null);
});

test("the workshop templates only use the allowed placeholders", () => {
  const allowed = new Set(["stage", "step", "os", "arch", "runtime", "virtualization", "goal", "tool", "source", "docs", "commands", "expect", "request"]);
  for (const t of Object.values(workshop.prompts)) for (const m of t.matchAll(/\{([^{}]*)\}/g)) assert.ok(allowed.has(m[1]), m[1]);
});

// The conformance cases: exact texts, written by hand.
const dir = new URL("conformance/v0/prompt/", root);
const cases = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const loaded = loadWorkshop(root.pathname);

test("there are at least eight prompt cases, and they cover step and tip, set and unset facts, and null results", () => {
  assert.ok(cases.length >= 8);
  const all = cases.map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
  assert.ok(all.some((c) => c.kind === "step") && all.some((c) => c.kind === "tip"));
  assert.ok(all.some((c) => Object.keys(c.facts).length === 0));
  assert.ok(all.some((c) => c.expect === null));
  assert.ok(all.some((c) => c.facts.virtualization === "own") && all.some((c) => c.facts.virtualization === "kairos-lab"));
});

for (const f of cases) {
  test(`prompt: ${f}`, () => {
    const c = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    assert.deepEqual(Object.keys(c).filter((k) => k !== "step").sort(), ["expect", "facts", "kind", "stage"]);
    const entry = loaded.stages.find((s) => s.id === c.stage);
    assert.ok(entry, `no stage ${c.stage}`);
    // A stage that is still markdown has no sections, so no help and no tip.
    const stageDoc = entry.doc ?? { id: entry.id, title: entry.title, sections: [] };
    const got = c.kind === "step" ? buildStepPrompt(loaded.workshop, stageDoc, c.step, c.facts) : buildTipPrompt(loaded.workshop, stageDoc, c.facts);
    assert.equal(got, c.expect);
    // A reader that gets the normalized stage must give the same text.
    if (entry.file) {
      const raw = parse(readFileSync(new URL(entry.file, root), "utf8"));
      const again = c.kind === "step" ? buildStepPrompt(loaded.workshop, raw, c.step, c.facts) : buildTipPrompt(loaded.workshop, raw, c.facts);
      assert.equal(again, c.expect, "the raw stage file gives the same text");
    }
  });
}

test("no prompt of stage 1 has an em dash, a leftover placeholder or a double blank line", () => {
  const stage1 = loaded.stages[0].doc;
  for (const st of stage1.sections.flatMap((s) => s.steps ?? []).filter((x) => x.help)) {
    for (const facts of [{}, { os: "linux", arch: "amd64", runtime: "docker", virtualization: "own" }]) {
      const text = buildStepPrompt(loaded.workshop, stage1, st.id, facts);
      if (text === null) continue;
      assert.ok(!text.includes("\u2014"), st.id);
      assert.ok(!/\{[a-z]+\}/.test(text), st.id);
      assert.ok(!text.includes("\n\n"), st.id);
    }
  }
});
