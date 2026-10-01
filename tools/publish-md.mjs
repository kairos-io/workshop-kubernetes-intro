import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkshop } from "./lib/load.mjs";
import { conditionLabel, checkSentence } from "./lib/labels.mjs";
import { rewriteStageLinks } from "./lib/links.mjs";

const trim = (s) => s.replace(/\s+$/, "");

const unresolved = (id) => {
  throw new Error(`cannot resolve a link to stage "${id}" without a workshop`);
};

// A code fence longer than any run of backticks inside the code.
function fence(code, info) {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((r) => r.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${info}\n${trim(code)}\n${ticks}`;
}

// The "Choose your setup" section. The loadout is the same for every reader, so all of it shows:
// every option and every note, with the condition of a question written out below its heading.
function renderLoadout(loadout) {
  const blocks = ["## Choose your setup"];
  const optionLabel = (fact, value) => loadout.questions.find((q) => q.fact === fact)?.options.find((o) => o.value === value)?.label ?? value;
  for (const q of loadout.questions) {
    blocks.push(`### ${q.title}`);
    if (q.when) blocks.push(`*Only if you use: ${conditionLabel(q.when)}.*`);
    if (q.text) blocks.push(trim(q.text));
    blocks.push(
      q.options
        .map((o) => {
          const label = o.recommended ? `**${o.label}** (recommended)` : o.text ? `**${o.label}:**` : `**${o.label}**`;
          return o.text ? `- ${label}${o.recommended ? ":" : ""} ${trim(o.text)}` : `- ${label}`;
        })
        .join("\n"),
    );
    if (q.help) blocks.push(`${q.help.label} Run \`${q.help.command}\`. ${trim(q.help.text)}`);
    for (const note of q.notes ?? []) {
      const facts = Object.keys(note.when ?? {});
      if (facts.length === 1) {
        const values = Array.isArray(note.when[facts[0]]) ? note.when[facts[0]] : [note.when[facts[0]]];
        blocks.push(`If you chose ${values.map((v) => optionLabel(facts[0], v)).join(" or ")}: ${trim(note.text)}`);
      } else {
        blocks.push(trim(note.text));
      }
    }
  }
  return blocks;
}

// Render one converted stage as GitHub markdown. This is a reader with no facts set:
// every conditional item shows with its condition written out below its heading.
// `n` is the 1-based position of the stage in workshop.yaml. `next` is { n, title, file } or null.
// `stageHref(id, anchor)` resolves a `stage:` link to a file name and an optional anchor.
// `loadout` is the loadout of workshop.yaml. Pass it for the first stage to get the "Choose your setup" section.
export function renderStage(stage, { n, next, stageHref = unresolved, loadout } = {}) {
  const blocks = [];
  const add = (text) => blocks.push(text);
  // Markdown from the stage file, with links to other stages resolved.
  const md = (text) => rewriteStageLinks(trim(text), stageHref);

  const only = (when) => when && add(`*Only if you use: ${conditionLabel(when)}.*`);
  const warnings = (list) => {
    for (const w of list ?? []) {
      const prefix = w.when ? `**If you use ${conditionLabel(w.when)}:** ` : "";
      const lines = (prefix + md(w.text)).split("\n");
      add([`> [!${w.kind.toUpperCase()}]`, ...lines.map((l) => (l ? `> ${l}` : ">"))].join("\n"));
    }
  };
  const body = (b) => {
    if (b.text) add(md(b.text));
    warnings(b.warnings);
  };
  const commands = (b) => {
    for (const c of b.commands ?? []) add(fence(c, "bash"));
    if (b.expect !== undefined) {
      add("Expected output:");
      add(fence(b.expect, "text"));
    }
    if (b.after) add(md(b.after));
  };

  add(`<!-- Generated from stages/${stage.id}.yaml by tools/publish-md.mjs. Do not edit by hand. -->`);
  add(`# Stage ${n}: ${stage.title}`);
  if (stage.docs) add(["Docs:", ...stage.docs.map((d) => `  - [${d.title}](${d.url})`)].join("\n"));
  if (loadout) renderLoadout(loadout).forEach(add);

  for (const section of stage.sections) {
    add(`## ${section.title}`);
    only(section.when);
    body(section);
    for (const step of section.steps ?? []) {
      if (step.title) add(`### ${step.title}`);
      only(step.when);
      body(step);
      for (const variant of step.variants ?? []) {
        add(`${step.title ? "####" : "###"} ${variant.title}`);
        only(variant.when);
        body(variant);
        commands(variant);
      }
      commands(step);
      if (step.check) add(`*Check: ${checkSentence(step.check)}*`);
      if (step.check?.verify) {
        add("To check, run:");
        add(fence(step.check.verify.command, "bash"));
        if (step.check.verify.output !== undefined) {
          add("Example output:");
          add(fence(step.check.verify.output, "text"));
        }
      }
      if (step.onFail) add(`<details><summary>If it does not work</summary>\n\n${md(step.onFail)}\n\n</details>`);
    }
  }
  if (next) add(`→ [Stage ${next.n}: ${next.title}](${next.file})`);
  return blocks.join("\n\n") + "\n";
}

function main(argv) {
  const check = argv.includes("--check");
  const rest = argv.filter((a) => a !== "--check");
  const root = resolve(rest[0] ?? fileURLToPath(new URL("../", import.meta.url)));
  const loaded = loadWorkshop(root);
  if (!loaded.ok) {
    for (const e of loaded.errors) console.error(`error: ${e}`);
    return 1;
  }
  const byId = new Map(loaded.stages.map((x) => [x.id, x]));
  const stageHref = (id, anchor) => `${byId.get(id).outFile}${anchor ? `#${anchor}` : ""}`;
  let stale = 0;
  for (const s of loaded.stages.filter((x) => x.kind === "converted")) {
    const name = s.outFile;
    const path = join(root, name);
    const text = renderStage(s.doc, { n: s.n, next: s.next, stageHref, loadout: s.n === 1 ? loaded.workshop.loadout : undefined });
    if (check) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
        console.error(`${name} is generated from ${s.file}. Edit the YAML and run \`npm run publish:md\`.`);
        stale++;
      }
    } else {
      writeFileSync(path, text);
      console.log(`wrote ${name}`);
    }
  }
  return stale > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
