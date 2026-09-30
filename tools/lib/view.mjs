import { evaluate } from "./when.mjs";

// The visible outline of a stage for a set of facts, as an ordered flat list of records.
// Hidden items are absent. `state` is "shown" or "conditional" (the display rule in SPEC.md).
// The outline follows the render order in SPEC.md but leaves out prose fields.
export function view(stage, facts) {
  const out = [];
  // Add an item unless its `when` evaluates to false. Returns whether it was added.
  const add = (item, when) => {
    const result = evaluate(when, facts);
    if (result === "false") return false;
    out.push({ ...item, state: result === "true" ? "shown" : "conditional" });
    return true;
  };
  const warnings = (list) => {
    for (const w of list ?? []) add({ kind: "warning", warningKind: w.kind }, w.when);
  };
  const commands = (block) => {
    for (const text of block.commands ?? []) out.push({ kind: "command", text });
    if (block.expect !== undefined) out.push({ kind: "expect" });
  };

  for (const section of stage.sections) {
    if (!add({ kind: "section", title: section.title }, section.when)) continue;
    warnings(section.warnings);
    for (const step of section.steps ?? []) {
      if (!add({ kind: "step", id: step.id }, step.when)) continue;
      warnings(step.warnings);
      if (step.variants) {
        let shown = 0;
        for (const variant of step.variants) {
          if (!add({ kind: "variant", id: variant.id }, variant.when)) continue;
          shown++;
          warnings(variant.warnings);
          commands(variant);
        }
        if (shown === 0) out.push({ kind: "no-match", step: step.id });
      }
      commands(step);
      if (step.check) out.push({ kind: "check", checkKind: step.check.kind });
    }
  }
  return out;
}
