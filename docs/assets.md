# The game's assets

Return Fire: Redux is complete in itself. Everything it draws, plays and loads is in the repository, in the **art
pack** (`assets/art/pack/`), and nothing is imported from a copy of the original game.

| In the pack | What it is | Made from |
| --- | --- | --- |
| `sprites/atlas-N.png`, `sprites/frames.json` | Every sprite the game draws, by cel number | `tools/art/sets/` (drawn in code), `assets/art/cels/` (drawn by hand) |
| `buildings.json`, `vehicles.json`, `effects.json`, `shore.json` | The models and number tables | `tools/art/models/` |
| `sound/NAME.wav` | The 35 sound effects | `tools/art/sounds.mjs` |
| `screens/NAME.png` | The cockpit panels and the split screen's post | `tools/art/screens.mjs` |
| `maps/index.json`, `maps/rfmapNNN.json` | The 104 two-player maps, in [the map format](map-format.md) | Kept as files |
| `art.json` | What the pack holds | |

`npm run art` (`tools/build-art.mjs`) builds everything in the pack except `maps/`, which it leaves alone. Commit
the pack with the change that produced it: a test fails when it is out of date (`node tools/build-art.mjs --check`).
The dev server serves the pack from `assets/`, and a build copies it into the client (`/art/pack/`), so the Docker
image carries it. The game server reads its maps and tables from the same copy.

