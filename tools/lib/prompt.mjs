// Help prompts: text a reader copies into an AI assistant. It has no dependencies outside this
// folder and runs in Node and in the browser. See "Help prompts" in schema/v0/SPEC.md.
import { LABELS } from "./facts.mjs";
import { view } from "./view.mjs";
import { checkPrompt } from "./labels.mjs";

const PLACEHOLDER = /\{([a-z]+)\}/g;

// The placeholders a template can use, and the ones a stage `tip.request` can use.
export const REQUEST_PLACEHOLDERS = ["os", "arch", "runtime", "virtualization"];
export const PROMPT_PLACEHOLDERS = ["stage", "step", ...REQUEST_PLACEHOLDERS, "goal", "tool", "source", "docs", "commands", "expect", "request"];
const PASTE_MARKER = "[paste your logs";

const UNSET = {
  os: "[YOUR OPERATING SYSTEM]",
  arch: "[YOUR CPU ARCHITECTURE]",
  runtime: "[YOUR CONTAINER RUNTIME]",
  virtualization: "[YOUR VIRTUALIZATION: kairos-lab OR YOUR OWN SOFTWARE]",
};
const OWN_SOFTWARE = "[NAME OF YOUR VIRTUALIZATION SOFTWARE, e.g. VirtualBox]";

// The `{expect}` text of a step with no named check.
export const DEFAULT_EXPECT = "the step finishes without errors";

// The `{expect}` text of a step: the check sentence, or the default.
export const expectText = (check) => (check ? checkPrompt(check) : DEFAULT_EXPECT);

const hasValue = (v) => v !== undefined && v !== null && v !== "";

// Replace {name} in each line of `template` with values[name]. A line that holds a placeholder
// with no value is dropped, unless it holds the paste marker. A value is never searched for
// placeholders. The result has no final newline.
export function fillPrompt(template, values = {}) {
  const out = [];
  for (const line of template.replace(/\n+$/, "").split("\n")) {
    const names = [...line.matchAll(PLACEHOLDER)].map((m) => m[1]);
    if (!line.includes(PASTE_MARKER) && !names.every((n) => hasValue(values[n]))) continue;
    out.push(line.replace(PLACEHOLDER, (_, name) => (hasValue(values[name]) ? String(values[name]) : "")));
  }
  return out.join("\n");
}

// The four fact placeholders for a set of facts. An unset fact has a bracketed stand-in.
function factValues(facts = {}) {
  const out = {};
  for (const fact of ["os", "arch", "runtime"]) out[fact] = hasValue(facts[fact]) ? LABELS[fact][facts[fact]] : UNSET[fact];
  const v = facts.virtualization;
  out.virtualization = !hasValue(v) ? UNSET.virtualization : v === "own" ? OWN_SOFTWARE : LABELS.virtualization[v];
  return out;
}

// Commands for the prompt, one per line, each with "$ ". A line that ends with a backslash
// continues on the next line, and the continuation lines are kept as written.
function commandLines(commands) {
  if (commands.length === 0) return "(this step has no commands)";
  const out = [];
  for (const text of commands) {
    let continued = false;
    for (const line of text.replace(/\s+$/, "").split("\n")) {
      if (line.trim() === "") continue;
      out.push(continued ? line : `$ ${line}`);
      continued = line.trimEnd().endsWith("\\");
    }
  }
  return out.join("\n");
}

function findStep(stage, ref) {
  const id = typeof ref === "string" ? ref : ref?.id;
  for (const section of stage.sections) {
    const step = (section.steps ?? []).find((s) => s.id === id);
    if (step) return { section, step };
  }
  throw new Error(`stage "${stage.id}" has no step "${id}"`);
}

function templateOf(workshop, kind) {
  const template = workshop.prompts?.[kind];
  if (!template) throw new Error(`the workshop has no "${kind}" prompt`);
  return template;
}

// The help prompt for one step, or null when the step has no `help` or the facts hide it.
// `workshop` is the parsed workshop.yaml, `stage` a parsed stage file, `step` a step id (or a step).
export function buildStepPrompt(workshop, stage, step, facts = {}) {
  const { section, step: s } = findStep(stage, step);
  if (!s.help) return null;
  const help = { ...stage.help, ...s.help };
  // The outline of this one step: empty when its own condition or its section's is false.
  const outline = view({ sections: [{ ...section, steps: [s] }] }, facts);
  if (!outline.some((i) => i.kind === "step")) return null;
  const commands = outline.filter((i) => i.kind === "command").map((i) => i.text);
  return fillPrompt(templateOf(workshop, "step"), {
    ...factValues(facts),
    stage: stage.title,
    step: s.title ?? section.title,
    goal: help.goal,
    tool: help.tool,
    source: help.source,
    docs: help.docs,
    commands: commandLines(commands),
    expect: expectText(s.check),
  });
}

// The "ask KAI for a TIP" prompt for a stage, or null when the stage has no `tip`.
// The `when` of the tip says whether a reader offers it. This function does not look at it.
export function buildTipPrompt(workshop, stage, facts = {}) {
  if (!stage.tip) return null;
  const values = factValues(facts);
  return fillPrompt(templateOf(workshop, "tip"), {
    ...values,
    stage: stage.title,
    request: fillPrompt(stage.tip.request, values),
  });
}
