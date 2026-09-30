# Workshop format v0

This file is the normative description of the workshop content format. The JSON Schema files in this directory describe the shape of the data. This file describes what the data means and what every reader must do with it.

Format string: `kairos-workshop/v0`. It appears in `workshop.yaml` and in every stage file. A reader rejects a file with any other format string.

**v0 is unstable.** It may change without notice until a v1 is declared. From v1 on, any new field, fact value or check kind bumps the format version.

Files:

- `workshop.schema.json` describes `workshop.yaml`, the index of stages.
- `stage.schema.json` describes one converted stage file in `stages/`.
- `../../conformance/v0/` holds the fixtures every reader must pass.

## Structure

A workshop is a list of stages. A stage is a list of sections. A section holds text, warnings and steps. A step holds text, warnings and either variants or commands. A variant holds text, warnings and commands.

A stage in `workshop.yaml` is either a converted stage (`file: stages/<id>.yaml`) or a markdown stage (`id`, `title`, `markdown`, and an optional `goal`). Readers show a markdown stage as a link and do not parse it.

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

A fact is something the reader knows about their own setup. The set of facts is fixed in v0.

| Fact | Label | Question | Values (option labels) |
|---|---|---|---|
| `virtualization` | Virtualization | What runs your VMs? | `kairos-lab` (kairos-lab), `own` (My own software) |
| `os` | Operating system | What is your computer running? | `linux` (Linux), `macos` (macOS), `windows` (Windows) |
| `arch` | Architecture | Which CPU architecture? | `amd64` (amd64), `arm64` (arm64) |
| `runtime` | Container runtime | Which container runtime? | `docker` (Docker), `podman` (Podman) |

The label, the question and the option labels are what a game or a site shows when it asks the reader. `tools/lib/facts.mjs` is the source.

Wording used inside a sentence: `kairos-lab` is "kairos-lab", `own` is "your own virtualization software", `linux` is "Linux", `macos` is "macOS", `windows` is "Windows", `amd64` is "amd64", `arm64` is "arm64", `docker` is "Docker", `podman` is "Podman".

A fact can be unset. A reader must work with any subset of facts set.

## `when`

`when` is an object with at least one key. Each key is a fact. Each value is one allowed value or a list of allowed values. A list means any of them. Several keys mean all of them (AND). There is no other operator: no not, no OR across facts.

`when` can appear on a section, a step, a variant and a warning.

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
- A relative link to a `.md` file must name a file that exists. A link with `#anchor` into a converted stage must match a section anchor of that stage. A link to another stage by id, `stage:<id>`, follows the same anchor rule (see Links between stages).

A warning has a `kind`: `note`, `tip`, `important`, `warning` or `caution`. They map to the five GitHub alert kinds.

## Versioning

The format string names the version. A reader accepts only formats it knows. Changes in v0 before its release are listed in the changelog. From v1, every change is recorded here.

## Changelog

Unreleased v0:

- A stage file requires `goal`. A markdown stage entry in `workshop.yaml` can carry one.
- Stage ids are slugs without numbers, and titles do not hold "Stage N:". The number is the position in `workshop.yaml`. The generated file is `stage-<n>.md`. Stage 1 moved from `stage-1` to `kairos-lab`.
- Links between stages use `stage:<id>[#anchor]`, resolved by each publisher.
- The `virtualization` value `other` is now `own`. Every fact and every option has a label and a question in `tools/lib/facts.mjs`.

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
