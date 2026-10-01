# kai (terminal)

Go standard library only. It reads `kai-sprites.json`, `theme.json` and `content.json` from `--assets`, `.`, `..`, `../web`, or next to the binary.

```sh
cd tui && go build -o kai .
./kai --assets ../web                        # play
./kai render --assets ../web --screen map --stage build-image --size 120x40 \
      --name Ana --character cap --cleared 3 --skipped build-image --facts os=macos
```

Progress (name, character, facts, done, skipped, completedAt) is saved to `<user config dir>/kai/progress.json`, using the same shape as the web version's localStorage (`kai.workshop.v2`).

Keys: arrows (j/k scroll) · Enter · Tab next command · c copy (OSC 52) · o print the command plain · y I did it · n it did not work · a show all options · s skip the current stop (then y) · l loadout · m route · q quit. On the name screen, type your name, use Backspace, then Enter.

Color: `--color auto` falls back to plain text for NO_COLOR, TERM=dumb and piped output, then picks COLORTERM=truecolor, TERM=*256color, or 16 colors. Without a UTF-8 locale every character is ASCII.

Raw keys use `stty`. Where it's missing (Windows cmd), type a key and press Enter.
