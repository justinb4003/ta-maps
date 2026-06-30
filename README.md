# Tele-Arena Atlas

Interactive maps of the **Tele-Arena 5.6d** world (the classic Galacticomm / MajorBBS
door game, module `TSGARN`), rebuilt straight from the original module data.

**▶ Live site:** https://justinb4003.github.io/ta-maps/

## What this is

Every room, exit, shop and monster lair was extracted from the original game module —
**4,139 rooms across 41 zones** (4 towns + 37 physical dungeon zones, from the entrance
caves down through the labyrinth, swamp, desert and volcano), connected by a
**99.6%-reciprocal exit graph**. The browser lays those rooms out on a grid from their
exits and draws them in a retro DOS/ANSI style.

Room data (names + exits) was verified room-by-room against the live game engine — a bot
teleported to each room and compared what the engine reported. Zones are grouped by
physical area (contiguous room-id range), not difficulty tier.

**Hover any room to reveal its hidden room number** — the thing the old hand-drawn maps
never showed you. Click a room to inspect its full description, exits, shops and monsters.
Each area has a shareable URL (e.g. `#Dungeon%20Level%201`).

## Legend

| glyph | meaning | glyph | meaning |
|:--:|--|:--:|--|
| `O` | plaza / square | `M` | monster lair |
| `$` | shop | `+` | door |
| `†` | temple | `A` | arena |
| `G` | guild | `·` | room |

## Files

- `index.html` / `style.css` / `app.js` — the static site (no build step, no dependencies)
- `ta-rooms.json` — the extracted room database (rooms keyed by signed id; towns negative,
  dungeon positive), plus a `meta` block documenting the parse for reproducibility.

## Notes

A fan/preservation project. Tele-Arena and its text are the work of their original authors;
this repository reproduces map/connectivity data and room text for historical and
educational reference.
