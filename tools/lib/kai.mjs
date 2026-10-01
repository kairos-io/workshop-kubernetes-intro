import { FACT_DEFS, FACTS, VALUES } from "./facts.mjs";
import { normalizeWhen } from "./load.mjs";
import { expectText } from "./prompt.mjs";
import { checkPrompt } from "./labels.mjs";
import { uniqueSlugs } from "./slug.mjs";

// The compiler from the workshop model (stage, sections, steps, variants) to the model of the KAI
// game reader (stage, steps, blocks). The reader's shape is described in kai/README.md and kai/DATA.md.
// This file writes content.json. tools/lib/theme.mjs writes the part of theme.json that comes from us.

// Prompts for steps that have no named check. Every KAI step needs one.
export const PROMPTS = {
  step: "You finished this step.",
  read: "You read this.",
  stage: "You finished this stage.",
};

// The KAI step that stands in for a stage that is still plain markdown.
export const MARKDOWN_STEP = { id: "on-github", title: "Continue on GitHub", line: "This part is not in the game yet." };

export const MAX_LINE = 60;

// The `when` of a stage tip that sets none (schema/v0/SPEC.md, "Stage tip"): your own virtualization software.
export const DEFAULT_TIP_WHEN = { virtualization: ["own"] };

// The check kinds of the format, and "manual" for a step with no named check.
const CHECK_KINDS = ["command-available", "image-exists", "iso-exists", "vm-running"];

// KAI knows three callout kinds. Ours has five.
const CALLOUT_KIND = { note: "note", tip: "note", important: "warning", warning: "warning", caution: "caution" };

export class CompileError extends Error {}

const trim = (s) => s.replace(/\s+$/, "");
const stripStageNumber = (title) => title.replace(/^Stage \d+:\s*/, "");

// { os: ["linux"] } in the fixed fact order. Input is a normalized when (lists).
function toOnly(when) {
  if (!when) return undefined;
  const only = {};
  for (const fact of FACTS) if (when[fact]) only[fact] = [...when[fact]];
  return only;
}

// Both conditions must hold. A key in both keeps the values the two lists share. Keys in one are kept.
function mergeOnly(a, b, where) {
  if (!a) return b;
  if (!b) return a;
  const out = {};
  for (const fact of FACTS) {
    if (a[fact] && b[fact]) {
      out[fact] = a[fact].filter((v) => b[fact].includes(v));
      if (out[fact].length === 0) throw new CompileError(`${where}: the section and the step name no ${fact} value in common, so the step can never show`);
    } else if (a[fact] || b[fact]) {
      out[fact] = [...(a[fact] ?? b[fact])];
    }
  }
  return out;
}

const withOnly = (only, block) => {
  if (!only) return block;
  // `only` goes after the type and kind, before the content, like the reader's own content.json.
  const { type, kind, ...rest } = block;
  return { type, ...(kind !== undefined && { kind }), only, ...rest };
};

// The help of a step with the help of its stage as defaults: tool, source, docs. `expect` is the
// sentence for the {expect} slot of the step prompt. The goal is not part of it: the reader has
// its own field for it (`goal` on the step).
function mergeHelp(stageHelp, stepHelp, check) {
  const all = { ...stageHelp, ...stepHelp };
  const out = {};
  for (const k of ["tool", "source", "docs"]) if (all[k] !== undefined) out[k] = all[k];
  out.expect = expectText(check);
  return out;
}

const textBlock = (md) => ({ type: "text", md: trim(md) });
const calloutBlocks = (warnings) =>
  (warnings ?? []).map((w) => withOnly(toOnly(w.when), { type: "callout", kind: CALLOUT_KIND[w.kind], md: trim(w.text) }));

// The blocks a step or variant shows in render order D6: text, warnings, commands, expect, after.
// A step with variants keeps its commands out of this list (it cannot have any).
function body(b, { text = true, warnings = true, tail = true } = {}) {
  const out = [];
  if (text && b.text) out.push(textBlock(b.text));
  if (warnings) out.push(...calloutBlocks(b.warnings));
  if (tail) {
    for (const c of b.commands ?? []) out.push({ type: "command", code: trim(c) });
    if (b.expect !== undefined) out.push({ type: "output", text: trim(b.expect) });
    if (b.after) out.push(textBlock(b.after));
  }
  return out;
}

