import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The designer's engine is a browser script. Give it the four things it touches: window,
// fetch (for the three json files), localStorage and TextEncoder (Node has the last one).
export const web = join(new URL("../../", import.meta.url).pathname, "kai/web");

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, String(v)), removeItem: (k) => void store.delete(k) };
globalThis.fetch = async (file) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(join(web, file), "utf8")) });
await import(pathToFileURL(join(web, "kai-engine.js")).href);
export const E = window.KAIE;
await E.load();
