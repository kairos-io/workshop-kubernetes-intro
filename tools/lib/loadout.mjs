// The loadout flow. It has no dependencies of its own and runs in Node and in the browser.
// See "Loadout" in schema/v0/SPEC.md.
//
// `loadout` is the `loadout` object of workshop.yaml: { questions: [...] }.
// `answers` is an object from fact to value, for example { os: "linux" }.
import { evaluate } from "./when.mjs";

const optionOf = (question, value) => question.options.find((o) => o.value === value);

// The index of the first question whose answered option ends the flow, or -1.
function endsAt(loadout, answers) {
  return loadout.questions.findIndex((q) => {
    const value = answers[q.fact];
    return value !== undefined && optionOf(q, value)?.ends === true;
  });
}

// The next question to ask, or null when the flow is done. It is the first question, in order,
// that is not answered yet, whose `when` is true under the answers so far, and that does not
// come after a question whose chosen option ends the flow.
export function nextQuestion(loadout, answers = {}) {
  const end = endsAt(loadout, answers);
  const limit = end < 0 ? loadout.questions.length : end;
  for (let i = 0; i < limit; i++) {
    const q = loadout.questions[i];
    const value = answers[q.fact];
    if (value !== undefined && value !== null && value !== "") continue;
    if (q.when && evaluate(q.when, answers) !== "true") continue;
    return q;
  }
  return null;
}

// The answers after the reader picks `value` for `fact`: the old answers, the new one, and the
// facts that the chosen option forces. The input is not changed.
export function applyAnswer(loadout, answers, fact, value) {
  const question = loadout.questions.find((q) => q.fact === fact);
  if (!question) throw new Error(`the loadout does not ask about "${fact}"`);
  const option = optionOf(question, value);
  if (!option) throw new Error(`"${value}" is not an option of the "${fact}" question`);
  return { ...answers, [fact]: value, ...option.forces };
}
