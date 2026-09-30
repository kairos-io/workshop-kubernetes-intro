import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import MarkdownIt from "markdown-it";
import { parse } from "yaml";
import { renderStage } from "../tools/publish-md.mjs";
import { conditionLabel, checkSentence } from "../tools/lib/labels.mjs";
import { loadWorkshop } from "../tools/lib/load.mjs";
import { view } from "../tools/lib/view.mjs";
import { githubSlug } from "../tools/lib/slug.mjs";

const root = new URL("../", import.meta.url).pathname;
const stage = parse(readFileSync(join(root, "stages/stage-1.yaml"), "utf8"));
const next = loadWorkshop(root).stages[0].next;
const output = renderStage(stage, next);
const tokens = new MarkdownIt().parse(output, {});

test("the first line is the generated-file banner", () => {
  assert.equal(
    output.split("\n")[0],
    "<!-- Generated from stages/stage-1.yaml by tools/publish-md.mjs. Do not edit by hand. -->",
  );
});

test("the five section headings appear verbatim", () => {
  for (const heading of [
    "## Before we begin",
    "## Installing kairos-lab",
    "## Set up dependencies",
    "## Not using kairos-lab? Get AuroraBoot yourself",
    "## Build it locally (Linux only)",
  ]) {
    assert.ok(output.split("\n").includes(heading), heading);
  }
});

test("the section anchors are the five published anchors", () => {
  const anchors = tokens
    .filter((t, i) => t.type === "heading_open" && t.tag === "h2")
    .map((t) => githubSlug(tokens[tokens.indexOf(t) + 1].content));
  assert.deepEqual(anchors, [
    "before-we-begin",
    "installing-kairos-lab",
    "set-up-dependencies",
    "not-using-kairos-lab-get-auroraboot-yourself",
    "build-it-locally-linux-only",
  ]);
});

test("no heading carries a condition", () => {
  for (const t of tokens.filter((t) => t.type === "heading_open")) {
    const text = tokens[tokens.indexOf(t) + 1].content;
    assert.ok(!/only|macos|linux only/i.test(text) || text === "Build it locally (Linux only)", text);
  }
});

test("the title and the docs list come first", () => {
  const lines = output.split("\n");
  assert.equal(lines[2], "# Stage 1: Setting up kairos-lab");
  assert.equal(lines[4], "Docs:");
  assert.equal(lines[5], "  - [kairos-lab](https://github.com/kairos-io/kairos-lab)");
  assert.equal(lines[6], "  - [AuroraBoot](https://kairos.io/docs/reference/auroraboot/)");
});

test("every command from the outline with no facts appears in a bash fence", () => {
  const fences = tokens.filter((t) => t.type === "fence" && t.info.trim() === "bash").map((t) => t.content.trimEnd());
  const commands = view(stage, {}).filter((i) => i.kind === "command").map((i) => i.text.trimEnd());
  assert.ok(commands.length >= 10);
  assert.deepEqual(fences, commands);
});

test("every warning is an alert", () => {
  const count = (list) => (list ?? []).length;
  let want = 0;
  for (const s of stage.sections) {
    want += count(s.warnings);
    for (const st of s.steps ?? []) {
      want += count(st.warnings);
      for (const v of st.variants ?? []) want += count(v.warnings);
    }
  }
  const alerts = output.split("\n").filter((l) => /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/.test(l));
  assert.equal(alerts.length, want);
  assert.equal(want, 4);
  assert.ok(output.includes("> [!CAUTION]\n> **If you use Windows:** `kairos-lab` only works on Linux and macOS."));
});

test("a conditional item has a label below its heading", () => {
  assert.ok(output.includes("### Homebrew\n\n*Only if you use: macOS.*\n"));
  assert.ok(output.includes("## Installing kairos-lab\n\n*Only if you use: kairos-lab.*\n"));
  assert.ok(output.includes("*Only if you use: macOS or Linux.*"));
});

test("checks and onFail are rendered", () => {
  assert.ok(output.includes("*Check: the `kairos-lab` command is available in a new terminal.*"));
  assert.ok(output.includes("*Check: the `auroraboot` command is available in a new terminal.*"));
  assert.ok(output.includes("<details><summary>If it does not work</summary>"));
  assert.equal((output.match(/<\/details>/g) ?? []).length, 2);
});

