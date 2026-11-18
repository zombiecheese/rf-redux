# Changelog

Each release's section below becomes its GitHub release notes (`.github/workflows/release.yml`). Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Fifty achievements to earn: Missions (from your first finished match to 100 wins, beating skill-9 bots, a flawless win, a win in under five minutes, wins at night, on three- and four-base maps, on 10 different maps and on custom maps), Combat (kills by vehicle type, a kill from each vehicle, a tank taken out by a jeep, three and five kills in one sortie, stopping the jeep carrying your flag, attack drones and soldiers), Demolition (gun towers, buildings, a prison, a bridge, a fuel depot and flattened scenery), Flags, Vehicles (all four launched in one match, the jeep afloat, mines laid, lost to the submarine, sunk), Online (finishing, beating another player, winning alongside one, a ladder rating of 1100) and Extras (watching a replay, saving a map in the level editor, the thermal camera at night). Ten of them, the hardest, stay hidden until they are unlocked. Each has its own icon matching its goal (a trophy with its number of wins, a tank, a gun tower, a flag, an anchor...): thin line art in the modern view and chunky pixels in the classic view; a hidden one shows a padlock and a clue to how to earn it until it is unlocked. Title > Achievements and the pause menu list them with your progress, and each pops up as it is earned, styled for the modern and classic views.
- Achievements are kept in the browser for players who are not signed in and on the account for those who are; signing in moves a guest's progress to the account. Online matches are tallied by the server from its own run of the match, and only the server can award the online achievements.

## [0.9.0] - 2026-11-16

Every vehicle has its own night lights, the thermal camera burns in like a real sensor, and the modern view loads and runs smoother.

### Added

- Each vehicle has its own lights in the modern view. The jeep has twin headlamps (two pools of light side by side) and red tail lights that brighten as it brakes or backs up. The tank has dim hooded blackout lamps that light only the ground just ahead, and small convoy tail lamps. The ASV carries navigation lights (red to port, green to starboard, white masthead and stern) and a narrow searchlight that sweeps slowly across the water ahead. The helicopter has a searchlight under its nose whose hard-edged pool wanders over the ground below, red and green navigation lights on its stub wings, a white tail strobe and a red anti-collision beacon on its tail fin that flashes day and night. The small lights are glows drawn in a single batch, so they cost next to nothing; each vehicle still has just one real light for its beam.
- On the modern view's thermal camera (night matches), the picture is momentarily burnt into the screen and fades over about a second, like a real infrared sensor: as the camera moves, warm scenery smears behind it, and white-hot vehicles, soldiers and fires leave bright trails, soft and blurred as they fade. It starts fresh when the camera cuts or the thermal camera is switched on. The cool ground leaves none.

### Changed

- CI's dependency audit runs as `npm run audit` (tools/audit.mjs): it still fails on any advisory, apart from one listed there with its reason. The one today is the picomatch ReDoS advisory (GHSA-fc5q-39xc-vjpf), which has no fixed release yet and reaches only the build and test tools, never the server or the game.