The music is not in the pack: its pieces are written in code in the client ([music.md](music.md)). Nor are the
title art, splash, logo and favicon ([below](#the-title-art-splash-logo-and-favicon)).

## What comes from the original

Two things in the pack are the original game's. Nothing else from the
original (its files, anything converted from them, or decompiler output) may be committed.

- **Its measurements**: the model shapes and number tables in `tools/art/models/`,
  entered as code so that play stays like for like.
- **Its 104 two-player map layouts**, with their names and authors, in
  `assets/art/pack/maps/`. These are the original designers' work. The 3- and
  4-base maps are made from them ([map-format.md](map-format.md#built-in-3--and-4-base-maps)).

Every sprite, sound and picture is made for this project, with nothing taken from the original's files.

## Sprites

A sprite can be drawn in code, in a file under `tools/art/sets/` that exports `draw(put)` and hands over each
sprite with `put(cel, image, { mode })`, or by hand, as `assets/art/cels/N.png` (an 8-bit PNG; see-through pixels
become the one transparent colour). A hand-drawn sprite wins over one drawn in code. `tools/art/png.mjs` has the
image, colour and PNG helpers.

A sprite keeps the size the models and the cockpit expect, since models stretch a sprite over their faces and the
cockpit lays its parts out by size. A side's Brown and Green sprites differ only in the uniform's colours, which
is what the Blue and Red repaint for bases 3 and 4 relies on.

The sets:

- `ground.mjs`: the 91 terrain tiles maps use (sand, water, shores, the steps to deep water and dark sand, grass
  and its edges, roads, bridge ends, the two bunker hatches and the walled lawn).
- `soldiers.mjs`: the foot soldiers (ten frames in five directions for each side, 25 swimming frames a side)
  and the six splats. A side's sprites differ only in the uniform's colours, which is what the Blue and Red
  repaint relies on.
- `scenery.mjs`: the other ground tiles (joints, pads, slabs, rubble, planted and ruined lawns) and the sprites
  on the plant, rock and bridge models (bushes, palms, trees, branches, rocks, bridge decks and broken stubs).
  The shadow masks among those numbers are in `shadows.mjs`.
- `tank.mjs`: the tank's model faces (hull top and belly, track sides, turret plates, gun, muzzle), its shadow
  and wreck. `tools/art/kit.mjs` holds what the vehicle sets share: the sides' paint, steel, and `inSets`,
  which draws a part in Brown, Green and the half-size gold set.
- `asv.mjs` and `jeep.mjs`: the armoured support vehicle and the jeep, face by face like the tank (the jeep
  with its driver and five frames of turning wheels).
- `aircraft.mjs` and `submarine.mjs`: the helicopter and attack drone (faces, rotors still and spinning,
  shadows, the helicopter's wreck) and the submarine's 25 surfacing frames.
- `wakes.mjs`: what vehicles leave in water: the tank's, jeep's and ASV's wakes (13 frames each), and the
  floating jeep's blown-up tyres from above, their ripples and the trail behind them (18 frames each).
- The buildings, wall by wall as their models wear them, each with its damaged and destroyed looks:
  `fort.mjs` (gun towers and turrets, walls, gates), `camp.mjs` (prison block, watchtower, tents), `town.mjs`
  (houses and the hospital), `works.mjs` (factories and the outpost, the fuel tank, the ammunition shed) and
  `base.mjs` (the flag building and the bunker). `tools/art/masonry.mjs` holds what they share: a small
  canvas to draw on, concrete, `dim` for a wall on a model's shaded side, and rubble.
- `effects.mjs`: the shots (shell, missile, big shell, tracer, exhaust flames) and all 38 runs of explosion
  frames (blasts, fires, smoke, dust, splashes and ripples, 600 frames). A run is drawn frame by frame from a
  few numbers (its flash, fireball and smoke, and where the smoke drifts) and keeps the length of the run it
  replaces, so the game's timing is unchanged.
- `cockpit.mjs`: the four vehicles' consoles (drawn around the places `hud.ts` puts the gauges, radar and
  lights), the radar's pips, the helicopter's warning lights, the jeep's grenades, and the bunker screen's
  frame, pad, vehicle icons and digits. The pad shows two buttons, an arrow box and a globe box.
- `bunker.mjs`: the bunker screen behind the frame: the shaft and its bays, the lift and its door, the dirt,
  the horizon and clouds, the running lights and the parked vehicles.
- `skull.mjs`: the laughing skull's seven faces in both helmets.
- `shadows.mjs`: the shapes the renderer darkens or brightens the screen with: the shadows of the plants, the
  buildings (each one its footprint swept up and to the right by about its height), the soldiers and the shots,
  and the two lights (the storage yard's and the bunker's spotlight). Each names its own draw mode.
- `lift.mjs`: the bunker lift's doors, platform, shaft walls and hazard lip, cut from the hatch tile's drawing.

## Models and number tables

`tools/art/models/` holds them as code, and `npm run art` writes them out as `buildings.json`, `vehicles.json`,
`effects.json` and `shore.json`. The client and the server both read them, so every player in a match uses the same.

- `vehicles.mjs`: the tank, ASV, jeep, helicopter, drone and shots, each a list of flat faces with the sprite
  each wears and the order to draw them in from each side.
- `buildings.mjs`: the 91 buildings: their models, the shapes vehicles and shots collide with, hit points, the
  ground they stand on, what a destroyed one becomes and the explosion that brings it down. The faces that fly
  off as debris are worked out from the models.
- `effects.mjs`: the explosions (their sprites, timing and scripts), how debris is flung, and which explosion
  goes with which shot, vehicle and splash.
- `shore.mjs`: the shoreline outlines.
- `kit.mjs`: what they share (`q` for a face, `model`, `box`, `building`).

## Sounds

`tools/art/sounds.mjs` works each of the 35 effects out sample by sample from tones, noise and filters. Nothing is
recorded. `npm run art` writes them to `sound/NAME.wav` as 8-bit mono WAV at 11025 Hz. It uses plain arithmetic
only, so the files are the same on every machine. The tank and jeep engines are made for the slower speed the game
plays them at.

## Cockpit pictures

`tools/art/screens.mjs` draws the cockpit panel for one view and for two, and the post between two views. Each
console sits in a bay of the panel at the place the game draws it (`hud.ts`).

## Reviewing the art

- `npm run art-sheet` draws a review sheet of the pack's sprites, enlarged and numbered (`-- --cels 0-93,655-670`
  picks the sprites, `-- --scale 6` enlarges more, `-- --assets <folder>` sets each beside the sprite of the same
  number in another pack). Sheets go to `assets/generated/art-sheets/`, which is git-ignored.
- Help > System Info in the game shows the version and how many of the pack's sprites are in use.

### The asset inventory

`npm run asset-inventory` lists what the game actually uses from the pack:

- every sprite drawn, with its size and what uses it: it follows each building, vehicle, shot and effect model and
  each explosion to their cels, and adds the cels the client's code asks for by number (`tools/code-cels.mjs`, kept in
  step with the constants in `view.ts`, `hud.ts`, `bunker.ts`, `skull.ts` and `variety.ts`);
- sprites in the pack that are never drawn, and sprites the game asks for that the pack lacks;
- the sounds and cockpit pictures, and whether each is present.

It writes `inventory.md` (a table, runs of like cels on one row) and `inventory.json` into `assets/generated/`,
which is git-ignored.

## Optional extras

The server also serves a folder of your own at `/generated/` (`assets/generated/` in a checkout, `ASSETS_DIR` in a
deployment; git-ignored). The game looks there for two things, and needs neither:

- `music/soundfont.sf2`, a General MIDI SoundFont for Options > Sound and Music > Instruments > Sampled (the Docker image ships GeneralUser GS here; `npm run soundfont` fetches it for a checkout);
- `music/<name>.mid`, to replace a piece, and `music/modern-<name>.mid` for the modern soundtrack ([music.md](music.md)).

The server lists what is there at `/generated/extras.json`, and the game asks only for files on that list, so an
empty folder causes no failed requests.

A file there is also used in place of a pack file of the same path that is missing, and `?art=0` in the address
draws sprites from that folder alone. Both only matter to someone comparing packs.

## The title art, splash, logo and favicon

All drawn by code, with nothing from the original, and committed with the client:

- The title art (`packages/client/src/title/title-art.png`, 480 × 270 in 160 colours): the four sides in their
  colours (a Brown tank, a Blue helicopter, a Red jeep with Green's flag and a Green ASV) fighting in front of a
  fortress. `tools/title-art/` draws it with a small software renderer plus painted effects. To draw it again after
  changing `scene.js`, run `node tools/title-art/render.mjs` (needs Playwright with Chromium, and Python with
  Pillow).
- The Zombiecheese Productions splash before the title (`packages/client/src/splash.ts`, 480 × 270), animated as it
  plays: ZOMBIE climbs out of the ground in rotting flesh and drips blood and ooze onto CHEESE, which is mouldy, holed
  and stinking, with flies. Its fanfare is `fanfare` in the band book ([music.md](music.md)).
- The Return Fire: Redux logo heading the main menu (`packages/client/src/logo.ts`, 160 × 90): RETURN in chrome over
  FIRE in molten metal, with spreading-heat flames behind them, and REDUX in sand paint on a riveted olive-drab plate
  under FIRE.
- The favicon (`packages/client/favicon.svg`, 32 × 32), drawn by `favicon()` in `logo.ts` and written out by
  `node --experimental-transform-types tools/favicon/render.mjs`. It is committed, so run that only after changing it.

The shared drawing helpers (pixel buffer, noise, dithering, the two bitmap fonts) are in `packages/client/src/pixelart.ts`.