// `kind` is the kind of the named check, or "manual" when the prompt is a default one.
function checkOf(step, fallback) {
  return {
    kind: step.check ? step.check.kind : "manual",
    prompt: step.check ? checkPrompt(step.check) : fallback,
    ...(step.check?.verify && { verify: { command: step.check.verify.command, ...(step.check.verify.output !== undefined && { output: trim(step.check.verify.output) }) } }),
    fail: step.onFail ? [textBlock(step.onFail)] : [],
  };
}

// One converted stage. `lines` maps "<stage-id>/<step-id>" to the game line. Input must be a normalized stage.
export function compileStage(doc, lines = {}) {
  const slugs = uniqueSlugs(doc.sections.map((s) => s.title));
  const lineFor = (stepId, title) => lines[`${doc.id}/${stepId}`] ?? title;
  const steps = [];

  doc.sections.forEach((section, si) => {
    const sectionOnly = toOnly(section.when);
    const sectionBlocks = body(section, { tail: false });
    const yamlSteps = section.steps ?? [];

    if (yamlSteps.length === 0) {
      if (sectionBlocks.length === 0) throw new CompileError(`stage "${doc.id}": section "${section.title}" has no text, warnings or steps, so there is nothing to show`);
      steps.push({
        id: slugs[si],
        title: section.title,
        line: lineFor(slugs[si], section.title),
        ...(sectionOnly && { only: sectionOnly }),
        blocks: sectionBlocks,
        check: { kind: "manual", prompt: PROMPTS.read, fail: [] },
      });
      return;
    }

    // The section's own text and warnings ride on its first step. If that step has a condition of
    // its own, a fact could hide the step and the section text with it, so they get a step of their own.
    let lead = sectionBlocks;
    if (sectionBlocks.length > 0 && yamlSteps[0].when) {
      steps.push({
        id: slugs[si],
        title: section.title,
        line: lineFor(slugs[si], section.title),
        ...(sectionOnly && { only: sectionOnly }),
        blocks: sectionBlocks,
        check: { kind: "manual", prompt: PROMPTS.read, fail: [] },
      });
      lead = [];
    }

    yamlSteps.forEach((step, ti) => {
      const where = `stage "${doc.id}", step "${step.id}"`;
      const title = step.title ?? section.title;
      const only = mergeOnly(sectionOnly, toOnly(step.when), where);
      const blocks = ti === 0 ? [...lead] : [];
      if (step.variants) {
        blocks.push(...body(step, { tail: false }));
        blocks.push({
          type: "alternatives",
          id: step.id,
          title,
          items: step.variants.map((v) => {
            const only = toOnly(v.when);
            return { label: v.title, ...(only && { only }), blocks: body(v) };
          }),
        });
        if (step.after) blocks.push(textBlock(step.after));
      } else {
        blocks.push(...body(step));
      }
      steps.push({
        id: step.id,
        title,
        line: lineFor(step.id, title),
        ...(step.optional && { optional: true }),
        ...(only && { only }),
        blocks,
        check: checkOf(step, PROMPTS.step),
        ...(step.help && { goal: step.help.goal, help: mergeHelp(doc.help, step.help, step.check) }),
      });
    });
  });

  const skip = toOnly(doc.not_skippable_when);
  const tipOnly = doc.tip && toOnly(doc.tip.when ?? DEFAULT_TIP_WHEN);
  const help = doc.help ?? {};
  return {
    id: doc.id,
    title: stripStageNumber(doc.title),
    goal: doc.goal,
    steps,
    ...(help.tool && { tool: { name: help.tool, ...(help.source && { url: help.source }) } }),
    ...(help.docs && { docs: help.docs }),
    // The reader offers the tip only where `tipOnly` matches the facts, so every stage with a tip
    // carries one: the `when` of the tip, or the default when the stage sets none.
    ...(doc.tip && { tip: doc.tip.request }),
    ...(tipOnly && { tipOnly }),
    ...(skip && { noSkip: { when: skip, reason: doc.not_skippable_reason } }),
  };
}

