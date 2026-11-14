# Changelog

Each release's section below becomes its GitHub release notes (`.github/workflows/release.yml`). Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Guide arrows at the edges of the modern view, in each rival base's colour, point to where its flag may be: every standing flag building of a rival (without giving away which one hides it), a flag lying in the open, and the way home while your jeep carries one, each with its distance.
- A player whose base is out can switch between the players still in the match, in the classic and modern views, offline (including each half of Two Players) and online: the turn keys step through them (fire steps on), the launch keys or 1–4 pick one, and on a phone or tablet P1–P4 at the top. The view starts on a teammate who is still playing, or else anyone still in, and the game says how to switch when you go out. Online spectators can step through the players with ← / → as well as 1–4.
- The modern view's own end of the match: the drone's last pass over the winner's base, climbing as fireworks go up in the winner's colour, while the computer vision locks onto the base and types out its assessment (the winner, bases neutralised, engagement time), then the stream breaks up and cuts to SIGNAL LOST. It keeps the match's look (drone feed or clean, thermal, day or night).

### Changed

- The modern view is always the drone's feed and the retro view always has its CRT look: they are what each view is, so Options no longer has Camera or CRT Look. The thermal camera is part of playing, not a setting, and only for the dark: in a night match it is switched by its key or the THERMAL button (which only shows at night), every match starts with it off, and it has left Options.
- The modern view's night lights are less clean: headlights and searchlights carry blotches, grime, scratches and faint reflector rings that travel with the beam, and lamps and fires throw the soft bars of their cages, smudges and a flicker.
- The thermal camera is a control: G (left hand) or I (right hand), listed and rebindable in Options > Controls and in Help. An always-visible THERMAL toggle beside the menu button shows whether it is on and its key.
- Over a modern match the menu and thermal buttons take the computer vision's look, and the drone overlay's corner bracket and the note chip move out of their way.
- Every message to the player over a modern match shows as a computer-vision read-out (monospace, framed, tagged STATUS, EVENT, COMMS, SCORES, ANALYSIS or SYS): the view's note, the match log, chat, the scoreboard, banners and pop-up messages such as the thermal camera's on and off, which now sit under the clock, clear of the plot.

### Fixed

- Replays play back as their match was seen (classic or modern, day or night), whatever the viewer's own Options say; the replay records it. Older replays play the viewer's way.
- Turning the thermal camera on or off (or changing any other option) during an online match whose host set the visuals no longer swaps the soundtrack to the player's own.

### Changed

- Help Topics (H) is rewritten for the game as it is now, in pages: How to Play (the goal, each vehicle's buttons, game types, computer skill), Keys (every key, and the touch controls), Views (classic and modern, the drone feed, the computer-vision HUD, flag arrows, day and night, the thermal camera, and the host's choice online), Online, and More (replays, the level editor, sound and music, settings).
- About says what the game is today: its version, that it needs no copy of the original and imports nothing, what comes from the original (its measurements and the 104 two-player map layouts), the music and the SoundFont's credit, and a link to the source.
- System Info shows the version, whether a game server and an account are there, the view in use and whether this browser can show the modern view, and whether sampled instruments are on offer.

### Removed

- The jukebox, with its player for single pieces and its loader for a SoundFont file of your own. Sampled instruments still play the site's SoundFont.

## [0.4.0] - 2026-11-14

The modern view as a drone feed, with a thermal camera and vehicle lights.

### Added

- The modern view looks like a surveillance drone's feed: a slightly washed, cool picture with film grain, a soft lens rim and colour fringes, a rolling scan line, stream errors when something is destroyed nearby, much stronger when your own vehicle is hit (torn rows, broken and misplaced macroblocks, split colours), and an overlay with corner brackets, the clock, REC and altitude and grid read-outs. Options > Camera switches it to a clean picture.
- A thermal camera for the modern view (Options > Thermal, the I key, or the IR button beside the menu button): a white-hot picture where vehicles, soldiers and drones run hot, wrecks warm, buildings and ground cool and the sea cold, so it sees through the dark.
- Starting a game offline (Training or Two Players) picks the view, Classic or Modern, on the Player Selector, each with a preview of it in play; Options > Visuals still switches it at any time.
- An online lobby's owner can set the visuals (classic or modern) and the lighting (day or night) for every player, or leave both to each player's own Options. The lobby's Visuals choices show the same previews.

### Changed

- The modern HUD reads as a machine-vision analysis of the feed instead of panels: tracking boxes with a label, a confidence and their integrity on the player's vehicle (with its fuel and ammunition beside it), friendly vehicles, and the opponents' vehicles, gun towers, flag buildings, revealed flags and drones; the radar is a tactical plot of the coastline with contact marks. The boxes run 3 to 5 frames behind the picture, as if still being processed.
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

[Unreleased]: https://github.com/zombiecheese/rf-redux/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.4.0
[0.3.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.3.0
[0.2.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.2.0
