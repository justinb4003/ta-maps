# Tele-Arena Atlas

Interactive maps of the **Tele-Arena 5.6d** world (the classic Galacticomm / MajorBBS
door game, module `TSGARN`), rebuilt straight from the original module data.

**▶ Live site:** https://justinb4003.github.io/ta-maps/

## What this is

Every room, exit, shop and monster lair was extracted from the original game module —
**4,139 rooms across 41 zones** carrying their canonical names (Dungeon Level 1–3,
Mountains, Forest, Swamp, Sewers, Tower, Stoneworks, The Labyrinth, Hewn Granite
Corridors, Orc Caves, Stone Passages, the Dwarven Forest…). The browser lays those rooms
out on a grid from their exits and draws them in a retro DOS/ANSI style.

**How it's verified:** room data (names + exits) was checked room-by-room against the live
game engine — a bot teleported to each room and compared what the engine reported — and
the zone layout was reconciled against the published StarBase 21 community maps. This
module is the larger **5.6f / addon-merged** build (4,139 rooms; community stock 5.6d is
3,097), so it includes addon content like the expanded Labyrinth, Stone Passages and the
Dwarven Forest. Section-to-section progression in-game runs through rune gates and
teleports, which is why some zones are reached by magic words rather than walkable stairs.

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