// A stage that is still plain markdown: one step that points at the file on GitHub.
export function compileMarkdownStage(entry, repository, lines = {}) {
  if (!entry.goal) throw new CompileError(`stage "${entry.id}": a markdown stage needs a goal for the game. Add goal to its entry in workshop.yaml`);
  const url = `https://github.com/${repository}/blob/main/${entry.markdown}`;
  return {
    id: entry.id,
    title: stripStageNumber(entry.title),
    goal: entry.goal,
    steps: [
      {
        id: MARKDOWN_STEP.id,
        title: MARKDOWN_STEP.title,
        line: lines[`${entry.id}/${MARKDOWN_STEP.id}`] ?? MARKDOWN_STEP.line,
        blocks: [textBlock(`This stage is not in the game yet. [Open it on GitHub](${url}).`)],
        check: { kind: "manual", prompt: PROMPTS.stage, fail: [] },
      },
    ],
  };
}

// The reader does not know `ends`. After an answer that ends the loadout it asks no more questions only
// because every later question has an `askIf` that is false under that answer. So each later question
// must have a `when` that the answer (with what it forces) does not satisfy.
function checkEndsOptions(loadout) {
  loadout.questions.forEach((q, i) => {
    for (const o of q.options.filter((x) => x.ends === true)) {
      const answers = { [q.fact]: o.value, ...o.forces };
      for (const later of loadout.questions.slice(i + 1)) {
        const when = normalizeWhen(later.when);
        const asked = !when || Object.entries(when).every(([fact, values]) => answers[fact] !== undefined && values.includes(answers[fact]));
        if (asked) throw new CompileError(`workshop.yaml: the option "${o.value}" of "${q.fact}" ends the loadout, but the question about "${later.fact}" has no when that stops the game from asking it`);
      }
    }
  });
}

// The facts the loadout asks about, in the order of the questions, with the question and the option
// labels from the loadout. `askIf` is the `when` of the question. An option has `forces` when ours does
// and `notice` (the option value, which names an entry of `notices` in theme.json) when it ends the flow.
export function compileFacts(loadout) {
  checkEndsOptions(loadout);
  return loadout.questions.map((q) => {
    const askIf = toOnly(normalizeWhen(q.when));
    return {
      id: q.fact,
      label: FACT_DEFS.find((d) => d.id === q.fact).label,
      question: q.title,
      options: q.options.map((o) => ({
        id: o.value,
        label: o.label,
        ...(o.forces && { forces: { ...o.forces } }),
        ...(o.ends === true && { notice: o.value }),
      })),
      ...(askIf && { askIf }),
    };
  });
}

// `loaded` is the result of loadWorkshop. `lines` is the parsed kai/lines.yaml.
export function compileWorkshop(loaded, lines = {}) {
  const { repository, welcome, loadout, prompts } = loaded.workshop;
  for (const [key, value] of Object.entries({ welcome, loadout, prompts })) {
    if (!value) throw new CompileError(`workshop.yaml needs ${key} for the game`);
  }
  const stages = loaded.stages.map((s) => (s.kind === "converted" ? compileStage(s.doc, lines) : compileMarkdownStage(s, repository, lines)));
  const content = { facts: compileFacts(loadout), stages };
  checkLines(content, lines, loaded.workshop);
  validateContent(content);
  return content;
}

// The two keys of kai/lines.yaml that are not <stage-id>/<step-id>.
export const LINE_SECTIONS = ["welcome", "notices"];
export const MAX_WELCOME_LINE = 40;
const plainLine = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\n<>]/.test(v);

// The step lines of kai/lines.yaml, without the `welcome` and `notices` sections.
export const stepLines = (lines) => Object.fromEntries(Object.entries(lines).filter(([k]) => !LINE_SECTIONS.includes(k)));

