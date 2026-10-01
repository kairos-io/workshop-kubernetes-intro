import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { loadWorkshop } from "./lib/load.mjs";
import { validateWorkshop } from "./validate.mjs";
import { compileWorkshop, CompileError } from "./lib/kai.mjs";
import { compileTheme } from "./lib/theme.mjs";

// Stable output: two-space indent, trailing newline, no timestamps.
export const serialize = (content) => JSON.stringify(content, null, 2) + "\n";

function readLines(root) {
  const path = join(root, "kai/lines.yaml");
  if (!existsSync(path)) return {};
  const lines = parse(readFileSync(path, "utf8")) ?? {};
  if (typeof lines !== "object" || Array.isArray(lines)) throw new CompileError("kai/lines.yaml: must be a map from <stage-id>/<step-id> to a line");
  return lines;
}

function readBase(root) {
  const path = join(root, "kai/theme.base.json");
  if (!existsSync(path)) throw new CompileError("kai/theme.base.json: file does not exist. It is the designer's theme, saved without the generated keys edited");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new CompileError(`kai/theme.base.json: not valid JSON (${e.message})`);
  }
}

// Returns { content, theme }: the text of content.json and of theme.json for the workshop under `root`.
// Throws CompileError.
export function compileRootFiles(root) {
  const errors = validateWorkshop(root);
  if (errors.length > 0) throw new CompileError(errors.map((e) => `${e}`).join("\n"));
  const loaded = loadWorkshop(root);
  const lines = readLines(root);
  return {
    content: serialize(compileWorkshop(loaded, lines)),
    theme: serialize(compileTheme(loaded, lines, readBase(root))),
  };
}

function main(argv) {
  const args = [...argv];
  const check = args.includes("--check");
  const at = args.indexOf("--out");
  if (at < 0 || !args[at + 1]) {
    console.error("usage: node tools/compile-kai.mjs [--check] --out <dir> [root]");
    return 2;
  }
  const out = resolve(args[at + 1]);
  const rest = args.filter((a, i) => a !== "--check" && a !== "--out" && i !== at + 1);
  const root = resolve(rest[0] ?? fileURLToPath(new URL("../", import.meta.url)));

  let files;
  try {
    files = compileRootFiles(root);
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    for (const line of e.message.split("\n")) console.error(`error: ${line}`);
    return 1;
  }
  const targets = [
    ["content.json", files.content, "workshop.yaml, the stage files and kai/lines.yaml"],
    ["theme.json", files.theme, "workshop.yaml, kai/lines.yaml and kai/theme.base.json"],
  ];
  if (check) {
    let stale = false;
    for (const [name, text, sources] of targets) {
      const path = join(out, name);
      if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
        console.error(`${name} is generated from ${sources}. Edit those and run \`npm run compile:kai -- --out kai/web\`.`);
        stale = true;
      }
    }
    return stale ? 1 : 0;
  }
  mkdirSync(out, { recursive: true });
  for (const [name, text] of targets) {
    writeFileSync(join(out, name), text);
    console.log(`wrote ${join(out, name)}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
