import { LABELS } from "./facts.mjs";

// "macOS or Linux" for one fact, joined with ", " across facts. Accepts scalar or list values.
export function conditionLabel(when) {
  return Object.keys(when)
    .map((fact) => (Array.isArray(when[fact]) ? when[fact] : [when[fact]]).map((v) => LABELS[fact][v]).join(" or "))
    .join(", ");
}

// The sentence for a check. Readers own this wording, except for a manual check, whose `text` is
// the sentence. It continues after "Check: ".
export function checkSentence(check) {
  switch (check.kind) {
    case "command-available":
      return `the \`${check.command}\` command is available in a new terminal.`;
    case "image-exists":
      return `the \`${check.image}\` image is present in your container runtime.`;
    case "iso-exists":
      return "the ISO file exists.";
    case "vm-running":
      return check.name ? `the \`${check.name}\` VM is running.` : "the VM is running.";
    case "manual":
      // A manual check has no parameters to build a sentence from. Its `text` is the sentence.
      return check.text;
    default:
      throw new Error(`unknown check kind: ${check.kind}`);
  }
}

// A check as a full sentence for a reader that shows it on its own line, for example a game.
// Same wording as checkSentence, capitalized, with no markdown.
export function checkPrompt(check) {
  const text = checkSentence(check).replaceAll("`", "");
  return text[0].toUpperCase() + text.slice(1);
}
