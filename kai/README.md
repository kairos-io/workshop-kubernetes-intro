# KAI: the Kairos armadillo, workshop companion (round 3)

```
web/
  KAI Workshop.dc.html   the app: title, name, character, loadout, route, mentor, stage,
                         transitions, items, complete, badge, settings
  KAI Screen.dc.html     160×144 game viewport (embeddable)
  KAI States.dc.html     every screen and state, web + terminal (80×24, 120×40)
  KAI Kit.dc.html        sprites, poses, items, logos, game lines
  KAI Md.dc.html         markdown renderer (paragraphs, lists, inline code, links)
  kai-engine.js          shared: pixels, facts, flattening, progress, mentorPlan, inventory, route
  kai-term.js            terminal layout, JS twin of tui/main.go
  support.js             Design Component runtime (keep it)
  kai-sprites.json       KAI + 3 characters, icons, 24×24 mentor portraits, Europe raster, palettes
  theme.json             theme only: player, mentors, locations + items per stage, items, mega, poses, lines, labels
  content.json           workshop data: facts, stages {id (slug), title, goal, steps}
tui/                     Go terminal app (stdlib only)
STATES.md                every screen and state, plus the mentor-pick function
```

## theme.json sections
- `footer`, `welcome {mentor, pages[] {line, md}}`, `loadout {questions, notices}`, `prompts {fail[], tip[], placeholders, warning}`
- `player`: `nameMax`, `defaultName`, `characters[] {id, label, desc}`, `poses[]`
- `mentors[] {id, name, country, portrait, github}`: `portrait` keys into `kai-sprites.json → portraits`. `mentorPick` describes the hash (see STATES.md)
- `stages[] {id, location, nodes, items[]}`: an item like `auroraboot#2` grants part 2 of a mega item
- `items {id: {name, icon, desc}}`, `mega {id: {name, icon, desc, parts[] {label, icon?}}}`: a part no stage grants shows as "coming soon"

## Run
```sh
cd web && python3 -m http.server 8000   # http://localhost:8000/KAI%20Workshop.dc.html
cd tui && go build -o kai . && ./kai --assets ../web
```

## Before publishing
- Stage 1 uses the commands you gave. Stages 2–9 are realistic samples: verify every command, output and path. The fleet and edgevpn stages are new.
- Plain view: https://github.com/kairos-io/workshop-kubernetes-intro (`theme.links.plainView`).
- Stage `tool`/`docs` URLs in content.json are best guesses for the AI prompts: verify them.
- The mentor portraits are hand-drawn 24×24 pixel art, based on each maintainer's public GitHub avatar. Show them to the four mentors before release.
- The Europe outline comes from Natural Earth (public domain).

## Licensing
KAI, the Kairos armadillo, designed by Mauro Morales. Apache-2.0.

## Our content

The content in this repository is generated. Two files in `web/` come from `npm run compile:kai -- --out kai/web`, which reads `workshop.yaml`, `stages/*.yaml`, `kai/lines.yaml` (the short lines of the dialogue box) and `kai/theme.base.json`:

- `web/content.json` holds the facts and the stages. It is all ours.
- `web/theme.json` is the designer's theme with four keys generated from our data: `welcome`, `loadout`, `prompts` and `stages`. Every other key is copied from `theme.base.json`.

Do not edit either file by hand. CI fails when one is stale. [DATA.md](DATA.md) describes every field of both, who owns each key, and what the reader could read from our data in the next round.

`theme.base.json` is the designer's `web/theme.json` of the export, saved under another name. It is designer-owned, and we do not edit it. The `welcome`, `loadout`, `prompts` and `stages` keys in it are not used: the compiler replaces them. The `stages` list of the generated file holds only the stages of `workshop.yaml`, so `fleet` and `edgevpn` come back when those stages exist.

The rest of this folder is the designer's round 3 export, unchanged, with these exceptions. The designer's `web/content.json` is not kept, because ours is generated. The built binary `tui/kai` is not committed (build it with `cd tui && go build -o kai .`).

`tui/main.go` is still the round 2 file. The round 3 file does not compile: line 438 has a line break inside the string in `strings.Split(par, "...")`, and it must read `"\n"`. We do not edit the designer's files, so this stays at round 2 until the designer sends a fixed `main.go`. The terminal reader therefore does not show the round 3 screens yet, and the web reader does.
