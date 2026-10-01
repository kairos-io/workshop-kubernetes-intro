# Workshop format v0

This file is the normative description of the workshop content format. The JSON Schema files in this directory describe the shape of the data. This file describes what the data means and what every reader must do with it.

Format string: `kairos-workshop/v0`. It appears in `workshop.yaml` and in every stage file. A reader rejects a file with any other format string.

**v0 is unstable.** It may change without notice until a v1 is declared. From v1 on, any new field, fact value or check kind bumps the format version.

Files:

- `workshop.schema.json` describes `workshop.yaml`: the index of stages, the welcome pages, the loadout and the help prompt templates.
- `stage.schema.json` describes one converted stage file in `stages/`.
- `../../conformance/v0/` holds the fixtures every reader must pass.

## Structure

A workshop is a list of stages. A stage is a list of sections. A section holds text, warnings and steps. A step holds text, warnings and either variants or commands. A variant holds text, warnings and commands.

A stage in `workshop.yaml` is either a converted stage (`file: stages/<id>.yaml`) or a markdown stage (`id`, `title`, `markdown`, and an optional `goal`). Readers show a markdown stage as a link and do not parse it.

`workshop.yaml` also holds three optional blocks that a game uses and a site can ignore: `welcome` (pages shown first), `loadout` (the questions that fill in the facts) and `prompts` (two templates for help prompts). Stage files can carry help for the learner: `help` and `tip` on a stage, `help` on a step, and `not_skippable_when` on a stage. These are described in their own sections below.

Ids are lower case words joined by hyphens. Stage ids are unique in a workshop. Step ids are unique in a stage. Variant ids are unique in a step. The `id` in a stage file equals its file name without `.yaml`. A step has `variants` or `commands` and `expect`, never both. A step with `variants` has at least two.

## Stages

A converted stage file has a `title`, a `goal` and `sections`.

- `title` is plain text and does not hold a number. Write "Setting up kairos-lab", not "Stage 1: Setting up kairos-lab".
- `goal` is a short verb phrase that finishes the sentence "Today we learn how to ...", for example `set up kairos-lab`. It is plain text: no markdown, no `<`, `>` or newline, and at most 60 characters. A converted stage requires it. A markdown stage entry in `workshop.yaml` can carry one with the same rules.
- The `id` is a slug (`kairos-lab`, `first-node`) and never holds a number.

The number of a stage is its 1-based position in `workshop.yaml`. A reader computes it and never stores it. Inserting a stage renumbers the ones after it and breaks no link. The markdown publisher writes a converted stage to `stage-<n>.md` and prints `# Stage <n>: <title>`.

### Links between stages

In any markdown field (`text`, `after`, warning `text`, `onFail`, and the workshop `intro`), a link whose target is `stage:<id>` or `stage:<id>#<anchor>` names another stage by id. Only the inline form `[text](stage:id)` is allowed.

- A validator rejects an id that is not in `workshop.yaml`. For a converted stage it also checks that the anchor is one of that stage's section anchors. For a markdown stage it cannot check the anchor.
- A publisher resolves the link. The markdown publisher writes `stage-<n>.md[#anchor]` for a converted stage, and the stage's `markdown` file name for a markdown stage. A reader that has no page for the stage can leave the link as it is.

## Facts

A fact is something the reader knows about their own setup. The set of facts, their ids and their values are fixed in v0.

| Fact | Values |
|---|---|
| `os` | `linux`, `macos`, `windows` |
| `virtualization` | `kairos-lab`, `own` |
| `arch` | `amd64`, `arm64` |
| `runtime` | `docker`, `podman` |

`tools/lib/facts.mjs` is the source for the ids and the values. The loadout (see below) holds the question and the labels a game shows to the reader, for example the `virtualization` values are shown as "Zen" and "Master".

Wording used inside a sentence, for example in the condition labels of the markdown publisher ("Only if you use: macOS"): `kairos-lab` is "kairos-lab", `own` is "your own virtualization software", `linux` is "Linux", `macos` is "macOS", `windows` is "Windows", `amd64` is "amd64", `arm64` is "arm64", `docker` is "Docker", `podman` is "Podman".

A fact can be unset. A reader must work with any subset of facts set.

## `when`

`when` is an object with at least one key. Each key is a fact. Each value is one allowed value or a list of allowed values. A list means any of them. Several keys mean all of them (AND). There is no other operator: no not, no OR across facts.

