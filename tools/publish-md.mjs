import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkshop } from "./lib/load.mjs";
import { conditionLabel, checkSentence } from "./lib/labels.mjs";

const trim = (s) => s.replace(/\s+$/, "");

// A code fence longer than any run of backticks inside the code.
function fence(code, info) {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((r) => r.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${info}\n${trim(code)}\n${ticks}`;
}

// Render one converted stage as GitHub markdown. This is a reader with no facts set:
// every conditional item shows with its condition written out below its heading.
// `next` is { title, file } or null.
export function renderStage(stage, next) {
  const blocks = [];
  const add = (text) => blocks.push(text);

  const only = (when) => when && add(`*Only if you use: ${conditionLabel(when)}.*`);
  const warnings = (list) => {
    for (const w of list ?? []) {
      const prefix = w.when ? `**If you use ${conditionLabel(w.when)}:** ` : "";
      const lines = (prefix + trim(w.text)).split("\n");
      add([`> [!${w.kind.toUpperCase()}]`, ...lines.map((l) => (l ? `> ${l}` : ">"))].join("\n"));
    }
  };
  const body = (b) => {
    if (b.text) add(trim(b.text));
    warnings(b.warnings);
  };
  const commands = (b) => {
    for (const c of b.commands ?? []) add(fence(c, "bash"));
    if (b.expect !== undefined) {
      add("Expected output:");
      add(fence(b.expect, "text"));
    }
    if (b.after) add(trim(b.after));
  };

  add(`<!-- Generated from stages/${stage.id}.yaml by tools/publish-md.mjs. Do not edit by hand. -->`);
  add(`# ${stage.title}`);
  if (stage.docs) add(["Docs:", ...stage.docs.map((d) => `  - [${d.title}](${d.url})`)].join("\n"));

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
      if (step.onFail) add(`<details><summary>If it does not work</summary>\n\n${trim(step.onFail)}\n\n</details>`);
    }
  }
  if (next) add(`→ [${next.title}](${next.file})`);
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
  let stale = 0;
  for (const s of loaded.stages.filter((x) => x.kind === "converted")) {
    const name = `${s.id}.md`;
    const path = join(root, name);
    const text = renderStage(s.doc, s.next);
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
