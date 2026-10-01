# KAI: screens and states

Every state is live in `web/KAI States.dc.html`, including the terminal frames at 80×24 and 120×40. Stage ids are slugs (`kairos-lab`, `first-node`, …). Numbers on screen ("Stop 3") come from the order in `content.json`, so you can insert a stage without renumbering anything.

## Round 5: fixes

- First visit: a standalone page (no seed, keys on) with no saved `kai.mode` always opens the mode chooser, whatever the `view` default is. Embedded pages (KAI States, keys=false + seed) keep using `view`. Header buttons and the footer mode link are hidden on the chooser. Screenshot: `assets/first-visit-chooser.png`
- Fact ids and values come only from `content.facts`. Prompt placeholders are built for every fact id. A value can be rewritten through `theme.factPrompt` (design-owned), where `@freeText` means "what the learner typed", e.g. the name of their virtualization software
- TIP: shown only where `content.stages[].tipOnly` matches the loadout (an "only" map; a fact that is unset or "unsure" counts as a match). No `tipOnly` in the data means no TIP
- Spreadsheet Goal column: `step.goal`, then `help.goal`, then the step title
- Boss key line: `messages.boss_hint`. Shown once in the intro (welcome page 1 in Quest, the first step in Presentation) and as the small hint on the mode chooser. Not in the terminal: it has no boss key
- "Take KAI home…" and the TIP banner are now `labels.take_home` and `labels.tip_banner`

## Round 4: new screens and states

### Data
- The reader reads `content.json` and `theme.json` as your compiler writes them. Copy for `welcome`, `loadout`, `prompts` and `stages` is never hard-coded. Stage count, stage list and step ids always come from the data
- `theme.base.json` holds the design-owned keys. Round 4 adds `checkKinds`, `modes`, `sheet` and a few `labels` (tool, docs, text_bigger, text_smaller, theme_light, theme_dark, stages_nav)

### Mode chooser (first screen)
- "Quest" / "Presentation". The internal values are `game` and `workshop`, and `kai.mode` keeps them. Saved in localStorage `kai.mode` (try/catch). Shown when nothing is saved
- Switch: the Mode group in Settings, with three options: Quest, Presentation and Boss. Boss turns the spreadsheet on, like Esc, and is not saved in `kai.mode`. The chooser offers only Quest and Presentation. The title menu's 3rd item ("Presentation") opens the Presentation mode
- The website panel under the title screen is gone. The section under the game only shows when it has content

### Presentation (internal value `workshop`)
- No welcome, mentors, XP, route or game screen. Stage list on the left (✓ and done/total), the current stage in the middle, with the same steps, commands, notes, help and AI prompts
- Loadout: same one-question flow on the first visit, then from the header
- "Next step" marks the step done and goes straight to the next open step, then the next stage
- Projector: light (default) or dark; A− / A+ in the header scale the whole page 90%–175%. Saved in `kai.workshop.view`

### Boss key (web, both modes)
- Esc, or "Boss" in the Settings Mode group → spreadsheet: title bar "Q4 budget", menu row, toolbar, formula bar (address + selected cell), columns A–F, numbered rows, one sheet tab per stage. Each step is a row: #, title, goal, commands (with $), check, status
- Commands stay selectable. Clicking a cell shows its content in the formula bar
- The tab title and icon change, and are restored on Esc again (or on unmount). The reader returns to the same mode, stage and step
- Esc does nothing while Settings, the skip confirm, the mode chooser or the loadout flow is open. The loadout uses Backspace / Back to go back

