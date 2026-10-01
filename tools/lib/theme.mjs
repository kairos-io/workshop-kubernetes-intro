import { normalizeWhen } from "./load.mjs";
import { CompileError, endingOptions, checkLineSections } from "./kai.mjs";

// The compiler for theme.json. The designer owns kai/theme.base.json (mentors, locations, items,
// poses, labels, and the rest of the theme). Four keys of the reader's theme hold data that is ours:
// the welcome pages, the loadout questions, the help prompts and the list of stages. They are
// generated from workshop.yaml and kai/lines.yaml, and replace what the base holds for them.
// Every other key is the base, unchanged. The result has the key order of the base.
export const GENERATED_THEME_KEYS = ["welcome", "loadout", "prompts", "stages"];

// The text in a step template that the reader replaces with the logs the learner pastes.
export const LOGS_TEXT = "[paste your logs or the error here]";

// Our placeholder names that the reader spells in another way.
const RENAMED = { expect: "expected", request: "ask" };

const need = (cond, message) => {
  if (!cond) throw new CompileError(message);
};
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v) => typeof v === "string" && v !== "";

// A template as a list of lines, with the reader's placeholder names and `{logs}` for the paste text.
function templateLines(template, kind) {
  const lines = template.replace(/\n+$/, "").split("\n");
  if (kind === "step") need(lines.some((l) => l.includes(LOGS_TEXT)), `workshop.yaml: prompts.step must hold the text ${LOGS_TEXT} where the learner pastes the logs`);
  return lines.map((l) => l.split(LOGS_TEXT).join("{logs}").replace(/\{([a-z]+)\}/g, (m, name) => (RENAMED[name] ? `{${RENAMED[name]}}` : m)));
}

function checkBase(base) {
  need(isObject(base), "kai/theme.base.json: must be an object");
  need(isObject(base.welcome) && ["mentor", "next", "back", "start"].every((k) => text(base.welcome[k])), "kai/theme.base.json: welcome needs mentor, next, back and start");
  need(isObject(base.loadout) && ["title", "progress", "next", "back", "done"].every((k) => text(base.loadout[k])), "kai/theme.base.json: loadout needs title, progress, next, back and done");
  need(isObject(base.prompts) && ["virtPlaceholder", "logsPlaceholder", "unsetPlaceholder", "noCommands", "warning"].every((k) => text(base.prompts[k])), "kai/theme.base.json: prompts needs virtPlaceholder, logsPlaceholder, unsetPlaceholder, noCommands and warning");
  need(Array.isArray(base.stages), "kai/theme.base.json: stages must be a list");
}

function compileWelcome(base, workshop, lines) {
  const pages = workshop.welcome.pages;
  return { ...base.welcome, pages: pages.map((md, i) => ({ line: lines.welcome[i], md })) };
}

function compileQuestions(base, loadout) {
  const helpIntro = base.loadout.questions?.arch?.help?.md;
  const questions = {};
  for (const q of loadout.questions) {
    const options = {};
    for (const o of q.options) {
      options[o.value] = {
        ...(o.recommended === true && { badge: "recommended" }),
        // The text of an option that ends the flow is the body of its notice, not of the option.
        ...(o.text !== undefined && o.ends !== true && { md: o.text }),
      };
    }
    let help;
    if (q.help) {
      need(text(helpIntro), "kai/theme.base.json: loadout.questions.arch.help.md must be the text that introduces a help command");
      help = { label: q.help.label, md: helpIntro, code: q.help.command, after: q.help.text };
    }
    const when = (q.notes ?? []).map((n) => {
      const only = n.when ? normalizeWhen(n.when) : undefined;
      return { ...(only && { only }), md: n.text };
    });
    questions[q.fact] = {
      title: q.title,
      ...(q.text !== undefined && { md: q.text }),
      options,
      ...(help && { help }),
      ...(when.length > 0 && { when }),
    };
  }
  return questions;
}

function compileNotices(loadout, lines) {
  const notices = {};
  for (const o of endingOptions(loadout)) {
    const n = lines.notices?.[o.value];
    need(n, `kai/lines.yaml needs a notice for the option "${o.value}", which ends the loadout`);
    need(text(o.text), `workshop.yaml: the option "${o.value}" ends the loadout, so it needs a text for its notice`);
    notices[o.value] = { title: n.title, line: n.line, md: o.text };
  }
  return notices;
}

function compilePrompts(base, workshop) {
  return { ...base.prompts, fail: templateLines(workshop.prompts.step, "step"), tip: templateLines(workshop.prompts.tip, "tip") };
}

// `loaded` is the result of loadWorkshop, `lines` the parsed kai/lines.yaml and `base` the parsed
// kai/theme.base.json. Returns the theme object. Throws a CompileError.
export function compileTheme(loaded, lines, base) {
  const { workshop } = loaded;
  checkBase(base);
  for (const key of ["welcome", "loadout", "prompts"]) need(workshop[key], `workshop.yaml needs ${key} for the game`);
  need(lines.welcome !== undefined, "kai/lines.yaml needs welcome, one line for each welcome page");
  checkLineSections(lines, workshop);

  const ids = loaded.stages.map((s) => s.id);
  const generated = {
    welcome: compileWelcome(base, workshop, lines),
    loadout: {
      ...base.loadout,
      questions: compileQuestions(base, workshop.loadout),
      notices: compileNotices(workshop.loadout, lines),
    },
    prompts: compilePrompts(base, workshop),
    // The stages that exist, in the order of workshop.yaml. A stage that the base lists and the workshop lacks drops out.
    stages: ids.map((id) => base.stages.find((s) => s.id === id)).filter(Boolean),
  };

  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = k in generated ? generated[k] : v;
  for (const [k, v] of Object.entries(generated)) if (!(k in out)) out[k] = v;
  return out;
}
