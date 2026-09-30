import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { FACTS } from "./facts.mjs";
import { uniqueSlugs } from "./slug.mjs";
import { validateStageSchema, validateWorkshopSchema } from "./schema.mjs";

// Turn scalar values into one item lists, so every reader sees the same shape.
export function normalizeWhen(when) {
  if (!when) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(when)) out[key] = Array.isArray(value) ? [...value] : [value];
  return out;
}

function normalizeWarnings(warnings) {
  return warnings?.map((w) => ({ ...w, when: normalizeWhen(w.when) }));
}

function withWhen(item) {
  const out = { ...item };
  if (item.when) out.when = normalizeWhen(item.when);
  if (item.warnings) out.warnings = normalizeWarnings(item.warnings);
  return out;
}

export function normalizeStage(doc) {
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...withWhen(section),
      ...(section.steps && {
        steps: section.steps.map((step) => ({
          ...withWhen(step),
          ...(step.variants && { variants: step.variants.map(withWhen) }),
        })),
      }),
    })),
  };
}

// The facts a normalized stage refers to, in the fixed fact order.
export function referencedFacts(doc) {
  const used = new Set();
  const add = (when) => when && Object.keys(when).forEach((k) => used.add(k));
  for (const section of doc.sections) {
    add(section.when);
    section.warnings?.forEach((w) => add(w.when));
    for (const step of section.steps ?? []) {
      add(step.when);
      step.warnings?.forEach((w) => add(w.when));
      for (const v of step.variants ?? []) {
        add(v.when);
        v.warnings?.forEach((w) => add(w.when));
      }
    }
  }
  return FACTS.filter((f) => used.has(f));
}

function readYaml(root, file, errors) {
  const path = join(root, file);
  if (!existsSync(path)) {
    errors.push(`${file}: file does not exist`);
    return undefined;
  }
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (e) {
    errors.push(`${file}: not valid YAML (${e.message.split("\n")[0]})`);
    return undefined;
  }
}

// Load workshop.yaml and every converted stage under `root`.
// Returns { ok: false, errors } or { ok: true, workshop, stages, facts }.
// Each stage is { id, title, kind, file?, markdown?, doc?, slugs?, next, facts }.
export function loadWorkshop(root) {
  const errors = [];
  const workshop = readYaml(root, "workshop.yaml", errors);
  if (!workshop) return { ok: false, errors };
  const shape = validateWorkshopSchema(workshop);
  if (!shape.ok) return { ok: false, errors: shape.errors.map((e) => `workshop.yaml: ${e}`) };

  const stages = workshop.stages.map((entry) => {
    if (entry.markdown) return { id: entry.id, title: entry.title, kind: "markdown", markdown: entry.markdown, facts: [] };
    const raw = readYaml(root, entry.file, errors);
    if (!raw) return { id: entry.file, title: entry.file, kind: "converted", file: entry.file, facts: [], broken: true };
    const result = validateStageSchema(raw);
    if (!result.ok) {
      for (const e of result.errors) errors.push(`${entry.file}: ${e}`);
      return { id: raw.id ?? entry.file, title: raw.title ?? entry.file, kind: "converted", file: entry.file, facts: [], broken: true };
    }
    const doc = normalizeStage(raw);
    return {
      id: doc.id,
      title: doc.title,
      kind: "converted",
      file: entry.file,
      doc,
      slugs: null,
      facts: referencedFacts(doc),
    };
  });
  if (errors.length > 0) return { ok: false, errors };

  for (const s of stages) if (s.doc) s.slugs = uniqueSlugs(s.doc.sections.map((sec) => sec.title));

  stages.forEach((s, i) => {
    const n = stages[i + 1];
    s.next = n ? { id: n.id, title: n.title, file: n.kind === "converted" ? `${n.id}.md` : n.markdown, converted: n.kind === "converted" } : null;
  });
  const used = new Set(stages.flatMap((s) => s.facts));
  return { ok: true, workshop, stages, facts: FACTS.filter((f) => used.has(f)) };
}
