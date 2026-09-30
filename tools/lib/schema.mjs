import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";

const root = new URL("../../", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(`schema/v0/${name}`, root), "utf8"));

export const FORMAT = "kairos-workshop/v0";

let compiled;
function compile() {
  if (!compiled) {
    const ajv = new Ajv({ strict: true, allErrors: true });
    compiled = {
      stage: ajv.compile(read("stage.schema.json")),
      workshop: ajv.compile(read("workshop.schema.json")),
    };
  }
  return compiled;
}

function run(fn, doc) {
  const ok = fn(doc);
  return { ok, errors: ok ? [] : fn.errors.map((e) => `${e.instancePath || "/"} ${e.message}`) };
}

// Each returns { ok, errors: string[] }.
export const validateStageSchema = (doc) => run(compile().stage, doc);
export const validateWorkshopSchema = (doc) => run(compile().workshop, doc);
