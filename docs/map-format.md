# Map format (rfw-map, version 2)

Maps are JSON files. The same format holds the original maps, the built-in 3- and 4-base maps and maps made in the
[level editor](level-editor.md).
It replaces the original `.RFM` tile codes, which mixed terrain, building, team and special handler into
one byte and only allowed two teams.

The key change is that a map defines **bases**, not teams. The lobby owner picks how players are split
into teams (free for all, 2v2, 2v1, 2v1v1 and so on) and the game assigns teams to bases. The match is won
by the last team or player standing.

```json
{
  "format": "rfw-map",
  "version": 1,
  "name": "Driving School",
  "author": "Van",
  "source": { "file": "RFMAP101.RFM", "level": 1, "scenerySeed": 71459 },
  "width": 128,
  "height": 128,
  "players": { "min": 2, "max": 2 },
  "terrain": "AgICAgIC...",
  "bases": [
    { "id": 0, "start": { "x": 48, "y": 66 }, "flagSites": [{ "x": 46, "y": 64 }] },
    { "id": 1, "start": { "x": 53, "y": 54 }, "flagSites": [{ "x": 57, "y": 53 }] }
  ],
  "objects": [
    { "type": "PALM_1S", "x": 66, "y": 42, "base": null },
    { "type": "TENT_H", "x": 66, "y": 43, "base": 1 }
  ],
  "settings": {
    "vehicles": { "tank": null, "jeep": null, "asv": null, "heli": null },
    "randomMines": null,
    "aiPool": null
  }
}
```

| Field | Meaning |
| --- | --- |
| `source` | Set only on converted original maps: the original file, its `LEVL` chunk, and `scenerySeed`, the sum of its tile codes, which the original uses to scatter bushes, palms and rocks up to 12 px off their tile centres. `null` for new maps (they use seed 0). |
| `width`, `height` | 1 to 128 tiles. Smaller maps are centred in the 128 × 128 world, and the rest is open water, as in the original. |
| `players` | How many player slots the map supports. `max` can't exceed the number of bases. |
| `terrain` | Base64 of `width × height` bytes, row by row. Each byte is a terrain sprite index (0–127). |
| `bases` | 1 to 4 bases, `id` equal to their position. Every base is a player slot and needs a `start`. Bases 1–4 play in Brown, Green, Blue and Red. |
| `bases[].flagSites` | Buildings the flag can hide in. The original picks one at random when the match starts (`sub_414130`). |
| `objects` | Every building and piece of scenery. `type` is the name from the original building table (`BNO_` prefix dropped). `base` is the owner, or `null` for neutral scenery. Start points and flag sites are not repeated here. |
| `settings` | Per-map overrides. `null` means the game default. |

## Version 2

The level editor writes version 2. It adds optional fields only, so version 1 files (the converted originals) load
unchanged.

| Field | Meaning |
| --- | --- |
| `description` | Free text shown in the map browser, up to 2000 characters. |
| `bases[].vehicles` | This base's own vehicle counts (`tank`, `jeep`, `asv`, `heli`). A missing or `null` field uses `settings.vehicles`. |
| `settings.music` | The music track id to play, or `null` for the game's choice. |
| `notes` | The editor's notes layer: `{ "x", "y", "text" }` pinned to tiles, up to 200. Notes never affect a match. |
| `id`, `authorId`, `visibility`, `revision` | Set by the map library. `visibility` is `private` (only the author), `unlisted` (anyone with the link) or `public` (listed in the map browser and lobbies). The server keeps its own values for these and ignores what an upload says. |

Thumbnails are not part of the file: the client renders one when a map is saved to the library, and the server
stores it beside the map.