- The modern view does less work every frame. Lights that are off (the blasts' flashes between blasts, and at night the headlights of vehicles not on the map) are no longer worked out for every pixel. The thermal camera no longer draws the sun's shadows or lights a picture it then replaces with heat. The map is no longer gone through tile by tile every frame to see what changed, and less garbage is made each frame for the browser to clear up.

### Fixed

- No more stutter in the modern view when a building is knocked down or a lift comes up. The shoreline and the ground's smaller copies (its mipmaps) are now worked out again only round the tiles that changed, not over the whole 4096 x 4096 ground.
- The loading screens no longer freeze while a match gets ready. Building the modern view's 3D world (painting the ground and putting up every block of buildings) is now done a little at a time between the loading screen's frames instead of in one go, the big textures go up to the graphics card one at a time, and the shaders are compiled in the background where the browser can (most desktop Chrome and Edge). The sprites are also unpacked without a round trip to the graphics card. Add `?stats=1` to the address to have the console report how long loading took and the longest the screen stood still.

## [0.8.1] - 2026-11-16

The touch stick on phones and tablets now steers by direction.

### Changed

- The touch stick on phones and tablets now steers by direction: point it the way you want to go on screen and the vehicle turns the short way round to face that way and drives there, turning on the spot first when the stick points well away from it. Let go and it coasts to a stop. This works for the jeep, tank, ASV and helicopter (which lets go of its turn early so it does not swing past). The stick still presses the same keys a keyboard player would, so online play and replays are unchanged. Keyboard controls are unchanged.

## [0.8.0] - 2026-11-16

Matches start together and never stop to load: everything is ready behind the loading screen, online waits for every player, and the match begins when the last player picks a vehicle. Also a free camera for replays, a Tilt-Shift switch, and a smoother lift and gates in the modern view.

### Added

- Replays have a free camera. Drag the picture (or use W A S D or the arrows) to look anywhere on the map, and zoom with the mouse wheel, Q / E, Page Up / Page Down or a two-finger pinch; C or the bar's Free camera button turns it on and off, and picking a player goes back to following them. It works while the replay is paused, so a moment can be looked round. The modern view zooms from about twice as close as the follow camera to the whole island; the classic view zooms out to a third of its size and in no closer than its own 1:1 pixels, which the original never went beyond.
- Options > View > Tilt-Shift turns the modern view's miniature focus blur on or off. It is on by default, each device's own setting (kept in this browser, never synced to the account, and not set by the host online), and applies at once, even mid-match. Low quality leaves the blur off whatever the switch says, to save the frame.
- The match starts when the last player picks a vehicle. With two or more people playing (split screen, or online with more than one human), each picks their first vehicle on the bunker screen, and nothing goes up the lifts until the last of them has; then every pick launches on the same tick and the bots set off too. A pick can be changed until then. The bunker says what is happening ("Tank ready: 1 more", or in the modern view "TANK LOCKED // AWAITING 1 OPERATOR"), and once someone has picked, the others have 30 seconds before the match starts anyway, so one player who has walked away cannot hold everyone up. Training (one player) is unchanged.
- Online, the match does not start until every human player has finished loading it. The loading screen gets a last step, Squad Sync / Waiting for the other players, which names who is still loading. A player who never finishes is waited for up to 90 seconds (was 15).

### Changed

- Modern view: the bunker lift on the map moves smoothly. The platform eases away from rest and settles into its stop (over the same time as before), and is drawn between game ticks, so it glides at any frame rate. The hatch's two doors meet in the middle and slide away under the ground beside the shaft, instead of lying on the ground beside the hole and vanishing. Amber beacons flash at the shaft's corners while it moves, dust puffs out as the hatch opens and as the lift locks at the top, and a vehicle dips on its springs as it rolls off. The platform's deck now sits flush with the ground at the top. You also hear the hatch's motors and the clunk of the lift locking.
- Modern view: base gates are fixed and open smoothly. Their posts stand at the edges of the road, where the original has them, instead of one in the middle of it, and the two barred leaves slide back into the posts (eased, and between ticks) instead of being squashed. Beacons on the posts blink while a gate moves.
- Everything a match can need is now loaded and made ready behind the loading screen, so the match never stops mid-play to load something. The sound effects are decoded, every piece of the soundtrack is prepared (and the SoundFont's samples it uses, with sampled instruments), and in the modern view the 3D world, both bunker and skull screens, every vehicle in every side's colours, their shots, mines, wrecks, soldiers, drones and flags, the explosions and the night and thermal looks are all built and their shaders made before the first picture. The loading screen lists the new steps (Audio Bank, Drone Feed, Shader Cache). This covers matches, replays and online matches, in both views.

## [0.7.2] - 2026-11-16

Themed loading screens, a fixed modern vehicle select, and no more pauses when blasts bring things down.

### Added

- Loading screens in the look of the match about to start. Modern: the drone feed linking up over a blurred last picture, with the link's progress, a mission card (map, kind of match, day or night), a log of what has loaded and an intel tip; it carries on as the modern view's link-up until the 3D picture is ready. Classic: the burning pixel logo, the map and match, a bar of blocks, the step under way and a tip, under the CRT. Shown for matches, replays and online matches, in place of the plain "Loading..." text.

### Fixed

- The modern vehicle select (the bunker's security camera) no longer shows as a grey-white sheet at night, and its daytime picture is no longer greyed over. Its washed-out colour and night infrared are now part of the 3D picture rather than drawn on the see-through layer above it.
- Modern view: the picture no longer stops for a moment when a blast brings down a building, tree or bush. Each one rebuilt the 3D models of its whole 8 x 8 tile patch of the map, a frame of 30-100 ms; now only the tile that changed is swapped, a few milliseconds.
- Modern view: the first scorch mark of a match no longer stalls the picture while its shader is made. The effects are now made ready early in the match with the lights the picture really has.

## [0.7.1] - 2026-11-16

Phones and tablets now always play full screen and in landscape, and get their on-screen controls reliably.

### Added

- Phones and tablets play full screen. Before the title screen, after the "turn your device sideways" notice, a "tap to play full screen" notice asks for one tap; full screen then locks the game in landscape where the browser allows it. If the player leaves full screen later, the notice comes back and an offline match waits until they tap it. The Full Screen menu item is gone on phones and tablets, since they are always full screen.
- Return Fire: Redux can be added to a phone's home screen and opens from there full screen in landscape. iPhone Safari cannot put a page full screen, so on an iPhone the game asks for landscape only and the title screen says once how to add it to the home screen.

### Fixed

- Phones never went full screen: the game asked as the finger landed, which a phone's browser refuses. It now asks when the tap ends.
- Phones with a stylus, or a browser set to show the desktop site, are now taken for phones, so they get the on-screen touch controls (and landscape, full screen and no split screen). Computers, touch-screen laptops included, never show the controls.

## [0.7.0] - 2026-11-15

The modern view's battlefield becomes a real back garden, from photo scans, with moulded plastic buildings and plants, and buildings and wrecks that melt into puddles, and it runs faster: Auto quality presets, dynamic resolution that holds the frame rate, a HUD that stays sharp on any screen, and no stutter the first time a vehicle is destroyed.

### Added

- Options > View > Quality for the modern view: Auto, Low, Medium, High or Ultra, each player's own (even online, since it is about the device, not the match) and kept in this browser. The presets change what a frame costs, never the look: the 3D picture's resolution (60% of 720p on Low up to the screen's own on High and Ultra), the sun's shadow map, which headlights throw shadows, the tilt-shift focus and how much of the garden's scatter is drawn. Auto starts on High (Medium on phones and tablets), steps down if the device can't keep up, and remembers what it found. Dynamic resolution then holds 60 frames a second (30 on phones and tablets) by drawing the 3D picture a little smaller while the device falls behind; the HUD stays sharp at the screen's own resolution.
- `?stats=1` shows a frame-stats panel for tuning the modern view on a real device: frame rate and the worst 1% of frames, draw calls, triangles, data sent to the graphics card, and the graphics card's time for the scene, the drone feed and the bunker or skull screens (where the browser can measure it). Copy puts a one-line report on the clipboard.

### Changed

- The modern view's picture goes straight onto the page instead of being copied twice a frame through 2D canvases, and its HUD (the machine-vision boxes, read-outs, tactical plot, messages and bunker panels) is drawn on its own layer at the screen's own resolution, so its text stays sharp on large screens and phones.
- The modern view runs lighter: by day the headlights are out of the scene entirely, so every lit pixel no longer pays for four unlit spotlights, their shadow maps and their beams' grain; when a building is destroyed only the changed rows of the ground, its photo splat and the lamp map go up to the graphics card (it used to re-send the whole 64 MB ground texture, a visible stall on phones); and finding which patches of buildings changed no longer builds 256 strings a frame.
- The modern view's ground is a real garden, from photo scans: sand with beds of soil and patches of gravel, wet sand along the sea, and lawn, at the scale of the toys standing on it. The scans are CC0 from Poly Haven and credited in About. Roads, pads and stripes keep their original painted look.
- The modern drone feed has a tilt-shift focus: a band across the middle of the picture is sharp and it goes soft toward the top and bottom, as a lens this close to something this small would see it, so the battlefield reads as a miniature. Thermal stays sharp.
- The modern view's buildings, gun towers, walls, gates and flags are moulded plastic playset pieces, with rounded edges and the toys' plastic sheen. A building that's destroyed melts: it slumps into a scorched puddle of plastic with a little of its colour left. Burnt-out vehicle wrecks melt the same way.
- The modern view's trees, palms, bushes and cacti are moulded plastic playset plants, like the toys. Rocks are real stone, lumpy and photo-scanned, with grit scattered around them. The toys' plastic reflects a photographed garden by day and a lamplit park at night. The photos are CC0 from Poly Haven and credited in About.
- The modern view's garden has small things scattered on the ground, at the toys' scale: sun-bleached pebbles, tufts of grass, dry leaves and twigs, lying in drifts where the ground suits them and never on roads, in water or under buildings.
- The modern view's things sit on the ground: the ground darkens close round each building's foot, by how tall it stands, and every model darkens toward its base (ambient occlusion, worked out ahead so it costs nothing a frame).
- The modern view's fire and smoke billow: each flame and puff plays a flipbook as it lives, from a tight knot to a torn wisp, with burning wrecks sending up thick, sooty smoke lit grey on top. Debris from a blast is glossy shards of broken plastic.
- The modern view's floodlights are solar garden lamps on black stakes, glowing a soft cool white under their little panels, and the house porch lamps are dimmer, so a base at night reads as a back garden rather than a floodlit yard.

### Fixed

- The modern view no longer stutters the first time a vehicle is destroyed: the skull screen, the explosion's effects and each side's melted wrecks are made ready early in the match, one piece a frame, mostly while the bunker shows.

## [0.6.0] - 2026-11-15

A friendlier game around the matches: menus dressed for the view you play in, open online lobbies strangers can join, phones that fit, an Esc pause menu, one Match Setup screen, a results screen with Rematch and the replay, a Hall of Fame for every side, and the modern view's toys in moulded plastic in a bunker dug into real earth.

### Changed

- The modern view's toys are moulded plastic, like a box of army men: each side's vehicles and soldiers are moulded all in its own colour, with rounded edges, the fine grain of moulded plastic, a glossy coat that catches the sky and the sun, matte black rubber tyres, clear canopies and printed white stars. Detail that would be black on a painted model (tracks, guns, rotor blades, seats, the soldiers' trousers, helmets and rifles) is a deep shade of the side's colour. The soldiers stand on little moulded bases. The bunker's parked vehicles and the skull screen's lives match.
- The modern vehicle select's bunker is dug into real-looking earth: dark topsoil with roots under the grass, wavy bands of brown and red clay, crumbs, grit and stones set into the cut face. The camera looks at it from an angle instead of straight on.
- The modern view's sun is a warmer, lower afternoon sun that casts longer shadows, the drone feed keeps more of the colour, and bright highlights bloom a little on its lens.
- The menus, dialogs and lobby are dressed to match the view you play in. Classic gets hard-edged olive panels with pixel-wide bevels and hard shadows, lettered in the game's own pixel font. Modern gets the drone's hardware look: dark screens with corner brackets and scan lines, thin frames, monospace read-outs, amber for what is picked, and tags like the computer vision's. The layouts are unchanged, and the level editor keeps its plain panels.
- A new online lobby's empty seats start open, so it shows in Find a Game with room and a Join button, and Quick Match can fill it. The computer plays any seat still open when the host starts, so hosting alone still works; a closed seat leaves its base out.
- The lobby's Teams picker shows the layout the seats are in (the one picked in Host a Game to begin with), or Custom once a seat is moved to another team.
- Find a Game says how many open seats a lobby has, and the host's footer says when the computer will play open seats instead of "Everyone is ready" with nobody else there.
- Phones held sideways: the title menu fits with nothing overlapping (the logo shrinks, the hints give way), and a dialog's buttons (Create Lobby, OK, Cancel...) sit in a bar that stays in view while the rest scrolls, on every screen size.
- On a phone or tablet the modern view's HUD text is drawn larger so it can be read, the tactical plot moves to the top right clear of the turret and weapon buttons, messages, notes and chat start below the buttons along the top, and in the bunker the link read-out moves left, clear of Launch.
- Esc in a match opens the pause menu (Resume, Restart, New Game, Options, Hall of Fame, Help, Leave Match) instead of asking whether to quit. Offline the match pauses behind it; online it keeps running, and Leave Match hands your seat to the computer.
- Pausing holds the match's last frame under a pause card instead of a blank screen: FEED PAUSED over the frozen drone feed in the modern view, a pixel PAUSED panel in the classic one, with the keys to resume or open the menu.
- Local matches are set up on one screen, Match Setup, laid out like an online lobby: the map by level with its preview on the left, and the names, difficulty, time of day, teams (on a map with three or four bases) and view on the right. It replaces the Player Selector, the Level Selector and the separate Teams dialog.
- Every match ends on a results screen after the win scene: who won, the time, and each player's flags brought home, vehicles lost and vehicles left. Offline it offers Rematch (same map and settings), Watch Replay and Title Screen; online it goes back to the lobby.
- The view is called Classic or Modern everywhere (the title's Style, Options > View, Match Setup), and Picture is greyed out in the modern view with "Classic only", since it only scales the classic picture.
- Dialogs that only show something close with Close (Help, About, System Info, Hall of Fame); ones that change settings have Save and Cancel (Sound, Controls).
- The "Signed in as" line shows on the main menu and under Online only, Online has a hint like the other entries, and Options > Instruments is left out on a server without a SoundFont instead of offering a choice that does nothing.
- Options > Controls says what the second and third buttons do in each vehicle, and its list fades at the bottom when there is more to scroll.
- The Hall of Fame counts wins for each side (Brown, Green, Blue, Red; every base on a winning team gets one) instead of Player 1 and Player 2, says how many bases each map has, and names the whole winning team.
- The classic title menu is a little narrower, leaving more of the title picture in view.
- Modern view: the flag arrows on maps with three or four bases no longer pile their labels on top of each other. Only the nearest of a base's possible flag sites is labelled with its distance, and labels that would overlap move apart.
- Modern view: a hit on your own vehicle breaks the drone feed up to at most 70%, so you can still see who is shooting.
- Modern bunker: the chosen vehicle's card is drawn larger, and the other cards shrink to their name and how many are left.
- Level editor: the Preview starts on Modern, like the game, until you pick another; the status bar shows "K: keys"; and the Getting Started step is now "Paint the land and the sea", ticked once the map has a coast (a new map is all land, so it used to tick at once).

## [0.5.3] - 2026-11-15

The modern view's sea comes alive: shallow and deep water clearly told apart, wakes and spray from every vehicle, helicopter downwash, and the moon, lamps, headlights and blasts reflected on the water at night.

### Changed

- The modern view's sea shows its depth as the match plays it: the shallows are clear water over a sandy bottom with light playing on the sand, deep water is dark blue and darker further out, and a pale rim and a dark drop-off mark the edge of the shelf, so you can see where a tank would sink. On the thermal camera the shallows run a touch warmer than deep water.
- Vehicles disturb the water in the modern view, each its own way: a jeep leaves two thin lines of foam and kicks up spray, a tank churns broad brown lanes of silt and pushes a heavy bow wave, an ASV throws white water and rooster tails off its wheels, a jeep floating on its tyres leaves a V of foam, and a vehicle going under boils the water with bubbles. Ripples spread from vehicles standing in the water, swimmers, splashes and shots that land in the sea, and the sub stirs the surface as it comes up.
- A helicopter over water flattens and roughens the sea under its rotor and blows rings of chop and spray out across it, the more the lower it flies.
- At night the modern sea reflects the lights: the moon's path glitters on it, building lamps light the water by the shore and shimmer on it, headlight beams light the water and glint off the waves, and blasts light the sea round them.

## [0.5.2] - 2026-11-15

Nights in the modern view: every lamp lit, lamps and headlights casting shadows, and lights that stay put as you move. Modern matches also open in the modern view from the first frame, and the modern bunker's vehicle select is now a CCTV feed.

### Added

- The modern bunker's vehicle select is a security camera's feed: washed-out colour by day and black-and-white infrared by night, with scanlines, a rolling bar, its clock and REC. Each bay's vehicle gets a detection box with its class and confidence, and an analysis card with its role, armour, speed, firepower, fuel, arms, terrain, weak spots, units left and status, beside live link and lift read-outs. On a phone or tablet only the chosen vehicle's card shows, larger. The classic bunker is unchanged.

### Changed

- At night in the modern view every building lamp is lit, not just the few nearest the camera, and lamps and vehicle headlights cast shadows: buildings and trees block lamp light, and buildings, trees and vehicles block headlights, instead of the light shining through them. Lamps hang just clear of their own walls (over the door, or under a watchtower's floor) rather than inside the next building, and about one house in four has its lamp on.

### Fixed

- A match in the modern view no longer flashes up in the classic view for its first moments while the 3D renderer loads. The renderer's code is fetched while still in the menus (when your view is Modern, or the host picked Modern in an online lobby), and if it is not quite ready the match opens on a modern ACQUIRING DRONE FEED screen and an offline match waits for it.
- Night lights in the modern view no longer shift as the camera or a vehicle moves: each lamp keeps its own pattern and flicker, lamps no longer switch on and off or jump from building to building, and a headlight's pattern no longer turns as the camera tilts.
- Moonlight and sunlight shadows no longer crawl and shimmer as the camera follows a vehicle.

## [0.5.1] - 2026-11-14

The modern look everywhere: Modern by default with a new title, day or night as a match option, a lobby that fits the screen, a modern level editor, flag guide arrows, a modern end of match, spectating when out, and a rewritten Help and About.

0.4.0 was never released on its own, so this is also the first release with its changes: the modern view as a drone feed, the thermal camera and vehicle lights (see [0.4.0](CHANGELOG.md#040---2026-11-14) below; some of its options have since moved, as listed here).

### Added

- Guide arrows at the edges of the modern view, in each rival base's colour, point to where its flag may be: every standing flag building of a rival (without giving away which one hides it), a flag lying in the open, and the way home while your jeep carries one, each with its distance.
- The level editor previews the map as you edit it in either of the game's views: Classic (the pixel view through its CRT), Modern (the 3D drone feed) or Night (the modern view in a night match), from the Preview switch at the top or the V key. Test Play starts in the view being previewed.
- The level editor helps more: a Getting started checklist over a new map that ticks off each step to a playable one (Help > Getting Started brings it back), fix buttons on the Problems tab for the obvious fixes, J / Shift+J to step through the problems, a picture of the chosen map in File > Open, and every key shown over the map while K is held.
- The level editor's Night preview has a Moonlight switch to see the map while editing, or turn it off to see how dark the match will be.
- A player whose base is out can switch between the players still in the match, in the classic and modern views, offline (including each half of Two Players) and online: the turn keys step through them (fire steps on), the launch keys or 1–4 pick one, and on a phone or tablet P1–P4 at the top. The view starts on a teammate who is still playing, or else anyone still in, and the game says how to switch when you go out. Online spectators can step through the players with ← / → as well as 1–4.
- The modern view's own end of the match: the drone's last pass over the winner's base, climbing as fireworks go up in the winner's colour, while the computer vision locks onto the base and types out its assessment (the winner, bases neutralised, engagement time), then the stream breaks up and cuts to SIGNAL LOST. It keeps the match's look (drone feed or clean, thermal, day or night).

### Changed

- The online lobby fits the window without scrolling, from 1280 × 720 up and on a phone held sideways: the seats and the match settings on the left, the map and the chat on the right, the invite code in the title bar, and Ready or Start always in view.
- In an online match the host picks the view, Classic or Modern, for every player in the lobby's Multiplayer view section; "Each player's choice" is gone and a player's own Visuals option shows the host's pick while online.
- Day or night is a game option, picked with the difficulty: Time of day on the Player Selector, and in the lobby (the host's pick) next to Difficulty. It is no longer in Options.
- Modern is the default view. The main menu has a Style toggle, Modern or Classic, that swaps the title picture (for Modern, the classic scene by night and through the thermal camera, cut together with a stream glitch under the drone feed's computer-vision boxes; for Classic, the pixel art) and is remembered; online, the host's pick still applies. New lobbies start on Modern.
- Play is now Local Play (Training, or Split Screen for two players on one keyboard); Online is online play only, one player per screen. The Player Selector is laid out like the lobby's match settings: game, names, difficulty, time of day, and the view cards.
- Options is grouped so each page fits the screen: Full Screen, View (Visuals, Picture), Sound and Music (Volume, Music, Instruments) and Controls (Vehicle Keys, Swap Sides).
- The level editor has a new look in the game's dark menu theme: a top bar with the menus, the map's name and save state, undo and redo, the Preview and Camera switches and Test Play; grouped tools with icons; zoom buttons and a tile read-out over the map; and a tidier palette, Map tab and Problems list. Dialogs match the game's.
- The level editor's minimap and draft pictures show the map in the look being previewed, the tile read-out names buildings plainly, and the modern preview draws less often when you leave it alone, saving power.
- The level editor is desktop only, and now says so everywhere: on a phone or tablet the main menu shows Level Editor greyed out as desktop only, and the editor page shows a "Desktop only" card with a way back to the game. A desktop window too small for the editor is asked to grow.
- The modern view is always the drone's feed and the retro view always has its CRT look: they are what each view is, so Options no longer has Camera or CRT Look. The thermal camera is part of playing, not a setting, and only for the dark: in a night match it is switched by its key or the THERMAL button (which only shows at night), every match starts with it off, and it has left Options.
- The modern view's night lights are less clean: headlights and searchlights carry blotches, grime, scratches and faint reflector rings that travel with the beam, and lamps and fires throw the soft bars of their cages, smudges and a flicker.
- The thermal camera is a control: G (left hand) or I (right hand), listed and rebindable in Options > Controls and in Help. An always-visible THERMAL toggle beside the menu button shows whether it is on and its key.
- Over a modern match the menu and thermal buttons take the computer vision's look, and the drone overlay's corner bracket and the note chip move out of their way.
- Every message to the player over a modern match shows as a computer-vision read-out (monospace, framed, tagged STATUS, EVENT, COMMS, SCORES, ANALYSIS or SYS): the view's note, the match log, chat, the scoreboard, banners and pop-up messages such as the thermal camera's on and off, which now sit under the clock, clear of the plot.
- Help Topics (H) is rewritten for the game as it is now, in pages: How to Play (the goal, each vehicle's buttons, game types, computer skill), Keys (every key, and the touch controls), Views (classic and modern, the drone feed, the computer-vision HUD, flag arrows, day and night, the thermal camera, and the host's choice online), Online, and More (replays, the level editor, sound and music, settings).
- About says what the game is today: its version, that it needs no copy of the original and imports nothing, what comes from the original (its measurements and the 104 two-player map layouts), the music and the SoundFont's credit, and a link to the source.
- System Info shows the version, whether a game server and an account are there, the view in use and whether this browser can show the modern view, and whether sampled instruments are on offer.

### Fixed

- Replays play back as their match was seen (classic or modern, day or night), whatever the viewer's own Options say; the replay records it. Older replays play the viewer's way.
- Turning the thermal camera on or off (or changing any other option) during an online match whose host set the visuals no longer swaps the soundtrack to the player's own.

### Removed

- The jukebox, with its player for single pieces and its loader for a SoundFont file of your own. Sampled instruments still play the site's SoundFont.

## [0.4.0] - 2026-11-14

Not released on its own: these changes first shipped in 0.5.1.

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

[Unreleased]: https://github.com/zombiecheese/rf-redux/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.9.0
[0.8.1]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.8.1
[0.8.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.8.0
[0.7.2]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.7.2
[0.7.1]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.7.1
[0.7.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.7.0
[0.6.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.6.0
[0.5.3]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.5.3
[0.5.2]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.5.2
[0.5.1]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.5.1
[0.4.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.5.1
[0.3.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.3.0
[0.2.0]: https://github.com/zombiecheese/rf-redux/releases/tag/v0.2.0
