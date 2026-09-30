import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { loadWorkshop } from "./lib/load.mjs";
import { githubSlug } from "./lib/slug.mjs";
import { parseStageHref, countInlineStageLinks } from "./lib/links.mjs";

// Parse with html: true so raw HTML shows up as tokens we can reject.
const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const ALERT = /\[![A-Za-z]+\]/;

// Check one markdown field. Returns a list of error strings.
function checkMarkdown(text, where, ctx) {
  const errors = [];
  for (const token of md.parse(text, {})) {
    if (token.type === "html_block") errors.push(`${where}: raw HTML is not allowed`);
    if (token.type !== "inline") continue;
    const plain = [];
    for (const child of token.children ?? []) {
      if (child.type === "html_inline") errors.push(`${where}: raw HTML is not allowed`);
      if (child.type === "text") plain.push(child.content);
      if (child.type === "link_open" || child.type === "image") {
        const href = child.type === "link_open" ? child.attrGet("href") : child.attrGet("src");
        const problem = checkLink(href, ctx);
        if (problem) errors.push(`${where}: ${problem}`);
      }
    }
    if (ALERT.test(plain.join(""))) errors.push(`${where}: GitHub alert syntax is not allowed, use warnings`);
  }
  // Publishers resolve the inline form only. A stage link written another way would pass through unresolved.
  const parsed = md.parse(text, {}).flatMap((t) => t.children ?? []).filter((c) => c.type === "link_open" && c.attrGet("href")?.startsWith("stage:")).length;
  if (parsed !== countInlineStageLinks(text)) errors.push(`${where}: write a stage link as [text](stage:id) or [text](stage:id#section)`);
  return errors;
}

// A `stage:<id>[#anchor]` link. The id must name a stage. For a converted stage the anchor must be a section slug.
function checkStageLink(href, ctx) {
  const { id, anchor } = parseStageHref(href);
  const target = ctx.stages?.get(id);
  if (!target) return `link ${href} names the stage "${id}", which does not exist`;
  if (anchor && target.slugs && !target.slugs.has(anchor)) return `link ${href} names no section "${anchor}" in stage "${id}"`;
  return undefined;
}

function checkLink(href, ctx) {
  if (href?.startsWith("stage:")) return checkStageLink(href, ctx);
  if (!href || SCHEME.test(href) || href.startsWith("#") || href.startsWith("/")) return undefined;
  const [path, anchor] = href.split("#");
  if (!path.endsWith(".md")) return undefined;
  const converted = ctx.converted?.get(path);
  if (converted) {
    if (anchor && !converted.has(anchor)) return `link ${href} names no section "${anchor}" in ${path}`;
    return undefined;
  }
  const full = resolve(ctx.root, path);
  if (!full.startsWith(resolve(ctx.root) + sep) || !existsSync(full)) return `link ${href} names ${path}, which does not exist`;
  return undefined;
}

// The semantic rules for one stage document (raw or normalized). It must already pass the schema.
// ctx: { root, stages: Map<id, { slugs: Set<slug> | null }>, converted: Map<"stage-<n>.md", Set<slug>> }, see buildContext
export function checkStage(doc, ctx) {
  const errors = [];
  const md_ = (text, where) => text && errors.push(...checkMarkdown(text, where, ctx));
  const warnings = (list, where) => list?.forEach((w, i) => md_(w.text, `${where}.warnings[${i}].text`));

  const anchors = new Set();
  doc.sections.forEach((s, i) => {
    const anchor = githubSlug(s.title);
    if (anchors.has(anchor)) errors.push(`sections[${i}]: duplicate section anchor "${anchor}"`);
    anchors.add(anchor);
  });

  const stepIds = new Set();
  doc.sections.forEach((section, si) => {
    const sw = `sections[${si}]`;
    md_(section.text, `${sw}.text`);
    warnings(section.warnings, sw);
    (section.steps ?? []).forEach((step, ti) => {
      const tw = `${sw}.steps[${ti}]`;
      if (stepIds.has(step.id)) errors.push(`${tw}: duplicate step id "${step.id}"`);
      stepIds.add(step.id);
      md_(step.text, `${tw}.text`);
      md_(step.after, `${tw}.after`);
      md_(step.onFail, `${tw}.onFail`);
      warnings(step.warnings, tw);
      const variantIds = new Set();
      (step.variants ?? []).forEach((v, vi) => {
        const vw = `${tw}.variants[${vi}]`;
        if (variantIds.has(v.id)) errors.push(`${vw}: duplicate variant id "${v.id}" in step "${step.id}"`);
        variantIds.add(v.id);
        md_(v.text, `${vw}.text`);
        md_(v.after, `${vw}.after`);
        warnings(v.warnings, vw);
      });
    });
  });
  return errors;
}

// The lookup tables the semantic rules need, from a loaded workshop.
export function buildContext(loaded, root) {
  const stages = new Map(loaded.stages.map((s) => [s.id, { slugs: s.slugs ? new Set(s.slugs) : null }]));
  const converted = new Map(loaded.stages.filter((s) => s.kind === "converted").map((s) => [s.outFile, new Set(s.slugs)]));
  return { root, stages, converted };
}

// Validate a whole workshop tree. Returns a list of error strings, empty when valid.
export function validateWorkshop(root) {
  const loaded = loadWorkshop(root);
  if (!loaded.ok) return loaded.errors;
  const errors = [];
  const ids = new Set();
  for (const s of loaded.stages) {
    if (ids.has(s.id)) errors.push(`workshop.yaml: duplicate stage id "${s.id}"`);
    ids.add(s.id);
  }
  const ctx = buildContext(loaded, root);
  const intro = loaded.workshop.intro;
  if (intro) errors.push(...checkMarkdown(intro, "workshop.yaml intro", ctx));

  for (const s of loaded.stages) {
    if (s.kind === "markdown") {
      if (!existsSync(join(root, s.markdown))) errors.push(`workshop.yaml: ${s.markdown} does not exist (stage "${s.id}")`);
      continue;
    }
    const expected = s.file.replace(/^stages\//, "").replace(/\.yaml$/, "");
    if (s.id !== expected) errors.push(`${s.file}: id "${s.id}" does not match its file name "${expected}"`);
    errors.push(...checkStage(s.doc, ctx).map((e) => `${s.file}: ${e}`));
  }
  return errors;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url)));
  const errors = validateWorkshop(root);
  if (errors.length > 0) {
    for (const e of errors) console.error(`error: ${e}`);
    process.exit(1);
  }
  const { stages } = loadWorkshop(root);
  const n = stages.filter((s) => s.kind === "converted").length;
  console.log(`ok: workshop.yaml, ${n} converted stage${n === 1 ? "" : "s"}, ${stages.length - n} markdown stages`);
}
