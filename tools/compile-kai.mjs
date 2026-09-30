import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { loadWorkshop } from "./lib/load.mjs";
import { validateWorkshop } from "./validate.mjs";
import { compileWorkshop, CompileError } from "./lib/kai.mjs";

// Stable output: two-space indent, trailing newline, no timestamps.
export const serialize = (content) => JSON.stringify(content, null, 2) + "\n";

function readLines(root) {
  const path = join(root, "kai/lines.yaml");
  if (!existsSync(path)) return {};
  const lines = parse(readFileSync(path, "utf8")) ?? {};
  if (typeof lines !== "object" || Array.isArray(lines)) throw new CompileError("kai/lines.yaml: must be a map from <stage-id>/<step-id> to a line");
  return lines;
}

// Returns the text of content.json for the workshop under `root`. Throws CompileError.
export function compileRoot(root) {
  const errors = validateWorkshop(root);
  if (errors.length > 0) throw new CompileError(errors.map((e) => `${e}`).join("\n"));
  return serialize(compileWorkshop(loadWorkshop(root), readLines(root)));
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

  let text;
  try {
    text = compileRoot(root);
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    for (const line of e.message.split("\n")) console.error(`error: ${line}`);
    return 1;
  }
  const path = join(out, "content.json");
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
      console.error(`content.json is generated from workshop.yaml, the stage files and kai/lines.yaml. Edit those and run \`npm run compile:kai -- --out kai/web\`.`);
      return 1;
    }
    return 0;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
