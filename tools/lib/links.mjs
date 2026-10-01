// Links between stages. In any markdown field, a link target `stage:<id>` or `stage:<id>#<anchor>`
// names another stage by id. Publishers resolve it. Only the inline form `[text](stage:id)` is supported.

export const STAGE_SCHEME = "stage:";

// Split a `stage:` target. Returns { id, anchor } (anchor may be undefined) or undefined if it is not one.
export function parseStageHref(href) {
  if (typeof href !== "string" || !href.startsWith(STAGE_SCHEME)) return undefined;
  const [id, anchor] = href.slice(STAGE_SCHEME.length).split("#");
  return { id, anchor };
}

const INLINE = /\]\((stage:[^)\s]*)\)/g;

// How many inline `stage:` links a markdown text holds, as the rewriter below sees them.
export function countInlineStageLinks(text) {
  return [...text.matchAll(INLINE)].length;
}

// Replace every inline `stage:` link target with resolve(id, anchor).
export function rewriteStageLinks(text, resolve) {
  return text.replace(INLINE, (whole, href) => {
    const { id, anchor } = parseStageHref(href);
    return `](${resolve(id, anchor)})`;
  });
}