`when` can appear on a section, a step, a variant and a warning. It also appears on a loadout question, a loadout note, a stage `tip` and a stage `not_skippable_when`.

### Evaluation

Evaluation has three results. Given `when` and a set of known facts:

1. If any fact in `when` is set and its value is not allowed, the result is `false`.
2. Otherwise, if any fact in `when` is not set, the result is `unknown`.
3. Otherwise the result is `true`.

Rule 1 comes first. One fact set to a wrong value gives `false` even if another fact is unset. An empty string counts as unset. An item without `when` is always `true`.

`conformance/v0/when.json` lists rows of `when`, facts and expected result. Every reader must match every row.

### Display rule

The display rule is the same for every reader.

- `true`: show the item.
- `unknown`: show the item and tell the reader the condition, for example "Only if you use: macOS".
- `false`: hide the item.

With no facts set, every conditional item shows with its condition. The output reads like a printed handout. The markdown publisher is a reader with no facts set. A hidden section hides everything inside it.

When every variant of a visible step is hidden, a reader tells the reader that none of the options match their setup.

## Render order

Every reader renders a block in this order. Warnings come before commands.

1. Title and condition label.
2. `text`.
3. `warnings`.
4. Variants. Each variant renders in this same order: title, condition label, `text`, `warnings`, `commands`, `expect`, `after`.
5. `commands`.
6. `expect`.
7. `after`.
8. The check, as a sentence.
9. `onFail`.

A condition label goes below a heading. It never goes inside the heading text, so a heading keeps the same anchor for every reader.

A section anchor is the GitHub slug of its title. Two sections of one stage cannot have the same anchor. A stage page and the generated markdown file give the same anchor for the same section.

## Commands

`commands` is a list of strings. A string can hold several lines. Commands are shell. They are text for the reader to copy. The format has no field that means "execute", and a reader must never run a command from a file on its own.

`expect` is a string that holds the output a reader should see. It is text and nothing else.

## Checks

A step can have one `check`. A check states something a reader can verify. The wording is owned by the reader, for example "The `kairos-lab` command is available in a new terminal."

Kinds in v0:

| Kind | Parameters | Meaning |
|---|---|---|
| `command-available` | `command` | The command is found on the `PATH`. |
| `image-exists` | `image` | The container image is present in the runtime named by the `runtime` fact. |
| `iso-exists` | none | The ISO file that the workshop builds exists. |
| `vm-running` | `name` (optional) | A VM is running. |

Parameters are restricted by pattern in the schema, so they cannot hold shell metacharacters.

Reader duties:

- A reader that runs a check passes each parameter as one argument to a program. It never builds a shell line from a parameter.
- A reader that does not know a kind treats the step as a manual check.
- A reader that does not run checks shows the wording and lets the reader confirm by hand.
- A failed check or "it did not work" shows `onFail`. `onFail` is valid without a `check`.

## Markdown in fields

Text fields (`text`, `after`, `onFail`, warning `text`) hold CommonMark with GFM tables.

- Raw HTML is not allowed.
- GitHub alert syntax (`> [!NOTE]`) is not allowed. Use `warnings`.
- Titles are plain text. They have no `<`, `>` or newline.
- The welcome pages and the loadout texts hold inline markdown only (see Welcome pages and Loadout).
- A relative link to a `.md` file must name a file that exists. A link with `#anchor` into a converted stage must match a section anchor of that stage. A link to another stage by id, `stage:<id>`, follows the same anchor rule (see Links between stages).

A warning has a `kind`: `note`, `tip`, `important`, `warning` or `caution`. They map to the five GitHub alert kinds.

## Welcome pages

`welcome` in `workshop.yaml` is `{ pages: [...] }`. `pages` has 1 to 10 strings. A game shows them in order before anything else.

- A page is inline markdown: one paragraph with text, bold, italic, code and links. It has no list, no heading, no image and no raw HTML.
- A link is `https` only.
- The only placeholder is `{name}`. A reader replaces it with the name of the learner.
- An unknown placeholder is an error.

## Loadout

`loadout` in `workshop.yaml` is `{ questions: [...] }`, an ordered list of questions. Each question asks for one fact. The answers become the facts the reader works with. The labels and the texts a learner sees live here. The ids and values stay fixed in the format (see Facts).

A question has:

| Field | Meaning |
|---|---|
| `fact` | One of the four facts. A fact is asked by at most one question. |
| `title` | The question, plain text. |
| `text` | Optional. Inline markdown shown with the question. |
| `when` | Optional. The question is asked only when this is `true` for the answers so far. |
| `options` | At least two. Every legal value of the fact appears exactly once. |
| `help` | Optional. `{ label, command, text }`. `command` is plain text on one line that the learner can copy, for example `uname -m`. |
| `notes` | Optional. A list of `{ when?, text }`. A reader shows a note when its `when` is `true` or missing, using the answers it has. |

An option has a `value` (a legal value of the fact), a plain text `label`, and optionally `text` (inline markdown), `recommended` (a reader highlights it; at most one per question), `forces` and `ends`.

- `forces` is an object that maps other facts to values. Choosing the option sets those facts too. A question whose fact is already set by `forces` is not asked.
- `ends: true` means that no later question is asked after this answer.

Titles and labels are plain text: no `<`, `>`, newline or backtick. `text` fields are inline markdown as in Welcome pages, without a placeholder, and without GitHub alert syntax.

A `when` on a question names facts that are asked earlier in the list. A validator rejects a name that is asked later or not at all. A `when` on a note names facts asked earlier or the fact of its own question. Because every value of every fact has an option, a `when` in a stage can never name a value the loadout cannot produce.

### Resolution

`tools/lib/loadout.mjs` is the reference implementation of two functions. `conformance/v0/loadout/` holds the expected results. Every reader must match every case.

- `nextQuestion(loadout, answers)` returns the first question, in the order of the list, such that: its fact has no answer; its `when` evaluates to `true` under the answers so far (`unknown` and `false` both mean "not asked"); and it does not come after a question whose chosen option has `ends: true`. It returns nothing when no question is left.
- `applyAnswer(loadout, answers, fact, value)` returns the answers plus `fact: value` plus the `forces` of the chosen option. It does not change the input and it does not remove other answers.

A reader asks `nextQuestion`, shows the question, calls `applyAnswer` with the choice, and repeats until there is no question. The facts that no question set stay unset. A reader works with unset facts as described in Facts. When the learner changes an answer, a reader starts from the answers it keeps and asks `nextQuestion` again.

## Help for the learner

These fields are for a game. A site can ignore them.

### Step and stage `help`

A step can have `help`: `{ goal, tool?, source?, docs? }`.

- `goal` is plain text of at most 100 characters (no markdown, no `<`, `>` or newline). It is what the learner does in this step. It is required when `help` is present.
- `tool` is plain text, the name of the program the step is about.
- `source` and `docs` are `https` URLs.

A stage can have `help`: `{ tool?, source?, docs? }`. These are defaults for every step help of the stage. A key in the step help wins. A step with no `help` has no help prompt, even when its stage has one.

### Stage `tip`

A stage can have `tip`: `{ when?, request }`. It is the "ask for a TIP" request for the whole stage. `request` is plain text. It can hold the placeholders `{os}`, `{arch}`, `{runtime}` and `{virtualization}`, and no other. `when` says when a reader offers the tip. It defaults to `{ virtualization: own }`: the tip is offered for a reader who runs their own virtualization software and for a reader whose `virtualization` is unset.

### Skipping a stage: `not_skippable_when`

A stage can have `not_skippable_when`, a `when` object. When it evaluates to `true` for the facts of the learner, a reader must not let the learner skip the stage. When it evaluates to `false` or `unknown`, skipping is the reader's own choice.

## Help prompts

`prompts` in `workshop.yaml` has two templates, `step` and `tip`. They are plain text and can have several lines. A learner copies the result into an AI assistant. `tools/lib/prompt.mjs` is the reference implementation (`fillPrompt`, `buildStepPrompt`, `buildTipPrompt`), and `conformance/v0/prompt/` holds the expected texts.

Allowed placeholders: `stage`, `step`, `os`, `arch`, `runtime`, `virtualization`, `goal`, `tool`, `source`, `docs`, `commands`, `expect`, `request`. A placeholder is a name in braces, with no spaces. A validator rejects any other name.

Rendering rules:

