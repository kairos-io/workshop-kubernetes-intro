# content.json: the workshop data for the KAI reader

`web/content.json` holds everything the reader shows that is not theme: the welcome pages, the questions that set up the learner's loadout, the help prompt templates, and the stages with their steps. It is generated. Do not edit it by hand. The reader loads it as plain JSON and needs nothing else to know what to show.

Theme (mentors, locations, items, poses, game lines for the world) is in `web/theme.json` and is not described here.

A reader must ignore a field it does not know. New fields can appear in later versions.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `facts` | list | The four facts the reader tracks, with a display label, the question and the answer labels. |
| `welcome` | object | `{ pages: [text, ...] }`. 1 to 10 pages shown before anything else. |
| `loadout` | object | `{ questions: [...] }`. The ordered questions that fill in the facts. |
| `prompts` | object | `{ step, tip }`. Two templates for help prompts. |
| `stages` | list | The stages, in the order of the route. |

The keys come in this order: `facts`, `welcome`, `loadout`, `prompts`, `stages`.

## Facts and the `only` rule

A fact is something the learner tells the game about their setup. There are four, with fixed ids and values:

| Fact | Values |
|---|---|
| `os` | `linux`, `macos`, `windows` |
| `virtualization` | `kairos-lab`, `own` |
| `arch` | `amd64`, `arm64` |
| `runtime` | `docker`, `podman` |

A fact can be unset. Every part of the reader must work with any subset of the facts set.

`facts` in `content.json` is a list of `{ id, label, question, options: [{ id, label }] }`, in the fixed order `virtualization`, `os`, `arch`, `runtime`. `label` is the name of the fact (Virtualization, OS, Architecture, Container runtime). `question` is the question title from the loadout. Each option `label` is what the learner reads (the `virtualization` values read "Zen" for `kairos-lab` and "Master" for `own`). A fact that the loadout does not ask is not in the list.

`only` is an object that maps a fact to a non-empty list of values. It appears on steps, blocks, alternative items, `notSkippableWhen` and a tip. It means: show this item only for these values. Several facts in one `only` must all match. An item with no `only` always shows.

To check an `only` against the learner's facts:

1. If a fact in `only` is set and its value is not in the list, the item does not match (hide it).
2. Otherwise, if a fact in `only` is not set, the item is conditional: show it, and tell the learner the condition ("Only if you use macOS").
3. Otherwise the item matches.

With no facts set, every conditional item shows with its condition, like a printed handout.

## Text fields

- `md` fields (in blocks and in `check.fail`) hold CommonMark with tables. They hold no raw HTML. A link can be `https`, or `stage:<id>` or `stage:<id>#<anchor>`, which names another stage by its id. The reader resolves such a link to its own stage page, or shows the text without a link.
- `welcome.pages`, and the `text` of a loadout question, option, help and note, hold inline markdown: one paragraph with text, bold, italic, code and links. Links are `https` only. There is no list, heading, image or HTML.
- Titles, labels, `goal`, `tool`, `line` and `command` are plain text.
- `{name}` in a welcome page is the learner's name. It is the only placeholder in a welcome page.

## Welcome

`welcome.pages` is a list of one to ten strings. Show them in order, one page at a time, before the loadout. Replace `{name}` with the name of the learner.

## Loadout

`loadout.questions` is an ordered list. Each question asks for one fact:

| Field | Meaning |
|---|---|
| `fact` | The fact this question sets. Each fact is asked by at most one question. |
| `title` | The question, plain text. |
| `text` | Optional. Inline markdown shown with the question. |
| `when` | Optional. An object from fact to a list of values (the same shape as `only`). The question is asked only when this is true for the answers so far. |
| `options` | At least two. One per legal value of the fact. |
| `help` | Optional. `{ label, command, text }`. A hint such as "Not sure?" with a one-line `command` the learner can copy and a `text` that explains the result. |
| `notes` | Optional. A list of `{ when?, text }`. Show a note with the question when its `when` is true for the answers so far (or when it has no `when`). |

An option has `value` (a legal value of the fact), `label` (plain text), and optionally:

- `text`: inline markdown that explains the option.
- `recommended`: `true` on at most one option of a question. Highlight it.
- `forces`: an object that maps other facts to values. Choosing the option sets those facts too.
- `ends`: `true` means that no later question is asked after this answer.