test("a warning comes before the commands it warns about", () => {
  const note = output.indexOf("If `kairos-lab setup` installed the container runtime");
  const command = output.indexOf("kairos-lab setup\n```");
  assert.ok(note > 0 && command > note);
});

test("the outbound link to stage 3 is kept and the last line points at stage 2", () => {
  assert.ok(output.includes("[Using Podman on MacOS](stage-3.md#alternative-using-podman-on-macos)"));
  assert.equal(output.trimEnd().split("\n").at(-1), "→ [Stage 2: Deploying a single node cluster](stage-2.md)");
  assert.ok(output.endsWith("\n") && !output.endsWith("\n\n"));
});

test("the output has no em dashes and no double blank lines", () => {
  assert.ok(!output.includes(String.fromCharCode(0x2014)));
  assert.ok(!/\n\n\n/.test(output));
});

test("a second run is byte-identical", () => {
  assert.equal(renderStage(stage, next), output);
});

test("the committed stage-1.md equals the generated output", () => {
  assert.equal(readFileSync(join(root, "stage-1.md"), "utf8"), output);
});

test("labels", () => {
  assert.equal(conditionLabel({ os: ["macos", "linux"] }), "macOS or Linux");
  assert.equal(conditionLabel({ os: "linux", runtime: "docker" }), "Linux, Docker");
  assert.equal(conditionLabel({ virtualization: "other" }), "your own virtualization software");
  assert.equal(checkSentence({ kind: "command-available", command: "x" }), "the `x` command is available in a new terminal.");
  assert.equal(checkSentence({ kind: "image-exists", image: "a/b:c" }), "the `a/b:c` image is present in your container runtime.");
  assert.equal(checkSentence({ kind: "iso-exists" }), "the ISO file exists.");
  assert.equal(checkSentence({ kind: "vm-running" }), "the VM is running.");
  assert.equal(checkSentence({ kind: "vm-running", name: "demo" }), "the `demo` VM is running.");
});

test("a fence is longer than any backtick run inside the command", () => {
  const doc = { format: "kairos-workshop/v0", id: "x", title: "X", sections: [{ title: "S", steps: [{ id: "s", commands: ["echo '```'"] }] }] };
  assert.ok(renderStage(doc, null).includes("````bash\necho '```'\n````"));
});

test("optional steps and step text render", () => {
  assert.ok(output.includes("You do not need to run this now. You will use it at the end of stage 3."));
});

// The command line tool, run on a copy of the tree.
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), "ws-pub-"));
  for (const f of ["workshop.yaml", "stage-1.md", "stage-2.md"]) cpSync(join(root, f), join(dir, f));
  mkdirSync(join(dir, "stages"));
  cpSync(join(root, "stages/stage-1.yaml"), join(dir, "stages/stage-1.yaml"));
  for (let n = 3; n <= 7; n++) writeFileSync(join(dir, `stage-${n}.md`), `# stage ${n}\n`);
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [join(root, "tools/publish-md.mjs"), ...args, dir], { encoding: "utf8" });

test("--check passes on the committed tree", () => {
  const r = spawnSync(process.execPath, [join(root, "tools/publish-md.mjs"), "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("--check fails with a clear message when the file is stale", () => {
  const dir = copyTree();
  writeFileSync(join(dir, "stage-1.md"), "# edited by hand\n");
  const r = run(dir, "--check");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stage-1\.md is generated from stages\/stage-1\.yaml\. Edit the YAML and run `npm run publish:md`\./);
  assert.equal(readFileSync(join(dir, "stage-1.md"), "utf8"), "# edited by hand\n", "--check must not write");
});

test("--check fails when the generated file is missing", () => {
  const dir = copyTree();
  rmSync(join(dir, "stage-1.md"));
  assert.equal(run(dir, "--check").status, 1);
});

test("a normal run writes the file and leaves markdown stages alone", () => {
  const dir = copyTree();
  writeFileSync(join(dir, "stage-1.md"), "stale\n");
  const before = readFileSync(join(dir, "stage-2.md"), "utf8");
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dir, "stage-1.md"), "utf8"), output);
  assert.equal(readFileSync(join(dir, "stage-2.md"), "utf8"), before);
  assert.equal(run(dir, "--check").status, 0);
  const again = readFileSync(join(dir, "stage-1.md"), "utf8");
  run(dir);
  assert.equal(readFileSync(join(dir, "stage-1.md"), "utf8"), again);
});
