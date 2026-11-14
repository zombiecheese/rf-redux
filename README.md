# Return Fire: Redux

*Return Fire: Redux* is a browser remake of *Return Fire* (Silent Software, 1995/96), the capture-the-flag game where you drive a jeep, tank, armoured support vehicle (ASV) and helicopter out of an underground bunker to find the enemy's flag and bring it home.

The aim is a like-for-like remake: the same look (a software renderer reproduces the original's 320 × 240 tilted 3D view), the same handling and the same rules, traced from the original Windows 95 release. On top of that it adds online play for 1–4 players, computer opponents, accounts and lobbies, chat, a web level editor, and an optional modern 3D view with its own hardcore and metalcore soundtrack.

> **About the original.** The game runs on its own art, sounds and pictures, with no copy of the original needed. Two things in the repository come from the original: its measurements (model shapes and number tables) and its 104 two-player map layouts, which are the original designers' work.

## Status

The latest release is [v0.5.1](https://github.com/zombiecheese/rf-redux/releases/tag/v0.5.1) (2026-11-14); what changed in each release, and what is waiting for the next one, is in [CHANGELOG.md](CHANGELOG.md). Version 1.0.0 is kept for when the game no longer uses anything from the original.

Still to come: two-player maps of the project's own.

## What is in the game

**Playing**

- Local Play: Training (you against the computer, one full-screen view) and Split Screen (two players on one keyboard, desktop only). On a map with three or four bases both ask for the team layout (2v2, 2v1v1, 3v1 and so on, or everyone for themselves), and the computer plays every base without a player.
- The 104 original two-player maps, and sixteen 3- and 4-base maps made from pieces of them on islands shaped like the originals', mirror-symmetric so every base gets the same layout ([docs/map-format.md](docs/map-format.md)).
- Capture the flag: a base is out when an enemy jeep takes its flag home or it has no jeeps left. Home is the jeep's own base or any teammate's still in the match. The last team standing wins, and a player whose base is out watches a teammate.
- An optional handicap, offline and in lobbies, helps the smaller side of an uneven match: extra vehicles in proportion, and a flag that must be captured three times (one base against two).
- The front end: the Zombiecheese Productions splash and fanfare, a title screen with the remake's own widescreen art under an on-screen menu (mouse, keyboard and touch), the Player Selector, the Level Selector by level 1–9 with a preview of each map, the Hall of Fame, the pause screen, and the end of the match over the winner's base under fireworks: in the classic view the camera rises over it, and in the modern view the drone makes a last pass while the computer vision types out its assessment before the feed cuts to SIGNAL LOST.

**The battlefield, as in the original**

- All four vehicles with the original's handling, fuel, ammunition and damage, launched and docked on the bunker lift with the original's animation and timings.
- The helicopter winds up and lifts off before it can be flown, flies with momentum, strafes, and lands on its lift to dock. Only anti-air fire reaches it in the air.
- Shots fly in 3D: each leaves its gun's muzzle and hits the first shape it meets at that height, so tank shells pass over rocks and men, and the tank and ASV can raise their fire at aircraft.
- Jeep grenades, ASV mines that arm, blink and blast, and random mines.
- Gun towers that wake, wait, track one target and hold fire while their own side is in the way, and attack drones that come for a vehicle sitting still for six seconds (from difficulty 4 up).
- Soldiers: buildings let their men out when nearly destroyed and prisons let out the other side's. Men run from vehicles, swim, throw grenades, and are run over or shot.
- Collision against the original's shapes: tanks drive over rocks and crush bushes and tents, jeeps go round them, gates slide open for their own side, and vehicles refuel and rearm on any depot's pad.
- Water: vehicles wade through shallows leaving a wake, sink in deep water, and the jeep can blow up its tyres
  to float (they take about two seconds to fill, and it floats at full speed once they are up).
- Wrecks run on, burn out and lie as marks. A vehicle out of fuel stops where it is and its driver runs. Losing a vehicle plays its death on the map, then the enemy's laughing skull over a row of that vehicle's lives.
- The original's HUD (fuel, ammunition and damage bars, radar), effects and sound mixing.

**Computer players**

- Difficulty 1–9 (default 5). Bots shell flag sites, clear the gun towers round an exposed flag before sending a jeep, float jeeps across water, hunt a jeep carrying their flag, use every weapon and go home to repair once per vehicle.
- With three or four sides each team of bots draws its target afresh every minute, so no base is always attacked first.
- Bots wait in their bunkers until every human player has launched a vehicle, or 45 seconds after the first did.

**Online** ([docs/online.md](docs/online.md))

- Matches for 1–4 players on 2–4 base maps, free-for-all or teams, with bots in empty seats and spectators. The server runs every match in deterministic lockstep, checks state hashes, repairs a game that drifts, holds a dropped player's seat for a minute and lets a bot drive until they are back.
- Accounts (online play needs one; solo and local play don't), profiles with stats, a ladder, and fastest-solo-win leaderboards checked by replaying each run on the server.
- Lobbies open to anyone or private behind a code or invite link, quick match, friends, and chat in every lobby and game to everyone, your team or one player, with mute, block and report.
- An admin panel in the game's menu for moderators, admins and the owner: players, roles, bans, running games, chat and map moderation, site settings and an audit log.

**Level editor** ([docs/level-editor.md](docs/level-editor.md))

- At `/editor.html` (Level Editor in the main menu, desktop browsers only): paint land and water with automatic coastlines, lay bridges, place buildings and up to four bases, mirror or turn edits for fair maps, check the map for problems and test play it against bots. A Preview switch shows the map as it is edited in the classic view, the modern view or the modern view at night.
- Maps save in the browser, export and import as `.rfw.json` files, and play from the Level Selector's Add-Ons. Signed in, they also save to your library as private, unlisted or public, with revisions; public maps can be searched, liked, reported and played in lobbies.

**Replays, options and music**

- Every match is recorded in the browser (the last 20, plus any you star) and plays back at ¼× to 8× with pause, ten-second jumps, a timeline and a choice of player to follow. Replays save as `.rfwreplay.json` files or, signed in, to your account.
- Options: rebind every vehicle key for either half of the keyboard, master, effects and music volume, built-in or sampled instruments for the band, the view (modern or classic), how the picture is scaled, and Swap Sides. Day or night is picked per match, not in Options. Names, settings and the Hall of Fame are kept in the browser, and settings follow a signed-in account.
- Music chosen the way the original's music director chose it, for each vehicle, the bunker, deaths, the flag, the win and the menus ([docs/music.md](docs/music.md)). The retro view plays MIDI band arrangements of public-domain music on an MT-32-style synthesiser, or, with Options > Sound and Music > Instruments > Sampled, from the GeneralUser GS SoundFont (a 32 MB download the first time, then kept by the browser). The modern view has its own soundtrack: original hardcore, beatdown and metalcore instrumentals, with a breakdown in every piece, played on the synthesiser's guitar amp, bass and metal kit. Switching the view switches the music at once.

**The picture, and phones and tablets**

- The 320 × 240 picture fills the browser at 4:3 with square pixels, with a subtle CRT look. The bars left over are pixel camouflage in the watching player's colour.
- The modern view is the default (Style on the main menu, or Options > View > Visuals, switches between it and the classic one at any time, even during a match, and swaps the title picture): the same game drawn in 3D at 1280 × 720 (16:9) with low-poly toy-soldier models, sunlight and shadows, an animated sea, glowing explosions, smoke and debris, and a HUD that reads like a machine-vision analysis of the feed: tracking boxes with integrity on vehicles, gun towers and flag buildings, your fuel and ammunition beside your own vehicle, and a tactical plot for the radar. The bunker is a 3D cutaway of the hill with the vehicles parked in their bays and the lift carrying them up, the skull is a 3D skull in the rival's helmet, and messages, chat and the scoreboard use the menus' style too. It has its own hardcore and metalcore soundtrack. Time of day (on the Player Selector, or the host's pick online) is day, or a dark night with headlights, glowing fire, and lit windows and lamps on the buildings. The picture is a surveillance drone's feed, and in a night match the THERMAL toggle beside the menu button (or its key, G or I, rebindable in Options > Controls > Vehicle Keys) switches to a white-hot thermal camera that sees in the dark; each match starts with it off, and by day there is none. Colour-coded arrows at the edges point to where each rival's flag may be. The camera follows and zooms as the retro one does, so both show the same part of the map across, and online the host picks retro or modern for every player. It needs WebGL; without it the game stays retro. `/modern-gallery.html` in the dev server shows every modern model.
- Phones and tablets play solo, in landscape, with on-screen controls ([Touch controls](#touch-controls)). Held upright they show a "turn your device sideways" notice and the match waits.

## Getting started

You need [Node.js 22](https://nodejs.org/) and nothing else: the art, sounds and maps are in the repository.

```sh
git clone https://github.com/zombiecheese/rf-redux.git
cd rf-redux
npm install
npm run dev
```

Then open http://localhost:5173. The Zombiecheese Productions splash plays first (press a key or tap to start it with sound, any key to skip it, or Esc to go straight to the title), then the title screen shows the menu; any key or tap brings it back after Esc. Local Play > Training (you against the computer, in one full-screen view) and Local Play > Split Screen (two players on one keyboard, split screen) open the Player Selector for names, the difficulty, the time of day and the view, then the Level Selector for the map; New Game (N) also lets you pick Training or Split Screen, starting on Training. Online play is under Online and is always one player per screen. One player always gets the single view: split screen only appears when two people pick Split Screen, and that choice is not remembered for the next visit. P pauses, Alt+R restarts, L shows the Hall of Fame, H shows every key and Esc leaves the game.

The level editor is at http://localhost:5173/editor.html. For online play (Online in the main menu), also run the game server: `npm run build -w @rfw/server && npm start` in a second terminal. See [docs/online.md](docs/online.md).

URL options: `?map=rfmap101` picks the map (`rfmap101`–`rfmap204`, or a 3- or 4-base map `tri01`–`tri08`, `quad01`–`quad08`), `?mode=solo` or `?mode=local2` skips the splash and menus and starts a match at once, `?bots=0` plays solo without a bot, `?difficulty=1`–`9` sets the difficulty (also in the Player Selector; default 5), `?seed=N` fixes the random seed, `?scale=integer` scales only by whole numbers (wider camo border, no smoothing at all).

### Controls

Help > Help Topics (H) in the game explains how to play, the classic and modern views, online play, replays, the level
editor and the music, and lists every key; the key list is built from the same table the game reads
(`packages/client/src/keys.ts`), so the two cannot disagree.

| | Player 1 (Brown) | Player 2 (Green, two-player mode) |
| --- | --- | --- |
| Drive | W A S D | Arrow keys |
| Fire / second button (jeep: float tyres in water; tank and ASV: fire raised at aircraft; helicopter: fire straight ahead) | Space / Left Shift | Enter / Right Shift |
| Third button (jeep: put down or pick up a flag; ASV: lay a mine; helicopter: swap gun and missiles) | F | / |
| Tank turret (both together centre it) | Q / E | [ / ] |
| Go back into the bunker (on your base) | R | Backspace |
| Launch jeep, tank, ASV, helicopter | 1 2 3 4, or drive keys and fire on the lift screen | 7 8 9 0 |
| Thermal camera on / off (modern view, at night) | G | I |

These are the original's keys; Options > Controls > Vehicle Keys rebinds any of them for either half (Help Topics always shows
the keys in use). A key the other half, a shortcut, chat or the menus use cannot be taken.
In one-player mode (Training, online, and the editor's test play) either half of the keyboard works. Swap Sides
(Alt+3, or Options > Controls > Swap Sides) gives player 1 the right-hand keys. The game is played with the keyboard, a mouse
for the menus, or touch on phones and tablets; there is no gamepad support.

| Shortcut | |
| --- | --- |
| H | Help Topics (System Info and About are under Help in the menu) |
| N | New Game |
| Alt+R | Restart |
| P | Pause / Resume (not online: a shared match never waits for one player) |
| Alt+Enter | Full Screen |
| L | Hall of Fame |
| M | Open the menu (or the ☰ button over a match; offline the match waits while it is open) |
| V | Sound off / on |
| Alt+3 | Swap Sides |
| Esc | Leave the game (any key skips the splash or the win scene) |
| T | Online: open the chat line (Tab picks everyone, your team or one player; Enter sends; Esc closes) |
| Tab (hold) | Online: the scoreboard |
| ← / → (or a half's turn keys), 1–4 | Out of the match, or spectating online: watch the next / previous player still in, or that player. Replays: 1–4 follow that player |
| - / = | Replay: slower / faster (¼× to 8×) |
| , / . | Replay: ten seconds back / on (P pauses, Alt+R starts it again, Esc leaves) |

In the menu: ↑ / ↓ (or Tab / Shift+Tab) move, Enter or Space picks, → opens a sub-menu, ← or Esc goes back, and Esc
on the first page closes it. A mouse or a finger works as well.

The game uses no function keys (laptops hide them behind Fn, and browsers keep F1, F3 and F5 for themselves). None of the shortcuts, chat or scoreboard keys is a key either player drives with (Alt+R and Alt+Enter need Alt, which the controls never use), so Enter fires online just as it
does offline. While the chat line or any text box has the keyboard the vehicle takes no keys, and while a dialog or
menu is open the match takes none either.

### Touch controls

Phones and tablets (a touch screen with no mouse, or any iPhone, iPad or Android device) get on-screen controls
during a match, drawn as faded pixel buttons. They play solo only: Split Screen and the level editor are not offered (`editor.html` shows a "Desktop only" notice).

| Control | What it does |
| --- | --- |
| Stick (left thumb, anywhere in the lower left) | Drive and turn; on the lift screen, pick a bay |
| Fire (right corner) | Fire; Launch on the lift screen |
| Tyres / Flag | Jeep: float the tyres; put down or pick up a flag |
| AA | Tank and ASV: fire raised at aircraft |
| Mine | ASV: lay a mine |
| Ahead / Swap | Helicopter: fire straight ahead; swap gun and missiles |
| ◀ ● ▶ | Tank: swing the turret, ● centres it. Helicopter: strafe (◀ ▶) |
| Jeep, Tank, ASV, Heli (top, lift screen) | Launch that vehicle |
| Dock (top, while driving) | Back into the bunker on your base |
| ❚❚ (top, offline) / ☰ (top left) | Pause / the menu |
| Chat, Scores (top, online) | Open the chat line (tap its label to pick who it goes to); show the scoreboard while held |
| P1–P4 (top, out of the match or spectating) | Watch that player |

Each control presses the left-hand key for its action, so rebinding in Options > Controls > Vehicle Keys carries over.

## Deploying

The game ships as a Docker Compose stack with one image, `web`, which is the whole game: the server, the client and the art pack. Nothing is imported when it starts. [docs/deploy.md](docs/deploy.md) has the full steps, both from a release's published image (no build) and from a checkout, plus HTTPS, backups, monitoring, every setting and how to cut a release. The short version, from a checkout:

1. Install [Docker](https://docs.docker.com/get-docker/) with Compose v2 on the host and clone this repository.
2. Copy `.env.example` to `.env` and set `RF_OWNER_NAME`, `RF_OWNER_EMAIL` and `RF_OWNER_PASSWORD`. They make the site owner's account, which can open the admin panel. Signing up never makes anyone the owner.
3. Run `docker compose up -d --build`.
4. Open http://your-host:8080 once `docker compose ps` shows `web` as healthy, and sign in with the owner account (Online, then Sign In).

The site serves the original's map layouts. Whether to open it to the internet is the owner's call; to keep it to yourself, put it behind a VPN, a firewall rule or an authenticating reverse proxy rather than opening port 8080.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Client dev server with hot reload, reading the art pack from `assets/art/pack/`; it passes `/api` and `/ws` to a game server on port 8080 |
| `npm run build -w @rfw/server && npm start` | The game server for online play while `npm run dev` runs (data in `data/`) |
| `npm run asset-inventory` | Lists every sprite, model, sound and picture the game uses from the art pack and what uses each, into `assets/generated/inventory.md` ([docs/assets.md](docs/assets.md#the-asset-inventory)) |
| `npm test` | Sim, protocol, client and server tests, all against the art pack. The client tests include picture tests: frames drawn by the real renderer are compared with kept pictures in `packages/client/test/pictures/` (`UPDATE_PICTURES=1` rewrites them after an intended change) |
| `npm run art` | Builds the art pack (`assets/art/pack`) from the code in `tools/art/` and the drawings in `assets/art/cels/`. Commit the pack with the change that produced it; a test fails when it is out of date |
| `npm run art-sheet` | Review sheets for the art pack: each sprite enlarged and numbered, written to `assets/generated/art-sheets/` (`-- --cels 0-93` picks sprites) |
| `AUDIT=ffa3,ffa4,2v2 SEEDS=60 npx vitest run packages/sim/test/bot-audit.test.ts` | Bot balance audit: bot-only matches on the test arena, with wins and first-out counts per base appended to `bot-audit.txt` in the temp folder (PowerShell: set `$env:AUDIT` and `$env:SEEDS` first) |
| `npm run soundfont` | Fetches the GeneralUser GS SoundFont to `assets/generated/music/` so Options > Sound and Music > Instruments > Sampled works with the dev server (the Docker image has it already) |
| `npm run typecheck` | Type-checks all four packages |
| `npm run build` / `npm start` | Production build, then serve it on port 8080 without Docker |

Rules that keep the project healthy:

- **No floats in sim state.** All game logic uses integer fixed-point maths so every machine stays in step.
- **No original material in git**, beyond two things: the original's measurements (model shapes and number tables) and its 104 two-player map layouts ([docs/assets.md](docs/assets.md#what-comes-from-the-original)). Never commit game files, anything else converted from them or decompiler output; `.gitignore` and `.dockerignore` block the usual file types.
- **Dependencies stay patched.** CI runs `npm audit` on every pull request and Dependabot (`.github/dependabot.yml`) opens update PRs for npm, the Docker image and GitHub Actions.

CI (`.github/workflows/ci.yml`) type-checks, tests, builds, audits and builds the Docker image on every pull request. Pushing a version tag runs `.github/workflows/release.yml`, which publishes the image and the GitHub release ([docs/deploy.md](docs/deploy.md#releasing)).

## How it is built

An npm workspaces monorepo in TypeScript. It is complete in itself: nothing is imported from a copy of the original.

| Path | What it is |
| --- | --- |
| `packages/sim` | The game rules: vehicles, weapons, buildings, flags, bots. Deterministic integer fixed-point maths that mirrors the original (tile = 2^21 units, pixel = 2^16, 64 headings), so the server and every client compute bit-identical results. Tested with Vitest. |
| `packages/net` | The multiplayer protocol shared by server and client: lockstep frames and their binary encoding, the JSON messages, team layouts and solo-run replays. |
| `packages/client` | The browser game (Vite). `raster.ts` is a software rasteriser that reproduces the original cel renderer at 320 × 240; the HUD, bunker screen, effects and sound sit on top. `src/modern/` is the optional 3D view (three.js), `src/music/` the music director, MIDI player, synthesiser and both soundtracks, `menu.ts` and `ui.css` are the on-screen menu and the look of every panel, `src/online/` is online play and the lobby, and `src/admin/` the admin panel. |
| `packages/server` | Node game server, bundled into one file: serves the client and assets, runs lockstep matches and bots, accounts (SQLite via `node:sqlite`), lobbies, chat, leaderboards and the admin API over HTTP and a WebSocket. |
| `tools/art/`, `assets/art/` | The art pack the game runs on: sprites, models and number tables, sounds, cockpit pictures and maps ([docs/assets.md](docs/assets.md)). `npm run art` builds it; `tools/art-sheet.mjs` and `tools/asset-inventory.mjs` help review it. |
| `tools/title-art/`, `tools/favicon/` | Draw the title art and the favicon from code ([docs/assets.md](docs/assets.md#the-title-art-splash-logo-and-favicon)). |
| `docker-compose.yml`, `docker-compose.images.yml` | The deployable stack, built from a checkout or run from a release's published images ([docs/deploy.md](docs/deploy.md)). |

## Documentation

| Document | Covers |
| --- | --- |
| [docs/assets.md](docs/assets.md) | The art pack: what is in it, how each part is made, and what still comes from the original |
| [docs/deploy.md](docs/deploy.md) | Running the Docker stack, the owner account, HTTPS, backups, settings and releasing |
| [docs/online.md](docs/online.md) | Online play, accounts, the admin panel and how lockstep works |
| [docs/level-editor.md](docs/level-editor.md) | The level editor, the map library and its API |
| [docs/map-format.md](docs/map-format.md) | The map file format, playability checks and how the 3- and 4-base maps are made |
| [docs/music.md](docs/music.md) | The music system, the band's pieces and why each is in the public domain, and the modern view's soundtrack |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [Wiki](https://github.com/zombiecheese/rf-redux/wiki) | The players' and hosts' guide: installing, deploying, how to play, the rules, online play and the level editor. Its pages are the files in `wiki/`, published by `.github/workflows/wiki.yml` |