### Steps
- `help {tool, source, docs, expect}` per step: a Tool (links to source) + Docs line under the step title, in both modes and in the terminal
- "I'm stuck" prompt: {tool} {source} {docs} {expected} come from the step's help. If a line's placeholders are all empty (a step with no help), that line is dropped
- Step-level `only`: shown with its "Only if" label while the fact is unset
- Check row shows the check kind (command-available, image-exists, iso-exists, vm-running, manual). The reader never runs anything
- Commands show a `$ ` prompt (not selectable on the web). Continuation lines after `\\` get two spaces. Copy copies the raw command
- `[label](stage:id)` links open that stage (anchors after # are ignored)

### Unset facts
- Items keep their "Only if" label. Prompt placeholders use `prompts.unsetPlaceholder` with the fact label, e.g. "[YOUR CONTAINER RUNTIME]". An unset virtualization uses it too

## Round 3: new screens and states

### Name entry
- The text field has focus when the screen opens, with a visible caret. Typing works at once. Clicking the game screen also focuses the field
- Enter or "Continue" goes to Welcome

### Welcome (theme.welcome)
- Mentor: Mauro (portrait, name, country). The mentor is `theme.welcome.mentor`
- 5 pages, one paragraph each, `{name}` filled. Page counter + dots, Back from page 2, Next, last page "Start your quest"
- Page 5 links "Spectro Cloud" to the Kairos support page
- Keyboard: Enter / → next, ← / Esc back. Terminal: same

### Loadout (theme.loadout + content.facts: askIf, forces, notice)
- One question per screen, "Question n of m". Next is disabled until the question is answered. Back / Esc goes back
- a. OS: Linux, macOS, Windows
- Windows: notice screen "This is not game over…". Virtualization is forced to Master, and the virtualization and architecture questions are skipped
- b. Virtualization (Linux, macOS): Zen (recommended badge) or Master, each with its description. It never asks which software you use
- c. Architecture (Linux, macOS): amd64 / arm64. "Not sure?" toggles the help: `uname -m` (copyable) and how to read the output
- d. Runtime: Docker / Podman with the choice note. For Zen, an extra note about `kairos-lab setup`. All runtime explanation lives here
- Changing the OS clears answers that no longer apply

### "Only if" labels
- Hidden on alternatives, tabs and callouts whenever the loadout answers that fact
- Shown for unanswered facts (e.g. architecture on Windows) and for every item under "Show all options"

### Check row and help
- Buttons: "OK" (`labels.check_ok`, marks the step done and goes to the next step) and "It did not work"
- How to check: when the step check has a `verify`, the check box shows a terminal block titled "How to check" (`labels.check_verify_title`) with `$ <command>` and a Copy button that copies the bare command. Under the command, an example of the output, dimmer, after "You should see something like" (`labels.check_output_label`) when `verify.output` is set. The learner runs the command by hand. The reader never runs it. The terminal shows the same under the check line
- It did not work: the viewport shows KAI sad ("LET'S FIX IT"), the step's common fixes, then the AI prompt panel: intro, warning ("Remove tokens…", warning icon, thick border), the prompt in monospace with placeholders highlighted, and Copy (idle / copied / failed)
- Zen: `{virtualization}` = kairos-lab. Options mapped to `@freeText` in `theme.factPrompt` keep the `prompts.virtPlaceholder` highlighted until you type the name in the field above the prompt (saved as `virtName`). Terminal: press v and type it
- Unset facts (e.g. arch on Windows) become `[YOUR ARCHITECTURE]` placeholders
- "What I ran" lists the commands shown for your setup (the selected tab on the web)
- No "No penalty" line anywhere

### Ask KAI for a TIP (Master only)
- A banner on every stage: "Ask KAI for a TIP". It opens a stage prompt built from `theme.prompts.tip` + `content.stages[].tip`. Terminal: t

### Skipping
- `content.stages[].noSkip: {when, reason}`. kairos-lab can't be skipped when virtualization is Zen
- Web: a disabled "Can't skip" button with the reason under it. Terminal: the reason on the row, and s shows it as a message

### Route
- Cleared stops: own color (page palette `cleared`/`onCleared`, at least 4.5:1) + ✓ label. In the viewport the town tile is inverted with a ✓ above it

### Markdown
- Ordered and unordered lists (`1.`, `-`), with a hanging indent in the terminal. Inline code inside link labels: `[\`kairos-lab\` README](…)`

### Footer
- "KAI, the Kairos armadillo, designed by Mauro Morales. Apache-2.0." (`theme.footer`), on the web footer and the terminal title screen. Plain view → workshop-kubernetes-intro

## AI prompt templates (theme.prompts)
`fail` and `tip` are arrays of lines with placeholders: {stage} {step} {os} {arch} {runtime} {virtualization} {goal} {tool} {source} {docs} {commands} {expected} {logs} {ask}. The screens only fill these. Stage data: `content.stages[].tool {name,url}`, `docs`, `tip`, `goal`; step data: `goal` (falls back to the title).

## Round 2: new screens and states

### Name entry
- Empty: the placeholder shows the default name ("Friend", `theme.player.defaultName`)
- Typing: web text input (focused on open), capped at `theme.player.nameMax` (12). Terminal: printable keys, Backspace, Enter, Esc
- Confirming an empty name uses the default. The name appears in the HUD, the route header, the mentor lines and the badge

### Character choice
- Three looks named by style: Hoodie, Cap, Beanie (`theme.player.characters`)
- Selected: inverted + ● on the web, `[brackets]` in the terminal. ← → and Enter
- Poses per character: idle, walk (down, up, left, right), happy, sad, point, read, celebrate (`kai-sprites.json` → `frames["p-{id}-{pose}"]`, `playerAnimations`)

### Mentor intro (start of every stage)
- Card: 24×24 portrait, full name, country
- Line: "{mentor} will teach us today how to {goal}." `{mentor}` is the first word of the name; `{goal}` comes from `content.json` → `stages[].goal`
- Enter / "Let's go" opens the stage. "Route" goes back

### Route (replaces the world map)
- A real Europe map (Natural Earth 1:50m land, rasterized into `kai-sprites.json` → `europe`)
- N stops spread evenly along one route polyline (`europe.route`), so 9 stops today or more later without a redesign. The viewport and the terminal list scroll to the cursor
- Stop states: locked (lock), current (you stand on it, ●), cleared (✓), skipped (bar / »)
- Mentor portrait for the stop under the cursor (viewport card, and every row on the web list)
- Skip: only the current stop, after a confirm ("Yes, skip it" / "Keep it"; terminal: s then y). Skipping opens the next stop, never blocks anything and still counts toward the badge. A skipped stop can still be cleared later

### Stage clear with the mentor
- Mentor portrait + KAI jump (still with reduced motion) + you celebrating
- Line: "Nice work, {name}! {mentor} is proud of you."

### Items
- One row per item the stage grants (`theme.stages[].items`)
- Mega item: `auroraboot#1`, `auroraboot#2` grant parts of AURORABOOT. It shows as "AURORABOOT 2/3", with the next part and the stop that grants it
- "Coming soon": a part that no stage grants (part 3, Netboot) shows as coming soon, in the item list and on the complete screen
- Unearned (stage skipped or not cleared): ??????

### Complete
- Recap per stop with mentor, steps, side quests, "» skipped"
- Inventory: owned items, ?????? for unearned, dashed "coming soon" cards
- CTA "Continue in your terminal: install kairos-lab" with the command for your loadout

### Badge
- KAI's face, your name, the completion date (YYYY-MM-DD, saved as `completedAt`)
- Web: "Download badge (PNG)" (6× scale)
- Reachable once every stop is cleared or skipped

## Mentor pick (stable, no storage)
Implemented as `mentorPlan(name)` in `kai-engine.js` and `tui/main.go`, which return the same result:

1. `n = lower(trim(name))`
2. Split the stage ids (content order) into blocks of `len(mentors)` (4)
3. For each block: `rng = mulberry32(fnv1a32(n + "|" + blockIds.join(",")))`, then Fisher-Yates shuffle the mentor ids with `j = rng() % (i + 1)`
4. If the block's first mentor equals the previous block's last, swap the block's first two
5. Stage `k` of the block gets `perm[k]`

Guarantees: with 4 or more stages every mentor appears at least once (the first block is a full permutation), and no mentor teaches two stages in a row (each block is a permutation, and step 4 fixes the joins between blocks). Changing the name or inserting a stage reshuffles, deterministically.

## Round 1 screens (unchanged rules)
- Title: new player (Continue disabled), saved game ("Continue as {name}")
- Loadout: four facts, "Not sure yet" default, focused row, opened from a stage
- Stage: pills, alternatives (tabs/stacked, "Only if"), copy idle/copied/failed, expected output, note/caution/warning, side quest badge, check to do/failed/done, poses point/read/think/sad for both you and KAI
- Transitions: step cleared, side quest done
- Empty state: no option matches → Show all options / Change loadout
- Settings: palette, motion, text size, alternatives layout, plain view, reset
- Mobile: 2× viewport, everything wraps, 44 px targets
- Terminal: 80×24 stacked, 120×40 two columns; truecolor/256/16/none; ASCII when the locale isn't UTF-8; keys listed in `tui/README.md`

## Data
- `content.json`: facts, stages `{id, title, goal, steps}`. Workshop data only
- `theme.json`: theme only. `player`, `mentors` (+ `mentorPick` description), `stages` (location, nodes, items), `items`, `mega`, `poses`, `messages`, `labels`
- `kai-sprites.json`: frames (KAI + characters), icons, `portraits` (24×24 per mentor), `europe`, palettes (now with `player` and `portrait` regions)
