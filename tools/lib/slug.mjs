// The GitHub heading slug: lower case, drop everything except letters, numbers,
// underscores, hyphens and spaces, then turn each space into a hyphen.
export function githubSlug(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "")
    .replace(/ /g, "-");
}

// Slugs for a list of titles. A repeated slug gets -1, -2, and so on, like GitHub.
export function uniqueSlugs(titles) {
  const seen = new Map();
  return titles.map((title) => {
    const base = githubSlug(title);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  });
}