// A line key that matches no step is a typo. A line that is too long does not fit the dialogue box.
function checkLines(content, lines, workshop) {
  const keys = new Set(content.stages.flatMap((s) => s.steps.map((st) => `${s.id}/${st.id}`)));
  for (const [key, line] of Object.entries(stepLines(lines))) {
    if (!keys.has(key)) throw new CompileError(`kai/lines.yaml: the key "${key}" matches no stage and step`);
    if (!plainLine(line, MAX_LINE)) {
      throw new CompileError(`kai/lines.yaml: the line for "${key}" must be plain text of 1 to ${MAX_LINE} characters on one line`);
    }
  }
  checkLineSections(lines, workshop);
}

// The options of the loadout that end the flow, by value.
export const endingOptions = (loadout) => loadout.questions.flatMap((q) => q.options.filter((o) => o.ends === true));

// The `welcome` and `notices` sections, when present: one line per welcome page, and a title and a line
// for each option that ends the loadout. Whether they are present is checked where they are used.
export function checkLineSections(lines, workshop) {
  if (lines.welcome !== undefined) {
    const pages = workshop.welcome?.pages ?? [];
    if (!Array.isArray(lines.welcome) || lines.welcome.length !== pages.length) {
      throw new CompileError(`kai/lines.yaml: welcome must be a list with one line for each of the ${pages.length} welcome pages of workshop.yaml`);
    }
    lines.welcome.forEach((l, i) => {
      if (!plainLine(l, MAX_WELCOME_LINE)) throw new CompileError(`kai/lines.yaml: welcome line ${i + 1} must be plain text of 1 to ${MAX_WELCOME_LINE} characters on one line`);
    });
  }
  if (lines.notices !== undefined) {
    const notices = lines.notices;
    if (typeof notices !== "object" || notices === null || Array.isArray(notices)) throw new CompileError("kai/lines.yaml: notices must be a map from an option value to { title, line }");
    const ends = new Set(endingOptions(workshop.loadout ?? { questions: [] }).map((o) => o.value));
    for (const [value, n] of Object.entries(notices)) {
      if (!ends.has(value)) throw new CompileError(`kai/lines.yaml: the notice "${value}" matches no option that has ends: true`);
      const keys = Object.keys(n ?? {}).sort().join(",");
      if (keys !== "line,title") throw new CompileError(`kai/lines.yaml: the notice "${value}" must have a title and a line, and nothing else`);
      for (const k of ["title", "line"]) {
        if (!plainLine(n[k], MAX_LINE)) throw new CompileError(`kai/lines.yaml: the ${k} of the notice "${value}" must be plain text of 1 to ${MAX_LINE} characters on one line`);
      }
    }
  }
}

// ---- validation of the output, so the compiler never writes a shape the reader cannot show ----

const BLOCK_FIELDS = {
  text: { required: ["md"], optional: ["only"] },
  command: { required: ["code"], optional: ["only"] },
  file: { required: ["name", "code"], optional: ["only"] },
  output: { required: ["text"], optional: ["only"] },
  callout: { required: ["kind", "md"], optional: ["only"] },
  alternatives: { required: ["id", "title", "items"], optional: ["only"] },
};

function checkShape(obj, required, optional, where, errors) {
  for (const k of required) if (obj[k] === undefined) errors.push(`${where}: missing "${k}"`);
  for (const k of Object.keys(obj)) if (!["type", ...required, ...optional].includes(k)) errors.push(`${where}: unknown field "${k}"`);
}

function checkOnly(only, where, errors) {
  if (only === undefined) return;
  if (typeof only !== "object" || only === null || Array.isArray(only) || Object.keys(only).length === 0) {
    errors.push(`${where}: "only" must be an object with at least one fact`);
    return;
  }
  for (const [fact, values] of Object.entries(only)) {
    if (!VALUES[fact]) {
      errors.push(`${where}: "only" names the unknown fact "${fact}"`);
      continue;
    }
    if (!Array.isArray(values) || values.length === 0) errors.push(`${where}: only.${fact} must be a non-empty list`);
    else for (const v of values) if (!VALUES[fact].includes(v)) errors.push(`${where}: only.${fact} names the unknown value "${v}"`);
  }
}

