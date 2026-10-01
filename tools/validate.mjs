import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { loadWorkshop } from "./lib/load.mjs";
import { githubSlug } from "./lib/slug.mjs";
import { parseStageHref, countInlineStageLinks } from "./lib/links.mjs";
import { VALUES } from "./lib/facts.mjs";
import { PROMPT_PLACEHOLDERS, REQUEST_PLACEHOLDERS } from "./lib/prompt.mjs";

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

const BRACES = /\{([^{}]*)\}/g;

// Every {word} in `text` must be one of `allowed`.
function checkPlaceholders(text, allowed, where) {
  const errors = [];
  for (const m of text.matchAll(BRACES)) if (!allowed.includes(m[1])) errors.push(`${where}: unknown placeholder {${m[1]}}`);
  return errors;
}

// Inline markdown for the game: one paragraph with text, bold, italic, code and https links.
const INLINE_OK = new Set(["text", "strong_open", "strong_close", "em_open", "em_close", "code_inline", "link_open", "link_close", "softbreak"]);

function checkInline(text, where) {
  const errors = [];
  const tokens = md.parse(text, {});
  const single = tokens.length === 3 && tokens[0].type === "paragraph_open" && tokens[1].type === "inline" && tokens[2].type === "paragraph_close";
  if (tokens.some((t) => t.type === "html_block")) return [`${where}: raw HTML is not allowed`];
  if (!single) return [`${where}: only one paragraph of inline markdown is allowed: text, bold, italic, code and links`];
  const plain = [];
  for (const child of tokens[1].children ?? []) {
    if (child.type === "html_inline") errors.push(`${where}: raw HTML is not allowed`);
    else if (!INLINE_OK.has(child.type)) errors.push(`${where}: only one paragraph of inline markdown is allowed: text, bold, italic, code and links`);
    if (child.type === "text") plain.push(child.content);
    if (child.type === "link_open" && !child.attrGet("href")?.startsWith("https://")) errors.push(`${where}: a link must use https`);
  }
  if (ALERT.test(plain.join(""))) errors.push(`${where}: GitHub alert syntax is not allowed`);
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

  if (doc.tip) errors.push(...checkPlaceholders(doc.tip.request, REQUEST_PLACEHOLDERS, "tip.request"));

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

// The loadout rules that the schema cannot express. The loadout must already pass the schema.
function checkLoadout(loadout) {
  const errors = [];
  const asked = new Map();
  loadout.questions.forEach((q, qi) => {
    const at = `loadout.questions[${qi}]`;
    const here = `${at} (${q.fact})`;
    if (asked.has(q.fact)) errors.push(`${at}: the fact "${q.fact}" is already asked by questions[${asked.get(q.fact)}]`);
    else asked.set(q.fact, qi);

    const before = new Set(loadout.questions.slice(0, qi).map((x) => x.fact));
    const refs = (when, where, allowOwn) => {
      for (const fact of Object.keys(when ?? {})) {
        if (!before.has(fact) && !(allowOwn && fact === q.fact)) errors.push(`${where}: when names "${fact}", which is not asked before this question`);
      }
    };
    refs(q.when, here, false);

    const seen = new Set();
    q.options.forEach((o, oi) => {
      if (seen.has(o.value)) errors.push(`${here}: offers the value "${o.value}" twice`);
      seen.add(o.value);
      if (o.forces && q.fact in o.forces) errors.push(`${here}, options[${oi}]: forces its own fact "${q.fact}"`);
      if (o.text) errors.push(...checkInline(o.text, `${here}.options[${oi}].text`));
    });
    for (const value of VALUES[q.fact]) if (!seen.has(value)) errors.push(`${here}: no option for the value "${value}"`);
    if (q.options.filter((o) => o.recommended).length > 1) errors.push(`${here}: more than one recommended option`);

    if (q.text) errors.push(...checkInline(q.text, `${here}.text`));
    if (q.help) errors.push(...checkInline(q.help.text, `${here}.help.text`));
    (q.notes ?? []).forEach((n, ni) => {
      refs(n.when, `${here}, notes[${ni}]`, true);
      errors.push(...checkInline(n.text, `${here}.notes[${ni}].text`));
    });
  });
  return errors;
}

// The semantic rules for workshop.yaml: the welcome pages, the loadout and the prompt templates.
// It must already pass the schema. The `intro` and the stage list are checked in validateWorkshop.
export function checkWorkshop(doc) {
  const errors = [];
  (doc.welcome?.pages ?? []).forEach((page, i) => {
    const where = `welcome.pages[${i}]`;
    errors.push(...checkInline(page, where), ...checkPlaceholders(page, ["name"], where));
  });
  if (doc.loadout) errors.push(...checkLoadout(doc.loadout));
  for (const [kind, template] of Object.entries(doc.prompts ?? {})) errors.push(...checkPlaceholders(template, PROMPT_PLACEHOLDERS, `prompts.${kind}`));
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
  errors.push(...checkWorkshop(loaded.workshop).map((e) => `workshop.yaml: ${e}`));

  const asked = loaded.workshop.loadout ? new Set(loaded.workshop.loadout.questions.map((q) => q.fact)) : undefined;
  for (const s of loaded.stages) {
    if (asked) {
      for (const fact of s.facts) if (!asked.has(fact)) errors.push(`${s.file}: names the fact "${fact}", which the loadout does not ask`);
    }
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
