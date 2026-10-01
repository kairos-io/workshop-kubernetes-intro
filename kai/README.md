# KAI: the Kairos armadillo, workshop companion (round 2)

```
web/
  KAI Workshop.dc.html   the app: title, name, character, loadout, route, mentor, stage,
                         transitions, items, complete, badge, settings
  KAI Screen.dc.html     160×144 game viewport (embeddable)
  KAI States.dc.html     every screen and state, web + terminal (80×24, 120×40)
  KAI Kit.dc.html        sprites, poses, items, logos, game lines
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
- `theme.links.plainView` is a placeholder (https://kairos.io/docs/).
- The mentor portraits are hand-drawn 24×24 pixel art, based on each maintainer's public GitHub avatar. Show them to the four mentors before release.
- The Europe outline comes from Natural Earth (public domain).

## Licensing
KAI is based on the armadillo artwork in kairos-io/community (Apache-2.0). Keep that attribution. It appears in the web footer and on the terminal title screen.

## Our content

The content in this repository is generated. `web/content.json` comes from `npm run compile:kai -- --out kai/web`, which reads `workshop.yaml`, `stages/*.yaml` and `kai/lines.yaml` (the dialogue line for each step). Do not edit `web/content.json` by hand. CI fails when it is stale. [DATA.md](DATA.md) describes every field of it.

`theme.json` stages lists the stages that exist. Add fleet and edgevpn when those stages are written.

This folder is the designer's export. The only edits to it are `web/theme.json` (fleet and edgevpn removed from `stages`), this section, `DATA.md`, and the omitted built binary `tui/kai` (build it with `cd tui && go build -o kai .`).