Vehicle counts are 0 to 99, or 255 for unlimited (the original's 0xFF). `players.max` can't exceed the number of
bases; the editor keeps it equal to that number.

## Playability checks

`checkMap` (`packages/sim/src/mapcheck.ts`) lists a map's problems, each with the tiles it is about. Errors stop
a map being test played or shared; warnings are shown but allowed.

| Code | Level | Problem |
| --- | --- | --- |
| `no-bases`, `format`, `unknown-type` | error | No bases yet, a broken format rule, or a building name not in the table. |
| `lift-water`, `lift-blocked`, `lift-boxed` | error | A base's start (its lift) is not on land, has a building on it, or every way off it is blocked by something a tank can neither cross nor destroy. |
| `start-shared` | error | Two bases start on one tile. |
| `no-flag`, `flag-water`, `flag-on-lift`, `flag-shared` | error | A base has no flag site, one in deep water, one on a lift, or one another base also uses. |
| `no-jeeps` | error | A base's jeep count is 0, so it would be out at the start (a base with no jeeps left is eliminated). |
| `bridge-open` | error | A bridge end without its partner. The loader would lay deck to the end of the map. |
| `stacked`, `flag-covers`, `flag-twice`, `many-flags` | warning | Two buildings on one tile, a flag site over a building, a repeated flag site, or more than 16. |
| `unreachable` | warning | A jeep from one base can't reach another base's flag site through land, shallow water, bridges and anything a tank can destroy. That base can then only be beaten by destroying all its jeeps. |

`parseMap` reads a map from untrusted JSON (an imported file or an upload), checks every field's type and returns
a copy with only the format's fields.

## Painting shorelines

The editor paints land, shallow and deep water on the corners of tiles and picks each tile's terrain from its four
corners (`paintGround` in `packages/sim/src/mapedit.ts`). The corners of each shoreline piece are read from its
shape in `shore.json` with the same classifier the game uses, so painted coasts use the original's pieces: 4–23
between land and shallow water, 40–51 between shallow and deep water. Deep water never touches land; a ring of
shallow water is left between them. Tiles that already fit their corners are kept, so roads and other land
pieces survive painting nearby.

## Settings

These come from the original `VHCL` chunk, read by `sub_413f00`. An original map could also override them in its
file name, as `[A3H2J5T1M50]`.

| Field | Original byte | Default when `null` |
| --- | --- | --- |
| `vehicles.asv` | 0 (`A`) | 3 |
| `vehicles.heli` | 1 (`H`) | 3 |
| `vehicles.jeep` | 2 (`J`), 1–9 | 8 |
| `vehicles.tank` | 3 (`T`) | 3 |
| `aiPool` | 4 | set by difficulty level (table at `0x442fd8`), at most 5 per base (`sub_409ea0`) |
| `randomMines` | 5 (`M`), up to 200 | none, or 4 per level at difficulty 7 and up. Mines are scattered at match start on and beside roads first, then open ground, never on buildings or next to a lift (`sub_42a030`) |

## The original maps

The 104 original two-player maps are kept as version 1 files in the art pack (`assets/art/pack/maps/`, with
`index.json` listing them; see [assets.md](assets.md#what-comes-from-the-original)).
The remake keeps none of the original's single-player maps. Each has two bases; only new maps use 3 or 4.

They were converted once from the original's `.RFM` files by a converter that has since been removed. It checked
every map by rebuilding the original loader's grid (terrain, building, team and special for every tile) from the
converted file and comparing it with the grid built from the `.RFM` tile codes. Two details of the original loader
show in the files:

- A tile code with no terrain of its own leaves terrain 0.
- Tile codes 240 and above are read as 0.

## Built-in 3- and 4-base maps

The originals have only two bases, so the 3- and 4-base maps that ship with the game are made from pieces of them
(`packages/sim/src/mapgen.ts`). The game server and the dev server make them in memory from the two-player maps
in the art pack each time those load (about a second), never write them to disk, and serve them
under `/generated/maps/` as if they were files, with `maps/index.json` listing them after the originals.

`analyseMaps` reads every original map and keeps:

| Element | How it is found |
| --- | --- |
| Blocks | Each base's buildings and flag sites, grouped where they stand within two tiles of each other: walled compounds, flag houses, tower clusters. A block is kept if it is 2 to 12 tiles each way, all on land, holds at least four pieces and nothing of the other base's or its start. Blocks with a flag site are flag compounds; ones with gun towers, bunkers or outposts and no flag are defence blocks. The ground under them (roads, concrete) and the scenery inside come along. |
| Lift pads | What stands within two tiles of each start. |
| Tiles | The lift tiles (90 for even bases, 91 for odd), the most common plain land tile, and the road tiles that lead onto east–west and north–south bridges. |
| Bridges | The length of every bridge, for how wide a channel to bridge. |
| Scenery | How many pieces of neutral scenery stand per 1000 tiles of open land, and of which kinds. |

`generateMaps` builds each plan in `MAP_PLANS` (eight 3-base maps, `tri01`–`tri08`, and eight 4-base, `quad01`–`quad08`,
listed at levels 2–9 by the level their blocks come from):

- Every base gets the same kit: its lift and pad, a flag compound behind it and a defence block in front, each with
  its mirror image on the other side of the lift, so the kit is its own mirror image. From level 3 a block of the
  base's other buildings stands beside the flag compound, and from level 6 a second defence block beside the
  first, as long as the kit stays within 18 tiles of its lift each side.
- **4 bases**: the four quarters mirror each other (the level editor's Mirror both). Each base's home island is
  joined to its neighbours across both mirror lines by land, or by a bridge over a channel, with road leading on.
- **3 bases**: the left and right halves mirror each other (an odd width, so base 1's lift sits on the middle
  column). Base 1 is at the top facing south; bases 2 and 3 below it face north, and the three lifts make a
  triangle with equal sides. Bases 2 and 3 are joined by land or a bridge, and each to base 1 by land.
- The land is shaped to look like the originals'. A base's island is a disc with two to four lobes; every shape's
  edge is moved in and out by noise (up to five tiles on islands, two on the necks of land between them); three
  to seven islets stand off the coast; and a bridged channel's banks wander. Only the blocks, the pad and the
  lift's row and column are sure to be land, so no two coasts are alike.
- Roads run from each lift along its row and column to its neighbours, in steps up the slope between bases 1 and
  2 of a 3-base map, and onto the bridges. Each road tile is the piece for the sides it has road on (tiles
  73–83).
- Scenery is as thick overall as the originals have it, but stands in groves with clearings between.
- Coasts are painted with the original's shoreline pieces.
  Where the game has a piece for a coast corner in one orientation but not its mirror image, both sides get plain
  ground, so the ground mirrors exactly.
- Each map must pass `checkMap` with no errors and with every flag in reach of every other base; otherwise the
  layout is drawn again with the next seed (up to 40 times).

The maps come out the same from the same originals on any machine. They use the game's default vehicle counts.
`npm test` checks that every plan is made, passes the checks, starts a
match with every base, and is symmetric piece for piece.

## Loader behaviour the sim must copy

The original loader adds bridges after reading the tiles. A run of tiles between terrain 84 and 85 (east–west)
gets building 74 on every tile in between, and a run between 86 and 87 (north–south) gets building 75. Bridges
are not stored in the map file; `buildWorld` adds them the same way (`addBridges` in `packages/sim/src/map.ts`).