### How to resolve the loadout

Keep the answers as an object from fact to value. Start with `{}`.

**Next question.** Go through `questions` in order. The next question is the first one that meets all of these:

1. Its fact has no answer yet. A fact set by `forces` counts as answered.
2. It has no `when`, or its `when` is true for the answers so far. Treat a `when` that names an unanswered fact as not true.
3. It does not come after a question whose chosen option has `ends: true`.

If no question meets all three, the loadout is finished.

**Apply an answer.** The new answers are the old answers, plus `fact: value`, plus every `forces` of the chosen option. Do not remove other answers.

**Changing an answer later.** Start again from the answers you keep and ask for the next question again.

A question's `when` only names facts that are asked earlier in the list. Facts that no answer set stay unset, and the reader keeps working with them unset.

Example, from the data: choosing Windows for `os` sets `virtualization` to `own` (it forces it) and ends the loadout, so the architecture and the runtime are never asked. The learner plays Master, because Zen does not run on Windows. Choosing Linux or macOS goes on to the virtualization question, then the architecture, then the runtime.

## Help prompts

A help prompt is text the learner copies into an AI assistant. The reader builds it from a template, the learner's facts and the step. There are two templates in `prompts`: `step` (help for one step) and `tip` (help for a whole stage).

The templates are plain text. They can have several lines. A placeholder is a name in braces. These names are allowed, and no others:

`stage`, `step`, `os`, `arch`, `runtime`, `virtualization`, `goal`, `tool`, `source`, `docs`, `commands`, `expect`, `request`.

Rendering rules:

- `{stage}`, `{step}`: the stage title and the step title.
- `{os}`: Linux, macOS or Windows. `{arch}`: amd64 or arm64. `{runtime}`: Docker or Podman. `{virtualization}`: `kairos-lab` when the fact is `kairos-lab`, and `[NAME OF YOUR VIRTUALIZATION SOFTWARE, e.g. VirtualBox]` when it is `own`.
- A fact that is unset renders as `[YOUR OPERATING SYSTEM]`, `[YOUR CPU ARCHITECTURE]`, `[YOUR CONTAINER RUNTIME]` and `[YOUR VIRTUALIZATION: kairos-lab OR YOUR OWN SOFTWARE]`.
- `{commands}`: the commands the step shows for those facts (every `command` block that matches, in the order shown, including the ones inside an alternatives item that matches), one per line, each starting with `$ `. A command with several lines gives one line per command line. A line that ends with a backslash continues on the next line, and the continuation lines are written as they are, with no `$ `. When there are none, write `(this step has no commands)`. With no facts set, every command of every alternative shows.
- `{expect}`: `help.expect` of the step. It is a ready sentence: the sentence of the step's named check (for example "The auroraboot command is available in a new terminal."), or `the step finishes without errors` when the step has no named check.
- `{goal}`, `{tool}`, `{source}`, `{docs}`: `help.goal`, `help.tool`, `help.source`, `help.docs` of the step.
- `{request}`: the stage's `tip.request` after the same substitution of `{os}`, `{arch}`, `{runtime}` and `{virtualization}`.
- A line of the template that holds a placeholder with no value is dropped. The exception is a line that holds `[paste your logs`: it is always kept, and a placeholder in it with no value becomes empty text.
- A value is inserted as it is. Do not look for placeholders inside a value.
- The result has no final newline.

A step has a help prompt only when it has `help`, and only when it matches the learner's facts (its `only` is not false). A stage has a tip prompt only when it has `tip`.

Worked example. Facts: macOS, arm64, Docker, `kairos-lab`. Step "Run kairos-lab setup" of the stage "Setting up kairos-lab". The step prompt is:

```
I'm following the Kairos workshop, stage "Setting up kairos-lab", step "Run kairos-lab setup".
My setup: macOS, arm64, container runtime Docker, VMs with kairos-lab.
Goal of this step: Run the first-time setup of kairos-lab and AuroraBoot.
Tool: kairos-lab (https://github.com/kairos-io/kairos-lab). Docs: https://github.com/kairos-io/kairos-lab#readme.
What I ran:
$ kairos-lab setup
What I expected: the step finishes without errors
What happened: [paste your logs or the error here]
Give me short numbered steps for my setup. If something is unclear, say what you need from me. Prefer the docs above over guesses.
```

