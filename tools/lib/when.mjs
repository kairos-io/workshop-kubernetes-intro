// The `when` evaluator. It has no dependencies and runs in Node and in the browser.
// The site copies this file verbatim to _site/assets/when.js.
//
// evaluate(when, facts) returns "true", "false" or "unknown". See schema/v0/SPEC.md.
// - "false" if any fact that is set is not allowed by `when`.
// - Otherwise "unknown" if any fact that `when` names is not set.
// - Otherwise "true".
export function evaluate(when, facts) {
  if (!when) return "true";
  const known = facts || {};
  let unknown = false;
  for (const key of Object.keys(when)) {
    const allowed = Array.isArray(when[key]) ? when[key] : [when[key]];
    const value = known[key];
    if (value === undefined || value === null || value === "") {
      unknown = true;
      continue;
    }
    if (!allowed.includes(value)) return "false";
  }
  return unknown ? "unknown" : "true";
}
