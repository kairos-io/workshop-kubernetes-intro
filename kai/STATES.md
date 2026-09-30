# KAI: screens and states

Every state is live in `web/KAI States.dc.html`, including the terminal frames at 80×24 and 120×40. Stage ids are slugs (`kairos-lab`, `first-node`, …). Numbers on screen ("Stop 3") come from the order in `content.json`, so you can insert a stage without renumbering anything.

## Round 2: new screens and states

### Name entry
- Empty: the placeholder shows the default name ("Friend", `theme.player.defaultName`)
- Typing: web text input, capped at `theme.player.nameMax` (12). Terminal: printable keys, Backspace, Enter, Esc
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