function checkBlocks(blocks, where, errors) {
  if (!Array.isArray(blocks)) {
    errors.push(`${where}: blocks must be a list`);
    return;
  }
  blocks.forEach((b, i) => {
    const at = `${where}.blocks[${i}]`;
    const spec = BLOCK_FIELDS[b?.type];
    if (!spec) {
      errors.push(`${at}: unknown block type "${b?.type}"`);
      return;
    }
    checkShape(b, spec.required, spec.optional, at, errors);
    checkOnly(b.only, at, errors);
    for (const k of spec.required) if (k !== "items" && typeof b[k] !== "string") errors.push(`${at}: "${k}" must be text`);
    if (b.type === "callout" && !["note", "caution", "warning"].includes(b.kind)) errors.push(`${at}: unknown callout kind "${b.kind}"`);
    if (b.type === "alternatives") {
      if (!Array.isArray(b.items) || b.items.length === 0) errors.push(`${at}: an alternatives block needs items`);
      else {
        b.items.forEach((it, j) => {
          const ia = `${at}.items[${j}]`;
          checkShape(it, ["label", "blocks"], ["only"], ia, errors);
          checkOnly(it.only, ia, errors);
          if (typeof it.label !== "string" || it.label === "") errors.push(`${ia}: missing label`);
          checkBlocks(it.blocks, ia, errors);
        });
      }
    }
  });
}

const isText = (v) => typeof v === "string" && v !== "";
const isHttps = (v) => typeof v === "string" && /^https:\/\/\S+$/.test(v);

// The `help` of a step: the sentence for {expect}, and the tool, source and docs for the step.
function checkHelp(help, where, errors) {
  checkShape(help, ["expect"], ["tool", "source", "docs"], `${where}, help`, errors);
  for (const k of ["tool", "expect"]) if (help[k] !== undefined && !isText(help[k])) errors.push(`${where}, help: "${k}" must be text`);
  for (const k of ["source", "docs"]) if (help[k] !== undefined && !isHttps(help[k])) errors.push(`${where}, help: "${k}" must be an https URL`);
}

// The facts at the top of the content: one per fact that the loadout asks, in the order of the questions.
function checkFacts(facts, errors) {
  if (!Array.isArray(facts) || facts.length === 0) {
    errors.push("facts must be a non-empty list");
    return;
  }
  const seen = new Set();
  facts.forEach((f, i) => {
    const w = `facts[${i}]`;
    checkShape(f, ["id", "label", "question", "options"], ["askIf"], w, errors);
    if (!VALUES[f.id]) {
      errors.push(`${w}: unknown fact "${f.id}"`);
      return;
    }
    if (seen.has(f.id)) errors.push(`${w}: duplicate fact "${f.id}"`);
    seen.add(f.id);
    for (const k of ["label", "question"]) if (!isText(f[k])) errors.push(`${w}: "${k}" must be text`);
    checkOnly(f.askIf, `${w}.askIf`, errors);
    if (!Array.isArray(f.options) || f.options.length < 2) errors.push(`${w}: needs at least two options`);
    (f.options ?? []).forEach((o, j) => {
      const ow = `${w}.options[${j}]`;
      checkShape(o, ["id", "label"], ["forces", "notice"], ow, errors);
      if (!VALUES[f.id].includes(o.id)) errors.push(`${ow}: unknown value "${o.id}"`);
      if (!isText(o.label)) errors.push(`${ow}: "label" must be text`);
      if (o.notice !== undefined && !isText(o.notice)) errors.push(`${ow}: "notice" must be text`);
      if (o.forces !== undefined) {
        checkShape(o.forces, [], Object.keys(VALUES), `${ow}.forces`, errors);
        for (const [fact, value] of Object.entries(o.forces)) if (VALUES[fact] && !VALUES[fact].includes(value)) errors.push(`${ow}.forces: "${value}" is not a value of "${fact}"`);
      }
    });
  });
}

