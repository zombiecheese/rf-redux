# Level editor

The editor is a second page of the client, `editor.html` (Level Editor in the game's main menu). It draws the
map with the game's own renderer and tiles, so a map looks the same in the editor as in a match. It writes maps in
the rfw-map format, version 2 ([map-format.md](map-format.md)).

It is desktop only: it needs a mouse and a keyboard. Phones and tablets (the same check that keeps them to one
player) do not get it in the game's menu, and `editor.html` opened on one shows a "Desktop only" notice instead.

## Layout

- **Tools** (left), each with a key: Select (S), Land (L), Shallows (W), Deep water (D), Tile (T), Bridge (R),
  Building (B), Erase (E), Base start (A), Flag site (F), Note (N), Move view (H). Painting tools take a shape:
  brush (1, 2, 3, 5 or 7 tiles across), line, box or fill.
- **Symmetry**: off, mirror left to right, mirror top to bottom, mirror both ways, half turn, or quarter turn
  (square maps). Every edit is repeated on the mirrored tiles; buildings are turned to match (a north-facing bunker
  becomes a south-facing one) and owned by the matching base, so base 1's turret mirrors as base 2's. Map > Make
  Symmetric copies the first half (or quarter) of the map onto the rest.
- **View** (middle): top down, or the game's tilted camera (Tab). The wheel zooms, a right-drag or Space + drag
  pans, 0 fits the whole map. The minimap jumps on click.
- **Side panel** (right): the palette for the current tool, the Map tab (name, description, size, players,
  vehicles per map and per base, random mines, attack drones, music) and the Problems tab.

## Painting ground

Land, Shallows and Deep water paint the ground and pick the coast pieces themselves. The editor reads the corners
of each shoreline tile from the game's shoreline shapes (`shore.json`), the same shapes the game uses to decide
where a vehicle is wading, so a painted coast both looks and plays like the original's. Deep water never touches
land: a strip of shallows is left between them. Land can be painted with any land tile (grass, sand, road...).

The Tile tool lays one terrain tile exactly as picked, for roads and details. Alt + click takes the tile or
building under the cursor as the brush.

## Bases

A map has 1 to 4 bases. Each is a player slot; in a match the computer plays any base nobody takes. A base needs a
**start**, the lift its vehicles come up on, on open land with a way off it, and at least one **flag site**, a
building the flag can be hidden in (one is picked at random when the match starts). With symmetry on, placing base
1's start also places the mirrored bases' starts.

## Problems and test play

The Problems tab lists everything `checkMap` finds, and the map view outlines the tiles involved (red for errors,
amber for warnings). Errors (a lift in the water, a missing flag site, a base with no jeeps, which would be out at the start, a bridge
end without its partner...) stop a map being test played; warnings (a jeep can't reach a flag, two buildings on one tile...) don't.

Test Play (P) starts a solo match on the map from a base you pick, with the computer playing the others at the
skill you choose, with the game's keys (README, Controls). P pauses and Esc comes back to the editor where you
were; the editor's own keys wait until then. ? (Shift+/) lists the editor's keys.

## Saving

Maps are kept as drafts in the browser and save themselves as you work. File > Open lists them, and opens a copy
of any of the 104 original maps. File > Export writes a `.rfw.json` file; Import reads one back (checked with
`parseMap`, so a broken file is refused with a reason). Drafts with two or more bases appear in the game's Level
Selector under Add-Ons.

## Map library

When the editor is served by the game server and you are signed in, maps can also live on the server:

- **File > Save to Library** (Ctrl+Shift+S) saves the open map to your account as **private** (only you),
  **unlisted** (anyone with its id, not listed) or **public** (listed for everyone). The server checks it again
  with `parseMap` and `checkMap`: a map with errors can be kept privately but not shared or played. It signs the
  map with your account name and saves a small picture of it from the minimap. Saving again makes a new revision;
  the last 20 are kept. If the library has a newer revision than the one you opened (saved from another browser),
  you are asked whether to save a new map instead of overwriting it.
- **File > Shared Maps** (Ctrl+Shift+O) lists public maps with search, sorting (newest, most liked, most played,
  name) and featured maps first, where you can like or report a map. The picked map is previewed beside the list,
  drawn from the map itself (see Map previews below). Opening someone else's map makes a private
  copy for you. The **My library** tab lists your own maps, changes who can see each one, opens an older revision
  or deletes a map. The original maps are under File > Open.
- Lobbies can use any map their owner may see: the lobby map picker lists your own playable maps under "My maps"
  and public ones under "Shared maps". Each finished online game counts as a play.

### Map previews

Every screen that picks a map shows the picked one: the game's Level Selector (all levels, 3 & 4 Players and
Add-Ons), Host a Game and the lobby's Change Map, the lobby itself, and Shared Maps here. `packages/client/src/mappreview.ts`
draws the map with the game's own renderer looking straight down, as this editor's top view does, cropped to the
land with a little sea around it (most original maps are islands in a 128 × 128 sea), and marks each base's start
with a numbered disc in its colour. Flag sites are not shown. Pictures are made in the browser from the map file,
so the built-in maps, the 3- and 4-base maps the server makes in memory and library maps all get one without
anything being stored; each is drawn once per visit and kept while the page is open. The
small picture saved with a library map is still used for the Shared Maps list and the admin panel.

Moderation is in the admin panel's **Maps** section: the report queue, search over every map, and per map hide
(with a reason the author sees; a hidden map can only be private), make private, dismiss reports, and for admins
feature, delete and set that author's map limit. Admins also set the site's limit of maps per account and words
refused in shared maps' names and descriptions (on top of the chat filter). Every action is in the audit log.

| API | Who | Does |
| --- | --- | --- |
| `GET /api/maps?visibility=public&q=&sort=new\|likes\|plays\|name&featured=1&page=` | anyone | Public maps, 30 a page |
| `GET /api/maps?mine=1` | signed in | Your maps, and your limit |
| `POST /api/maps` `{ map, visibility, thumb }` | signed in | Save a new map |
| `PUT /api/maps/:id` `{ map, visibility, thumb, revision }` | author | Save a new revision (409 if `revision` is not the latest) |
| `GET /api/maps/:id`, `/thumb` | who may see it | The map and its picture |
| `POST /api/maps/:id/visibility`, `DELETE /api/maps/:id` | author | Share or unshare; delete |
| `GET /api/maps/:id/revisions`, `/revisions/:rev` | author | Past revisions |
| `POST /api/maps/:id/like` `{ like }`, `/report` `{ reason }` | signed in | Like, report |
| `GET /api/admin/maps?filter=reported\|shared\|hidden\|featured\|all&q=`, `/:id/reports` | moderator | The moderation list |
| `POST /api/admin/maps/:id/action` `{ action, reason }` | moderator (feature, delete: admin) | dismiss, hide, unhide, unpublish, feature, unfeature, delete |
| `GET`/`PUT /api/admin/users/:id/map-limit` `{ max }` | admin | One account's map limit (`null` for the site's) |

## Code

| File | Does |
| --- | --- |
| `packages/sim/src/mapedit.ts` | New maps, corner-based shoreline painting, mirror and turn helpers. Shared with the server. |
| `packages/sim/src/mapcheck.ts` | `checkMap` (playability) and `parseMap` (untrusted JSON). Shared with the server. |
| `packages/client/src/editor/doc.ts` | The map being edited and its undo history. |
| `packages/client/src/editor/tools.ts` | What each tool does, with symmetry; copy, paste and Make Symmetric. |
| `packages/client/src/editor/canvas.ts` | The map view (the game's renderer plus overlays) and the minimap. |
| `packages/client/src/editor/tiles.ts` | Learns from the game data: tile colours, which tile each becomes when mirrored, the building palette. |
| `packages/client/src/editor/main.ts` | The page: menus, tools, panels, keys, files, drafts and test play. |
| `packages/client/src/editor/library.ts` | Save to Library and the Shared Maps browser. |
| `packages/client/src/mappreview.ts` | Map previews for the Level Selector, the lobby's map picker, the lobby and Shared Maps. |
| `packages/server/src/library.ts` | The map library: tables, revisions, pictures, likes, reports, moderation, and the lobbies' map source. |
