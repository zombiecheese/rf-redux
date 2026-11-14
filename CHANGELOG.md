# Changelog

Each release's section below becomes its GitHub release notes (`.github/workflows/release.yml`). Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The modern view looks like a surveillance drone's feed: a slightly washed, cool picture with film grain, a soft lens rim and colour fringes, a rolling scan line, a burst of stream errors now and then (torn rows, broken and misplaced macroblocks, split colours), and an overlay with corner brackets, the clock, REC and altitude and grid read-outs. Options > Camera switches it to a clean picture.
- A thermal camera for the modern view (Options > Thermal, the I key, or the IR button beside the menu button): a white-hot picture where vehicles, soldiers and drones run hot, wrecks warm, buildings and ground cool and the sea cold, so it sees through the dark.

- An online lobby's owner can set the visuals (classic or modern) and the lighting (day or night) for every player, or leave both to each player's own Options.

### Changed

- The modern HUD reads as a machine-vision analysis of the feed instead of panels: tracking boxes with a label, a confidence and their integrity on the player's vehicle (with its fuel and ammunition beside it), friendly vehicles, and the opponents' vehicles, gun towers, flag buildings, revealed flags and drones; the radar is a tactical plot of the coastline with contact marks.
- Each vehicle has its own lights at night, dimmer than before: the jeep's warm headlamps, the tank's wide work lights, the ASV's long blue-white beam and the helicopter's searchlight.
- Night in the modern view is much darker: a faint moon, a black sky and dark water, so the headlights, fires and lit buildings are most of the light.

## [0.3.0] - 2026-11-14

The modern view: the game in 3D, with its own hardcore and metalcore soundtrack.

### Added

- Modern visuals (Options > Visuals): the game in 3D at 1280 × 720 with toy-soldier models, sunlight and shadows, an animated sea, explosions, smoke and debris, and a modern HUD. Retro stays the default and either can be picked at any time, even during a match. The modern view has its own 3D bunker, laughing skull, messages, chat and scoreboard, and Options > Lighting adds a night mode with headlights and lit buildings (street lamps, watchtowers, windows).
- The modern view has its own soundtrack: original hardcore, beatdown and metalcore instrumentals for every moment the band covers (each vehicle, the bunker, deaths, the flag, the win and the menus), played on the built-in synthesiser's new guitar amp, bass and metal kit. Retro keeps the band.
- Options > Instruments plays the retro band from real instrument samples: the GeneralUser GS SoundFont by S. Christian Collins, shipped in the Docker image. Built-in stays the default; the 32 MB SoundFont downloads the first time Sampled is picked and the browser keeps it.
- Tap or click a bay on the lift screen to pick that vehicle, and again to launch it (retro and modern).
- A [wiki](https://github.com/zombiecheese/rf-redux/wiki) for players and hosts: installing, deploying, running a site, how to play, the rules, online play, the level editor and troubleshooting, with screenshots.
- The jeep's tyres are seen to blow up and go down: over about two seconds the wheels lean out and flatten, the fat tyres show under the body, and a floating jeep sits in rings of ripples and leaves a trail behind it.
- The tank, jeep and ASV leave a wake of spray in water once going at half their top speed there.

### Fixed

- A jeep floats at its slow floating speed only once its tyres are full, as in the original; while they fill it still wades.
- Links to files in the repository now work in a release's notes.
- Level editor: a map opened straight after the editor starts is now drawn. The view kept showing the empty map until the first edit.

## [0.2.0] - 2026-11-14

The first release: a browser remake of Return Fire (1995) that plays like the original, with online multiplayer, computer opponents, accounts, a level editor and an admin panel. It is complete in itself and runs from one container image.

### The game

- The original's look, handling and rules: a software renderer draws its 320 × 240 tilted 3D view, and the simulation follows the original's fixed-point maths, so the tank, jeep, ASV and helicopter drive, fight and sound as they did.
- Capture the flag for one to four bases. A base is out when an enemy jeep takes its flag home or it has no jeeps left, and the last team standing wins. A flag counts at any base on the jeep's team that is still in the match.
- Training against the computer in one full-screen view, and Two Players on one keyboard in split screen. Maps with three or four bases ask for the team layout (2v2, 2v1v1, 3v1 and so on, or everyone for themselves), and the computer plays every base without a player.
- 104 two-player maps and sixteen mirror-symmetric maps for three and four bases.
- Computer opponents at nine difficulty levels that attack, defend their flag, lay mines and go home to repair.
- An optional handicap for uneven matches: the smaller side starts with more vehicles in proportion, and its flag must be captured more than once (three times for one base against two).
- The project's own art pack: every sprite, the cockpit panels, 35 sound effects, the title art, a win scene with fireworks, and MIDI music from public-domain pieces.
- The front end: splash, title menu, Player Selector, Level Selector with map previews, Hall of Fame, pause screen, key rebinding, volume sliders, a subtle CRT look and match replays with speed control.
- Phones and tablets: the picture scales to the screen in landscape, with a touch overlay that follows the vehicle being driven.

### Online

- Lockstep multiplayer for one to four players, with bots in any open seat.
- Accounts, lobbies open to anyone or private behind a code or invite link, quick match, a friends list, and chat in every lobby and game to everyone, a team or one player.
- Profiles, stats, a ladder, and leaderboards of the fastest solo wins on every built-in map, each checked by replaying the run on the server.
- A web level editor with playability checks and test play, and a map library where maps are kept private, unlisted or public.
- An admin panel for the site owner: players, lobbies and games, chat, maps, reports and site settings.

### Running it

- A Docker Compose stack with one image, `ghcr.io/zombiecheese/rf-redux`, published for every version tag together with a compose file, an `.env` template and a Caddyfile for HTTPS ([docs/deploy.md](docs/deploy.md)).

[Unreleased]: https://github.com/zombiecheese/rf-redux/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.3.0
[0.2.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.2.0