// Throws a CompileError that lists every problem.
export function validateContent(content) {
  const errors = [];
  checkShape(content, ["facts", "stages"], [], "content", errors);
  checkFacts(content.facts, errors);
  const stageIds = new Set();
  (content.stages ?? []).forEach((s, si) => {
    const sw = `stage "${s.id}"`;
    checkShape(s, ["id", "title", "goal", "steps"], ["tool", "docs", "tip", "tipOnly", "noSkip"], sw, errors);
    if (s.noSkip !== undefined) {
      checkShape(s.noSkip, ["when", "reason"], [], `${sw}, noSkip`, errors);
      checkOnly(s.noSkip.when, `${sw}, noSkip.when`, errors);
      if (!isText(s.noSkip.reason)) errors.push(`${sw}, noSkip: "reason" must be text`);
    }
    if (s.tip !== undefined && !isText(s.tip)) errors.push(`${sw}: "tip" must be text`);
    checkOnly(s.tipOnly, `${sw}, tipOnly`, errors);
    if (s.tool !== undefined) {
      checkShape(s.tool, ["name"], ["url"], `${sw}, tool`, errors);
      if (!isText(s.tool.name)) errors.push(`${sw}, tool: "name" must be text`);
      if (s.tool.url !== undefined && !isHttps(s.tool.url)) errors.push(`${sw}, tool: "url" must be an https URL`);
    }
    if (s.docs !== undefined && !isHttps(s.docs)) errors.push(`${sw}: "docs" must be an https URL`);
    if (stageIds.has(s.id)) errors.push(`${sw}: duplicate stage id`);
    stageIds.add(s.id);
    for (const k of ["title", "goal"]) if (typeof s[k] !== "string" || s[k] === "") errors.push(`${sw}: "${k}" must be text`);
    if (!Array.isArray(s.steps) || s.steps.length === 0) errors.push(`${sw}: needs at least one step`);
    const stepIds = new Set();
    (s.steps ?? []).forEach((st) => {
      const w = `${sw}, step "${st.id}"`;
      checkShape(st, ["id", "title", "line", "blocks", "check"], ["optional", "only", "goal", "help"], w, errors);
      if (st.goal !== undefined && !isText(st.goal)) errors.push(`${w}: "goal" must be text`);
      if (st.help !== undefined) checkHelp(st.help, w, errors);
      if (stepIds.has(st.id)) errors.push(`${w}: duplicate step id`);
      stepIds.add(st.id);
      for (const k of ["title", "line"]) if (typeof st[k] !== "string" || st[k] === "") errors.push(`${w}: "${k}" must be text`);
      checkOnly(st.only, w, errors);
      checkBlocks(st.blocks, w, errors);
      if (Array.isArray(st.blocks) && st.blocks.length === 0) errors.push(`${w}: has no blocks`);
      const c = st.check;
      if (!c || typeof c.prompt !== "string" || c.prompt === "") errors.push(`${w}: check.prompt is required`);
      else {
        checkShape(c, ["prompt", "fail"], ["kind", "verify"], `${w}, check`, errors);
        if (c.verify !== undefined) {
          checkShape(c.verify, ["command"], ["output"], `${w}, check.verify`, errors);
          if (!isText(c.verify.command) || c.verify.command.includes("\n")) errors.push(`${w}, check.verify: "command" must be text on one line`);
          if (c.verify.output !== undefined && !isText(c.verify.output)) errors.push(`${w}, check.verify: "output" must be text`);
        }
        if (c.kind !== undefined && ![...CHECK_KINDS, "manual"].includes(c.kind)) errors.push(`${w}, check: unknown check kind "${c.kind}"`);
        checkBlocks(c.fail, `${w}, check.fail`, errors);
      }
    });
  });
  if (errors.length > 0) throw new CompileError(errors.join("\n"));
}