- `{stage}`, `{step}`: the stage title and the step title. A step with no title takes the title of its section.
- `{os}`: Linux, macOS or Windows. `{arch}`: amd64 or arm64. `{runtime}`: Docker or Podman. `{virtualization}`: `kairos-lab` when the fact is `kairos-lab`, and `[NAME OF YOUR VIRTUALIZATION SOFTWARE, e.g. VirtualBox]` when it is `own`.
- A fact that is unset renders as `[YOUR OPERATING SYSTEM]`, `[YOUR CPU ARCHITECTURE]`, `[YOUR CONTAINER RUNTIME]` and `[YOUR VIRTUALIZATION: kairos-lab OR YOUR OWN SOFTWARE]`.
- `{commands}`: the commands that are visible for those facts (the `command` records of the visible outline of this step), in order, one per line, each prefixed with `$ `. A command with several lines gives one line per command line. A line that ends with a backslash continues on the next line, and the continuation lines are written as they are, with no prefix. When the step has no visible command, `(this step has no commands)`.
- `{expect}`: the sentence of the step check (the capitalized sentence without markdown, as in the check wording above) when the step has a check, else `the step finishes without errors`. A generated game content carries this sentence as `help.expect`, so a reader does not rebuild it.
- `{goal}`, `{tool}`, `{source}`, `{docs}`: from the step `help` merged over the stage `help`.
- `{request}`: the `request` of the stage `tip` after the same substitution of `{os}`, `{arch}`, `{runtime}` and `{virtualization}`.
- A line of the template that holds a placeholder with no value is dropped, except a line that holds `[paste your logs`. In that line a placeholder with no value becomes empty text.
- A value is inserted as it is. A reader never looks for placeholders inside a value.
- The result has no final newline.

A step prompt exists only for a step that has `help` and is not hidden for the facts (its `when` and the `when` of its section are not `false`). A tip prompt exists only for a stage that has a `tip`. The `when` of the tip is a rule for offering it and does not change the text.

## Versioning

The format string names the version. A reader accepts only formats it knows. Changes in v0 before its release are listed in the changelog. From v1, every change is recorded here.

## Changelog

Unreleased v0:

- A stage file requires `goal`. A markdown stage entry in `workshop.yaml` can carry one.
- Stage ids are slugs without numbers, and titles do not hold "Stage N:". The number is the position in `workshop.yaml`. The generated file is `stage-<n>.md`. Stage 1 moved from `stage-1` to `kairos-lab`.
- Links between stages use `stage:<id>[#anchor]`, resolved by each publisher.
- `workshop.yaml` can carry `welcome` (pages), `loadout` (questions, options, forces, ends, notes) and `prompts` (a `step` and a `tip` template). The labels and the questions that a game shows moved from `tools/lib/facts.mjs` to the loadout. The fact ids and values stay fixed.
- A step can carry `help` (`goal`, `tool`, `source`, `docs`). A stage can carry `help` (defaults for its steps), `tip` (`when`, `request`) and `not_skippable_when`.
- `tools/lib/loadout.mjs` (`nextQuestion`, `applyAnswer`) and `tools/lib/prompt.mjs` (`fillPrompt`, `buildStepPrompt`, `buildTipPrompt`) are reference implementations, with fixtures in `conformance/v0/loadout/` and `conformance/v0/prompt/`.
- The `virtualization` value `other` is now `own`.

## The visible outline

The visible outline is a flat, ordered list of records that says what a reader shows for a stage and a set of facts. It lets different readers check that they show the same things. `tools/lib/view.mjs` is the reference implementation. The files in `conformance/v0/view/` hold the expected outlines.

Each case file is `{ "stage": <path relative to the repository root>, "facts": {...}, "expect": [...] }`.

The outline follows the render order above and leaves out prose fields (`text`, `after`, `onFail`, titles of steps and variants). An item that is hidden is absent, and so is everything inside it. Records:

| Record | Fields |
|---|---|
| section | `kind: "section"`, `title`, `state` |
| step | `kind: "step"`, `id`, `state` |
| variant | `kind: "variant"`, `id`, `state` |
| warning | `kind: "warning"`, `warningKind`, `state` |
| command | `kind: "command"`, `text` (one entry of `commands`, unchanged) |
| expect | `kind: "expect"` |
| check | `kind: "check"`, `checkKind` |
| no-match | `kind: "no-match"`, `step` (a visible step with variants where every variant is hidden) |

`state` is `shown` when the item's `when` evaluates to `true` or the item has no `when`, and `conditional` when it evaluates to `unknown`. The state of an item does not depend on the state of the items around it.

Order inside a section: its warnings, then its steps. Order inside a step: its warnings, then its variants (each with its warnings, commands and expect), then `no-match` if no variant is visible, then its commands and expect, then its check.

A reader must produce the same outline as the case file for every case in `conformance/v0/view/`. The stages the cases refer to are `stages/kairos-lab.yaml` and the synthetic stages in `conformance/v0/fixtures/`.
