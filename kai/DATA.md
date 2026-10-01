# KAI data: what the compiler writes and who owns it

The game reader loads three JSON files from `kai/web/`. Two of them are generated from our YAML. One part of the theme is the designer's.

| File | Owner | What it holds |
|---|---|---|
| `kai/web/content.json` | generated | The facts and the stages with their steps. Workshop data. |
| `kai/web/theme.json` | generated | `kai/theme.base.json` with four keys replaced by data of ours. |
| `kai/theme.base.json` | the designer | The theme as the designer delivered it, in `web/theme.base.json` of the export. We never edit it. |
| `kai/lines.yaml` | us | The short lines of the dialogue box (step lines, welcome lines, notice titles and lines). |
| `workshop.yaml`, `stages/*.yaml` | us | The source of every text the learner reads. |
| everything else in `kai/` (`web/*.html`, `web/*.js`, `web/kai-sprites.json`, `tui/`, `assets/`, `STATES.md`, the designer's part of `README.md`) | the designer | The reader. We copy it from the export and never edit it. |

The designer's export holds its own `web/theme.json` and `web/content.json`. We do not keep them, because ours are generated. In round 5 the designer's `theme.json` is the same data as ours (the same values and the same key order), written with another indent and without the final newline. Its `content.json` is ours without `tipOnly`: the designer's data has no `tipOnly`, and the round 5 reader then offers no TIP at all, so ours keeps it (see "The TIP: `tip`").

`npm run compile:kai -- --out kai/web` writes `content.json` and `theme.json`. Do not edit either by hand. `npm run compile:kai -- --check --out kai/web` fails when one of them is stale, and CI runs it. The output is stable: the same key order, a two-space indent, a newline at the end, no timestamps.

The reader must ignore a field it does not know. New fields can appear in later versions.

The reader loads three files from `kai/web/`: `kai-sprites.json` (the designer's), `theme.json` and `content.json`. It reads stage count, stage list and step ids from the data and does not hard-code them (see "What the reader reads").

There is one source of truth for every text that is workshop content: our YAML. The reader reads it from the two generated files. The designer's base file holds real theme only: mentors, locations, items, poses, labels, messages, the footer and the labels of the buttons.

## theme.json

`theme.json` is the base with four top-level keys generated. The base still holds a copy of our earlier output under these four keys (the designer built it from our files), and the compiler ignores that copy. Our data wins: whatever the base holds for these keys is discarded. Every other key is copied from the base without a change (`game`, `links`, `xp`, `player`, `mentors`, `mentorPick`, `items`, `mega`, `poses`, `messages`, `labels`, `footer`, and since round 4 `checkKinds`, `modes` and `sheet`, and since round 5 `factPrompt`, `messages.boss_hint` and the labels `take_home`, `tip_banner` and `free_text_hint`), and the keys keep the order of the base. The `boss_hint`, `take_home`, `tip_banner` and `free_text_hint` texts are design copy that the reader shows, so the compiler only copies them through. `factPrompt` is design data: `{ <fact>: { <value>: <text> } }`, where the text replaces the value in a prompt and `"@freeText"` means "what the learner typed". It names the fact `virtualization` and its values `kairos-lab` and `own`, which the base cannot know are still right, so `tests/kai-theme.test.mjs` checks that every fact and value it names exists in `content.json`.

| Key | Generated from |
|---|---|
| `welcome` | `workshop.yaml` `welcome.pages` and `kai/lines.yaml` `welcome` |
| `loadout` | `workshop.yaml` `loadout`, `kai/lines.yaml` `notices` |
| `prompts` | `workshop.yaml` `prompts` |
| `stages` | The stage list of `workshop.yaml` |

### welcome

`{ mentor, pages, next, back, start }`.

- `mentor`, `next`, `back`, `start` are copied from the base: the id of the mentor who greets the learner and the button labels.
- `pages` is a list with one `{ line, md }` for each page of `welcome.pages`, in order. `md` is our page text: inline markdown, one paragraph, with `{name}` for the name of the learner. `line` is the short line for the dialogue box, from `kai/lines.yaml` `welcome` (at most 40 characters, one line, same order).

### loadout

`{ title, progress, next, back, done, questions, notices }`.

- `title`, `progress`, `next`, `back`, `done` are copied from the base.
- `questions` is a map from fact id to a question, in the order of the loadout: `{ title, md?, options, help?, when? }`.
  - `title` is the title of our question. `md` is its `text`, when it has one.
  - `options` is a map from option value to `{ badge?, md? }`. Every option of the question is in the map, with `{}` when it has nothing to add. `badge` is `"recommended"` for the option that has `recommended: true`. `md` is the `text` of the option. An option that has `ends: true` has no `md` here, its text is in `notices`.
  - `help` is `{ label, md, code, after }`: `label` is our label ("Not sure?"), `md` is the sentence that introduces the command and comes from the base (`loadout.questions.arch.help.md`), `code` is our `command`, `after` is our `text`.
  - `when` is a list of `{ only?, md }`, built from our `notes`. `only` is the `when` of the note (every value a list) and is absent for a note that always shows. `md` is the text of the note. Show a note when its `only` is true for the answers so far.
- `notices` is a map from option value to `{ title, line, md }` for each option that has `ends: true`. `title` and `line` come from `kai/lines.yaml` `notices`. `md` is the text of the option. The learner sees a notice after the answer that has it. `content.json` names it with `notice` on the option.

### prompts

`{ virtPlaceholder, logsPlaceholder, unsetPlaceholder, noCommands, warning, fail, tip }`.

- `virtPlaceholder`, `logsPlaceholder`, `unsetPlaceholder`, `noCommands`, `warning` are copied from the base.
- `fail` is our `prompts.step` template and `tip` is our `prompts.tip` template, each as a list of lines. The placeholders have the reader's names: `{expect}` is written `{expected}` and `{request}` is written `{ask}`. The text `[paste your logs or the error here]` is written `{logs}`. See "Help prompts".

### stages

The stages of the base that exist in `workshop.yaml`, in the order of `workshop.yaml`. Each keeps its `location`, `nodes` and `items`. A stage that the base lists and the workshop does not have (today `fleet` and `edgevpn`) is left out, and so are the items it grants. A stage of the workshop that the base does not list has no entry, and the reader falls back to its own default for it.

## content.json

| Field | Type | Meaning |
|---|---|---|
| `facts` | list | One entry for each fact that the loadout asks, in the order of the loadout. |
| `stages` | list | The stages, in the order of the route. |

The keys come in this order: `facts`, `stages`. The welcome pages, the loadout and the prompt templates are not in `content.json`. They are in `theme.json`.

### Facts and the `only` rule

A fact is something the learner tells the game about their setup. There are four, with fixed ids and values:

| Fact | Values |
|---|---|
| `os` | `linux`, `macos`, `windows` |
| `virtualization` | `kairos-lab`, `own` |
| `arch` | `amd64`, `arm64` |
| `runtime` | `docker`, `podman` |

A fact can be unset. Every part of the reader must work with any subset of the facts set.

`facts` is a list of `{ id, label, question, options, askIf? }`, in the order of the questions of the loadout (`os`, `virtualization`, `arch`, `runtime`). `label` is the name of the fact (OS, Virtualization, Architecture, Container runtime). `question` is the question title of the loadout. `options` is a list of `{ id, label, forces?, notice? }`. Each option `label` is what the learner reads (the `virtualization` values read "Zen" for `kairos-lab` and "Master" for `own`). A fact that the loadout does not ask is not in the list.

- `askIf` is the `when` of the question, as an object from fact to a list of values. The question is asked only when every fact in `askIf` is set and has one of the values. A fact with no `askIf` is always asked.
- `forces` is an object from fact to value. Choosing the option sets those facts too.
- `notice` is the value of an option that ends the loadout. It names an entry of `loadout.notices` in `theme.json`. After this answer the reader shows the notice. It asks no more questions because every later question has an `askIf` that this answer does not satisfy. The compiler refuses a loadout where that is not so, because the reader does not know `ends`.

`only` is an object that maps a fact to a non-empty list of values. It appears on steps, blocks, alternative items and `tipOnly`. It means: show this item only for these values. Several facts in one `only` must all match. An item with no `only` always shows.

To check an `only` against the learner's facts:

1. If a fact in `only` is set and its value is not in the list, the item does not match (hide it).
2. Otherwise, if a fact in `only` is not set, the item is conditional: show it, and tell the learner the condition ("Only if you use macOS").
3. Otherwise the item matches.

With no facts set, every conditional item shows with its condition, like a printed handout.

### Text fields

- `md` fields (in blocks and in `check.fail`) hold CommonMark with tables. They hold no raw HTML. A link can be `https`, or `stage:<id>` or `stage:<id>#<anchor>`, which names another stage by its id. The reader resolves such a link to its own stage page, or shows the text without a link.
- `welcome.pages`, and the `md` of a loadout question, option, help, note and notice, hold inline markdown: one paragraph with text, bold, italic, code and links. Links are `https` only. There is no list, heading, image or HTML.
- Titles, labels, `goal`, `tool`, `line` and `code` of a help are plain text.
- `{name}` in a welcome page and in a welcome line is the learner's name. It is the only placeholder there.

### How to resolve the loadout

The facts, `askIf`, `forces` and `notice` are enough to run the loadout. Keep the answers as an object from fact to value. Start with `{}`.

**Questions.** Go through `facts` in order. A fact is asked when `askIf` is missing or true under the answers so far. A `askIf` that names an unanswered fact is not true.

**Apply an answer.** The new answers are the old answers, plus `fact: value`, plus every `forces` of the chosen option. Do not remove other answers.

**Notice.** When the chosen option has `notice`, show `loadout.notices[notice]` after the answer.

**Changing an answer later.** Start again from the answers you keep and ask the questions again.

`tools/lib/loadout.mjs` is the reference implementation of this flow.

Example, from the data: choosing Windows for `os` sets `virtualization` to `own` (it forces it) and shows the notice "Windows: you play Master". The architecture and the runtime are never asked, because their `askIf` needs Linux or macOS. The learner plays Master, because Zen does not run on Windows. Choosing Linux or macOS goes on to the virtualization question, then the architecture, then the runtime.

### Help prompts

A help prompt is text the learner copies into an AI assistant. The reader builds it from a template (`theme.prompts.fail` for one step, `theme.prompts.tip` for a stage), the learner's facts and the data of the stage and the step.

The templates are lists of lines. A placeholder is a name in braces. The reader knows these names:

`{stage}`, `{step}`, `{os}`, `{arch}`, `{runtime}`, `{virtualization}`, `{goal}`, `{tool}`, `{source}`, `{docs}`, `{commands}`, `{expected}`, `{logs}`, `{ask}`.

Our reference implementation is `tools/lib/prompt.mjs`, with the fixtures in `conformance/v0/prompt/`. It spells two names in another way: `{expect}` for `{expected}` and `{request}` for `{ask}`. In our YAML the templates use `{expect}` and `{request}`, and the compiler renames them. The rest of this section describes our reference rules. The reader's own rules are in `kai/web/kai-engine.js`, and `tests/kai-engine.test.mjs` pins where the two differ (see "Where the reader and our reference differ").

- `{stage}`, `{step}`: the stage title and the step title.
- `{os}`: Linux, macOS or Windows. `{arch}`: amd64 or arm64. `{runtime}`: Docker or Podman. `{virtualization}`: `kairos-lab` when the fact is `kairos-lab`, and `[NAME OF YOUR VIRTUALIZATION SOFTWARE, e.g. VirtualBox]` when it is `own`.
- A fact that is unset renders as `[YOUR OPERATING SYSTEM]`, `[YOUR CPU ARCHITECTURE]`, `[YOUR CONTAINER RUNTIME]` and `[YOUR VIRTUALIZATION: kairos-lab OR YOUR OWN SOFTWARE]`.
- `{commands}`: the commands the step shows for those facts (every `command` block that matches, in the order shown, including the ones inside an alternatives item that matches), one per line, each starting with `$ `. A command with several lines gives one line per command line. A line that ends with a backslash continues on the next line, and the continuation lines are written as they are, with no `$ `. When there are none, write `(this step has no commands)`. With no facts set, every command of every alternative shows.
- `{expect}`: `help.expect` of the step. It is a ready sentence: the sentence of the step's named check (for example "The auroraboot command is available in a new terminal."), or `the step finishes without errors` when the step has no named check.
- `{goal}`, `{tool}`, `{source}`, `{docs}`: the `goal` of the step, and the `tool`, `source` and `docs` of its `help` (the stage defaults are already merged in).
- `{request}`: the stage's `tip` after the same substitution of `{os}`, `{arch}`, `{runtime}` and `{virtualization}`.
- A line of the template that holds a placeholder with no value is dropped. The exception is a line that holds `[paste your logs`: it is always kept, and a placeholder in it with no value becomes empty text.
- A value is inserted as it is. Do not look for placeholders inside a value.
- The result has no final newline.

A step has a help prompt only when it has `help`, and only when it matches the learner's facts (its `only` is not false). A stage has a tip prompt only when it has `tip`.

Worked example. Facts: macOS, arm64, Docker, `kairos-lab`. Step "Run kairos-lab setup" of the stage "Setting up kairos-lab". The step prompt of our reference implementation is:

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

### Stages

`stages` is a list, in route order. The position in the list is the number of the stage. Do not store a number.

| Field | Meaning |
|---|---|
| `id` | A slug such as `kairos-lab`. Unique. |
| `title` | The stage title, plain text, with no number. |
| `goal` | A short verb phrase that finishes "Today we learn how to ...". |
| `steps` | The steps, in order. At least one. |
| `tool` | Optional. `{ name, url? }`: the program the stage is about, from the `help` of the stage (`tool` and `source`). |
| `docs` | Optional. An `https` URL, from the `help` of the stage. |
| `tip` | Optional. Plain text: what to ask for in this stage. See below. |
| `tipOnly` | Optional. An `only` object. See below. |
| `noSkip` | Optional. `{ when, reason }`. See below. |

The keys come in this order: `id`, `title`, `goal`, `steps`, `tool`, `docs`, `tip`, `tipOnly`, `noSkip`.

A stage that is not in the game yet has one step, `on-github`, that links to the page on GitHub. It has no `tool`, `docs`, `tip` or `noSkip`.

#### Skipping a stage: `noSkip`

`noSkip.when` is an `only` object and `noSkip.reason` is the sentence to show. When `noSkip.when` matches the learner's facts (the check in "Facts and the `only` rule" gives a match, not a conditional), do not let the learner skip the stage, and show the reason. When it does not match, or when it is conditional because a fact is unset, skipping is the reader's own choice. A stage without `noSkip` can always be skipped under the reader's own rules.

For stage 1 the value is `{ "when": { "virtualization": ["kairos-lab"] }, "reason": "You play Zen, so every later stage uses kairos-lab. Set it up first." }`: a learner who chose Zen cannot skip the stage that installs the tools Zen needs.

#### The TIP: `tip`

`tip` is plain text that says what to ask for in this stage. It can hold `{os}`, `{arch}`, `{runtime}` and `{virtualization}`. The reader uses it as `{ask}` in the `tip` template, after it fills those four.

`tipOnly` says when to offer the TIP. It is an `only` object, and every stage that has a `tip` has one: the `when` of the stage tip, or `{ "virtualization": ["own"] }` when the stage sets none (Master). The round 5 reader offers the TIP only for a stage that has `tipOnly`, so a stage with a `tip` and no `tipOnly` would never show it.

Our rule (SPEC, "Stage tip") offers the TIP when the check gives a match or conditional, so a learner whose `virtualization` is not set also gets it. The reader does the same (`E.tipFor`, and `tipFor` in `tui/main.go`): a fact of `tipOnly` that is unset or "unsure" counts as a match, and a fact that is set to another value does not. `tests/kai-engine.test.mjs` checks this against our rule for every combination of facts.

### Steps

| Field | Meaning |
|---|---|
| `id` | Unique in the stage. |
| `title` | Plain text. |
| `line` | What KAI says in the dialogue box. Plain text, at most 60 characters. |
| `optional` | Optional. `true` for a side quest. |
| `only` | Optional. Show the step only when this matches. |
| `blocks` | What the step shows, in reading order. At least one. |
| `check` | `{ kind, prompt, fail }`. |
| `goal` | Optional. What the learner does in this step, plain text, at most 100 characters. It is there when the step has a `help`. |
| `help` | Optional. `{ tool?, source?, docs?, expect }`. The rest of the input for the step help prompt. The stage defaults for `tool`, `source` and `docs` are already merged in. `source` and `docs` are `https` URLs. `expect` is the sentence for the `{expect}` slot of the prompt. |

A step with no `help` has no help prompt and no `goal`. Then the reader uses the title of the step as its goal.

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

## What the reader reads

The reader (`kai/web/`, `kai/tui/main.go`, round 5 of the designer's export, then ours) reads every field of `content.json` and `theme.json` that we write, except the ones in "Not used yet". `tests/kai-engine.test.mjs`, `tests/kai-tui.test.mjs` and `tests/kai-theme.test.mjs` pin each use below.

| Field of ours | What the reader does with it |
|---|---|
| `facts[].askIf`, `forces`, `notice` | Runs the loadout (`E.loadoutQuestions`, `E.withFact`). The same questions, in the same order, as `tools/lib/loadout.mjs`. |
| `facts[].label`, `options[].label` | The names in the loadout rows and in the `[YOUR {fact}]` stand-in of the prompts (the label in upper case). |
| `theme.loadout.questions`, `notices` | The texts of the loadout and of the notice after an ending answer. |
| `theme.welcome.pages` | The welcome pages and their short lines. |
| `stage.id`, `title`, `goal`, `steps` | The route, the stage page and the mentor screen. The number of stages is the length of the list. |
| `stage.tool`, `docs`, `tip` | The stage tip prompt: `{tool}`, `{source}`, `{docs}` and `{ask}`. |
| `stage.tipOnly` | Who is offered the TIP (`E.tipFor`, the `t` key in the terminal, the banner in the web). A fact that is unset or "unsure" counts as a match. A stage without `tipOnly` has no TIP. |
| `theme.factPrompt` | The text that stands for a fact value in a prompt, and which value needs a free text (the name of the learner's own virtualization software). |
| `theme.messages.boss_hint` | The line about the Esc key: on the mode chooser, on page 1 of the welcome in the game, and above the first step in "Just the workshop". Not in the terminal, which has no boss key. |
| `theme.labels.take_home`, `tip_banner`, `free_text_hint` | The "Take KAI home" line at the end of the workshop, the text of the TIP banner, and the hint to type the name of the software. |
| `stage.noSkip` | The reason shown when a Zen learner tries to skip stage 1. |
| `step.line` | The text of the dialogue box. |
| `step.only`, block `only` | Hide the item, or show it with an "Only if" label while the fact is unset. A step with `only` shows its label in the web and in the terminal. |
| `step.blocks` | The step page. A command is shown with a `$ ` prompt that the reader adds. The data has none, and Copy copies the bare command. |
| `step.goal`, `step.help` | The line "Tool: ... Docs: ..." under the step title, in the web (both modes) and in the terminal. The step help prompt: `{goal}`, `{tool}`, `{source}`, `{docs}` and `{expected}` (`help.expect`). A line of the template whose placeholders are all empty is dropped. |
| `step.check.kind` | The check row names the kind with `theme.checkKinds` ("Command available"). The reader never runs a check. |
| `step.check.prompt`, `fail` | The sentence to confirm, and the blocks of the "It did not work" panel. |
| `step.optional` | The side quest marker. |
| `stage:<id>` links | Open that stage in the web, and write "(stage N)" in the terminal. |
| `theme.prompts.fail`, `tip`, `unsetPlaceholder` | The prompt templates. An unset fact is written with `unsetPlaceholder`. |
| `theme.stages` | The location, nodes and items of each stage of the route. |

The web reader asks first for a mode ("Play the game" or "Just the workshop", saved as `kai.mode`) and opens a spreadsheet on Esc (the boss key). Both are built from data that we do not write: the labels and the sheet layout are in `modes` and `sheet` of `theme.base.json`, the rows come from the steps. The sheet shows the goal, the commands, `check.prompt` and the state for each step. The goal is `step.goal`, then the `goal` of the step help, then the title of the step, so no cell is empty. On a first visit with no saved mode the page always asks for the mode first (a mode saved in `kai.mode` skips the question).

### Where the reader and our reference differ

Round 4 closed three differences of round 3: the reader now takes `{tool}`, `{source}` and `{docs}` from the step (so a step that names its own tool, AuroraBoot in the kairos-lab stage, shows it), `{expected}` is `help.expect`, and it drops a line whose placeholders have no value. We then changed `tipFor` in this repository (web engine and `tui/main.go`), so the TIP and an unset `virtualization` is no longer a difference: the reader and our rule give the same answer for every combination of facts. What is left (the tests pin it):

- `{commands}`: the reader writes the commands without `$ ` and separates them with a blank line. We write one `$ ` line per command line.
- An unset fact: the reader writes `[YOUR OS]`, `[YOUR ARCHITECTURE]`, `[YOUR CONTAINER RUNTIME]` and `[YOUR VIRTUALIZATION]` (`unsetPlaceholder` and the label of the fact). We write `[YOUR OPERATING SYSTEM]`, `[YOUR CPU ARCHITECTURE]`, `[YOUR CONTAINER RUNTIME]` and `[YOUR VIRTUALIZATION: kairos-lab OR YOUR OWN SOFTWARE]`.
- A step with no `help`: we have no prompt for it. The reader builds one, with the title of the step as its goal, no tool and docs lines, and the check sentence as the expected result.

### Not used yet

- **`ends`**: the reader stops the loadout only through `askIf` (the compiler checks that this holds). It does not read `ends` from `workshop.yaml`.
- **`check.kind` values**: a reader that can run a check needs the values (the command, the image, the ISO), which `content.json` does not carry. The round 4 reader only names the kind.
- **`step.goal` for every step**: only a step with `help` has one. The spreadsheet uses the title of the step for the others. The YAML does not hold a goal for them, and we do not write one for the reader.
- **`theme.links.plainView`**: the reader still reads it (the theme must have `links`), and no screen uses the address any more. "Plain view" opens "Just the workshop".
- **Dropped stages**: `theme.stages` leaves out `fleet` and `edgevpn` until those stages exist. The item `kairos-fleet`, the item `edgevpn` and part 2 of `auroraboot` are then granted by no stage.
- **The overlay**: the base still holds copies of `welcome`, `loadout`, `prompts` and `stages`. The reader does not need them from the base, and the compiler replaces them. They can go from `theme.base.json` when the designer wants.

### Still hard-coded in the reader

Checked in round 5 (`grep` over `kai/web/*.js`, `kai/web/*.html` and `kai/tui/main.go`). The reader no longer holds a fact id, a fact value, a stage id or a workshop sentence in its logic. What is left:

- The free text field of the TIP has the placeholder `e.g. VirtualBox` in `KAI Workshop.dc.html`. It assumes that the free text is the name of a virtualization software.
- The page title and the badge file name say "Kairos workshop" (`headTitle`, `kairos-workshop-badge-`), and the boss key sheet is called "Q4 budget" on purpose.
- The variable `isMaster` (web) and the name `master` are still used for the result of `tipFor` and `freeTextFact`. Only the name is left.
- Sample data in the design pages (`KAI Kit`, `KAI States`): `os: 'macos'`, `virtName: 'VirtualBox'` and a date. They are not part of the reader. The usage text of the terminal app names `--facts os=macos,...` and `--stage build-image`, which is now a real stage id.
- The route is Europe and the mentors are four. Those are design assets in `kai-sprites.json` and `theme.base.json`.
- `theme.base.json` still names the stages `fleet` and `edgevpn`, the items of those stages and "Provision a fleet" in a mega item. They are design data of stages that this workshop does not have, and the compiler leaves the stages out.
