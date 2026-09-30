import { FACT_DEFS, FACTS, VALUES } from "./facts.mjs";
import { checkPrompt } from "./labels.mjs";
import { uniqueSlugs } from "./slug.mjs";

// The compiler from the workshop model (stage, sections, steps, variants) to the model of the KAI
// game reader (stage, steps, blocks). The reader's shape is described in kai/README.md.

// Prompts for steps that have no named check. Every KAI step needs one.
export const PROMPTS = {
  step: "You finished this step.",
  read: "You read this.",
  stage: "You finished this stage.",
};

// The KAI step that stands in for a stage that is still plain markdown.
export const MARKDOWN_STEP = { id: "on-github", title: "Continue on GitHub", line: "This part is not in the game yet." };

export const MAX_LINE = 60;

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

function checkOf(step, fallback) {
  return {
    prompt: step.check ? checkPrompt(step.check) : fallback,
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
        check: { prompt: PROMPTS.read, fail: [] },
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
        check: { prompt: PROMPTS.read, fail: [] },
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
      });
    });
  });

  return { id: doc.id, title: stripStageNumber(doc.title), goal: doc.goal, steps };
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
        check: { prompt: PROMPTS.stage, fail: [] },
      },
    ],
  };
}

export function compileFacts() {
  return FACT_DEFS.map((f) => ({ id: f.id, label: f.label, question: f.question, options: f.options.map((o) => ({ id: o.id, label: o.label })) }));
}

// `loaded` is the result of loadWorkshop. `lines` is the parsed kai/lines.yaml.
export function compileWorkshop(loaded, lines = {}) {
  const repository = loaded.workshop.repository;
  const stages = loaded.stages.map((s) => (s.kind === "converted" ? compileStage(s.doc, lines) : compileMarkdownStage(s, repository, lines)));
  const content = { facts: compileFacts(), stages };
  checkLines(content, lines);
  validateContent(content);
  return content;
}

// A line key that matches no step is a typo. A line that is too long does not fit the dialogue box.
function checkLines(content, lines) {
  const keys = new Set(content.stages.flatMap((s) => s.steps.map((st) => `${s.id}/${st.id}`)));
  for (const [key, line] of Object.entries(lines)) {
    if (!keys.has(key)) throw new CompileError(`kai/lines.yaml: the key "${key}" matches no stage and step`);
    if (typeof line !== "string" || line.length === 0 || line.length > MAX_LINE || /[\n<>]/.test(line)) {
      throw new CompileError(`kai/lines.yaml: the line for "${key}" must be plain text of 1 to ${MAX_LINE} characters on one line`);
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

// Throws a CompileError that lists every problem.
export function validateContent(content) {
  const errors = [];
  checkShape(content, ["facts", "stages"], [], "content", errors);
  const stageIds = new Set();
  (content.stages ?? []).forEach((s, si) => {
    const sw = `stage "${s.id}"`;
    checkShape(s, ["id", "title", "goal", "steps"], [], sw, errors);
    if (stageIds.has(s.id)) errors.push(`${sw}: duplicate stage id`);
    stageIds.add(s.id);
    for (const k of ["title", "goal"]) if (typeof s[k] !== "string" || s[k] === "") errors.push(`${sw}: "${k}" must be text`);
    if (!Array.isArray(s.steps) || s.steps.length === 0) errors.push(`${sw}: needs at least one step`);
    const stepIds = new Set();
    (s.steps ?? []).forEach((st) => {
      const w = `${sw}, step "${st.id}"`;
      checkShape(st, ["id", "title", "line", "blocks", "check"], ["optional", "only"], w, errors);
      if (stepIds.has(st.id)) errors.push(`${w}: duplicate step id`);
      stepIds.add(st.id);
      for (const k of ["title", "line"]) if (typeof st[k] !== "string" || st[k] === "") errors.push(`${w}: "${k}" must be text`);
      checkOnly(st.only, w, errors);
      checkBlocks(st.blocks, w, errors);
      if (Array.isArray(st.blocks) && st.blocks.length === 0) errors.push(`${w}: has no blocks`);
      const c = st.check;
      if (!c || typeof c.prompt !== "string" || c.prompt === "") errors.push(`${w}: check.prompt is required`);
      else {
        checkShape(c, ["prompt", "fail"], [], `${w}, check`, errors);
        checkBlocks(c.fail, `${w}, check.fail`, errors);
      }
    });
  });
  if (errors.length > 0) throw new CompileError(errors.join("\n"));
}