The same stage's tip prompt for Linux, amd64, Docker and your own virtualization software:

```
I'm following the Kairos workshop, stage "Setting up kairos-lab".
My setup: Linux, amd64, container runtime Docker, VMs with [NAME OF YOUR VIRTUALIZATION SOFTWARE, e.g. VirtualBox].
Explain how to install Docker on Linux (amd64) and how to check that it works.
Give me short numbered steps for my setup. If something is unclear, say what you need from me.
```

## Stages

`stages` is a list, in route order. The position in the list is the number of the stage. Do not store a number.

| Field | Meaning |
|---|---|
| `id` | A slug such as `kairos-lab`. Unique. |
| `title` | The stage title, plain text, with no number. |
| `goal` | A short verb phrase that finishes "Today we learn how to ...". |
| `notSkippableWhen` | Optional. An `only` object. See below. |
| `tip` | Optional. `{ only?, request }`. See below. |
| `steps` | The steps, in order. At least one. |

A stage that is not in the game yet has one step, `on-github`, that links to the page on GitHub. It has no `help`, no `tip` and no `notSkippableWhen`.

### Skipping a stage: `notSkippableWhen`

When `notSkippableWhen` matches the learner's facts (the check in "Facts and the `only` rule" gives a match, not a conditional), do not let the learner skip the stage. When it does not match, or when it is conditional because a fact is unset, skipping is the reader's own choice. A stage without `notSkippableWhen` can always be skipped under the reader's own rules.

For stage 1 the value is `{ "virtualization": ["kairos-lab"] }`: a learner who chose Zen cannot skip the stage that installs the tools Zen needs.

### The TIP: `tip`

`tip.request` is plain text that says what to ask for in this stage. It can hold `{os}`, `{arch}`, `{runtime}` and `{virtualization}`. Use it as `{request}` in the `tip` template.

`tip.only` says when to offer the TIP. When `tip.only` is missing, the default is `{ "virtualization": ["own"] }`: offer the TIP to a learner who runs their own virtualization software (Master) and to a learner whose `virtualization` is not set. Use the normal `only` check: offer it when the result is a match or conditional.

## Steps

| Field | Meaning |
|---|---|
| `id` | Unique in the stage. |
| `title` | Plain text. |
| `line` | What KAI says in the dialogue box. Plain text, at most 60 characters. |
| `optional` | Optional. `true` for a side quest. |
| `only` | Optional. Show the step only when this matches. |
| `help` | Optional. `{ goal, tool?, source?, docs?, expect }`. The input for the step help prompt. `goal` is plain text of at most 100 characters. `source` and `docs` are `https` URLs. `expect` is the sentence for the `{expect}` slot of the prompt. The stage defaults for `tool`, `source` and `docs` are already merged in. |
| `blocks` | What the step shows, in reading order. At least one. |
| `check` | `{ prompt, fail }`. |

A step with no `help` has no help prompt.

### Blocks

Each block has a `type` and may have an `only`. When `only` does not match, hide the block.

| `type` | Fields | Meaning |
|---|---|---|
| `text` | `md` | Markdown text. |
| `command` | `code` | A command (it can span lines) that the learner copies. The reader never runs it. |
| `file` | `name`, `code` | A file the learner creates. |
| `output` | `text` | Output the learner should see. |
| `callout` | `kind`, `md` | A highlighted message. `kind` is `note`, `warning` or `caution`. |
| `alternatives` | `id`, `title`, `items` | Several ways to do the same thing. Each item is `{ label, only?, blocks }`. Show the items that match. When none matches, tell the learner that none of the options fit their setup. |

### Check

`check` is `{ kind, prompt, fail }`.

- `kind` says what the check is. It is one of `command-available`, `image-exists`, `iso-exists`, `vm-running`, or `manual`. `manual` means the step names no check and `prompt` is a default sentence ("You finished this step.", "You read this." or "You finished this stage."). A reader can treat every kind as a manual confirmation. `content.json` carries the sentence only, not the values a check would need to run.
- `prompt` is the sentence the learner confirms ("The auroraboot command is available in a new terminal.", or a default such as "You finished this step.").
- `fail` is a list of blocks to show when the learner says it did not work. It can be empty.
