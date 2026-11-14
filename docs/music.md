# Music

The original played its score from the CD's audio tracks. The remake does not use those: it plays MIDI band
arrangements of public-domain military and classical music, chosen the way the original chose its tracks. The
modern view (Options > View > Visuals) has a soundtrack of its own: original hardcore, beatdown and metalcore
instrumentals, chosen by the same director (see "The modern soundtrack" below).

## How it works

- **Director** (`packages/client/src/music/director.ts`): a port of the original's music director
  (sub_40ef00-sub_40f694, piece table at 0x4463b8). It has the original's 18 pieces (Tank 1-3, a death piece per
  vehicle, Jeep, MSV, Heli 1-2, Flag Discovery, Flag Pickup, Win, Bunker, Death, Sub, Drums), their priorities,
  the decay of a granted priority, the transition tables (fade out, change on the beat, or cut in), what happens
  when a piece ends (loop from its loop point, or hand back to what played before), and the per-tick situation
  logic: a vehicle launched or destroyed, a flag uncovered or taken, the submarine out, everyone in the bunker.
  A tank or helicopter launched with exactly two more of its kind left in the bunker (the first of the default
  three) always starts on its first theme; otherwise the pick between the first two is random.
- **MIDI** (`smf.ts`): reads and writes Standard MIDI Files (formats 0 and 1, running status, tempo maps,
  markers). Sections of a piece are MIDI markers, so a piece can start or loop at one.
- **Sequencer** (`player.ts`): schedules events slightly ahead of the audio clock, plays from a section to the end,
  switches on the next beat or at once, fades out, and starts the next piece exactly when the last one ends, so
  loops have no gap.
- **Synthesiser** (`synth.ts`): General MIDI on WebAudio, modelled on the Roland MT-32's LA synthesis. Each timbre
  is up to four partials (an attack transient plus tones) with their own pitch, filter and amplifier envelopes,
  velocity-sensitive brightness and delayed vibrato. It has 64 voices (the MT-32 had 32 partials), all 16
  channels, all 128 programs plus the drum map, a stereo hall reverb (CC91) and a chorus (CC93), and handles
  volume, expression, pan, modulation, sustain, pitch bend and its range.
- **SoundFonts** (`soundfont.ts`): load a SoundFont 2 file for sampled instruments. Programs it has play from its
  samples (key and velocity splits, loops, tuning, volume envelope, attenuation, pan, filter); the rest stay on the
  built-in timbres. **Options > Sound and Music > Instruments** switches the band between **Built-in** (the default) and **Sampled**,
  which plays it from the site's SoundFont at `/generated/music/soundfont.sf2`. The browser fetches it the first time
  Sampled is picked and keeps it in its cache, so later visits start at once; the choice follows a signed-in account.
  The modern soundtrack always plays its own rig.
- **The SoundFont that ships**: [GeneralUser GS](https://www.schristiancollins.com/generaluser) 2.0.3 by S. Christian
  Collins (32 MB). Its licence (`tools/soundfont/GeneralUser-GS-LICENSE.txt`) allows using it, changing it and
  shipping it with software, free or commercial. It is not kept in git: the Docker image fetches it at build time
  with `tools/soundfont/fetch.mjs`, pinned to one commit of the author's repository and checked against its SHA-256,
  and puts it with its licence in `/assets/generated/music/`. For the dev server, `npm run soundfont` fetches it to
  `assets/generated/music/soundfont.sf2`. A site can use another General MIDI SoundFont by putting it there instead
  (FluidR3_GM is MIT-licensed, but at about 140 MB it is a long download for a browser).
- **Replacing a piece**: put a MIDI file at `assets/generated/music/<name>.mid`, where `<name>` is one of the file
  names below. Name its sections with marker events to match the start and loop points the director uses.
- **Options > Sound and Music > Music** switches the music off and on (as the original's menu did); **Options > Sound
  and Music > Volume** sets the master, effects and music volume (V mutes everything).

## The pieces, and why each is in the public domain

Every arrangement below was written for this project, note by note, in `packages/client/src/music/pieces.ts`. No
existing MIDI file, recording, score edition or transcription was copied. The MIDI files the game plays are built
from those lines when it runs. We dedicate the arrangements, and the MIDI files built from them, to the public
domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The underlying music:

| File | Director pieces | Music | Composer, date | Public-domain status |
| --- | --- | --- | --- | --- |
| `tank` | Tank 1, 2, 3 (sections a, b, c) | Mars, the Bringer of War (The Planets) | Gustav Holst, 1914, published 1921; died 1934 | Public domain in the US (published before 1930) and in countries with terms of life plus 70 years or less (UK, EU, Canada, Australia and most others) since 2005. Still protected in Mexico (life plus 100) until 2035. |
| `tank-death` | Tank Death | Funeral March, Piano Sonata No. 2 | Frederic Chopin, 1837; died 1849 | Public domain worldwide. |
| `jeep` | Jeep 1 | Yankee Doodle | Traditional, about 1755 | Public domain worldwide. |
| `asv` | MSV 1 | In the Hall of the Mountain King (Peer Gynt) | Edvard Grieg, 1875; died 1907 | Public domain worldwide. |
| `asv-death` | MSV Death | Our own falling line on the same tune | After Grieg | As above; the line is ours (CC0). |
| `heli` | Heli 1, 2 (sections a, b) | Ride of the Valkyries (Die Walkure), a free setting of its horn call | After Richard Wagner, 1856; died 1883 | Public domain worldwide. |
| `heli-death` | HELI Death | Our own falling figure | After Wagner | As above; the figure is ours (CC0). |
| `flag-discovery` | Flag Discovery | Charge (bugle call) | US Army, 19th century | Public domain worldwide (19th-century military call; US Army manuals are US government works). |
| `flag-pickup` | Flag Pickup | Homeward with the Colours | Original to this project, 2026 | CC0. |
| `win` | Win | Ode to Joy (Symphony No. 9), after the Charge | Ludwig van Beethoven, 1824; died 1827 | Public domain worldwide. |
| `bunker` | Bunker | Standing By | Original to this project, 2026 | CC0. |
| `death` | Death, Jeep Death | Taps (bugle call) | Daniel Butterfield and Oliver Norton, US Army, 1862 | Public domain worldwide. |
| `sub` | Sub | Dies irae | Plainchant sequence, 13th century | Public domain worldwide. |
| `drums` | Drums (sections intro, loop) | Drum corps cadence | Original to this project, 2026 | CC0. |
| `fanfare` | (the Zombiecheese Productions splash, not the director) | Zombiecheese Fanfare | Original to this project, 2026 | CC0. |

The original game also played the jeep's death on the same track as Death, so both play Taps here.

Copyright terms differ by country; the table gives the position as we understand it, not legal advice. Holst is
the one composer whose work is not yet free everywhere: if that matters for where the game is offered, replace
`tank` (see "Replacing a piece") or swap its lines in `pieces.ts`.

## The modern soundtrack

When the modern view is on, the director plays from `packages/client/src/music/pieces-modern.ts` instead of the band
book: the same eighteen pieces and the same file and section names, so every moment the band covers has a heavy
counterpart. Switching the view switches the music at once, to the same piece. A browser that cannot show the
modern view keeps the band. The splash's fanfare stays the band's.

The band: two rhythm guitars in drop C, double-tracked and panned hard left and right, with their palm mutes on
their own channels (GM programs 30 and 28), a pick bass (34), a lead guitar (29), a pad (89), a clean guitar (27),
an 808-style sub that drops an octave as it rings (38) and the Power kit (drum-channel program 16: a clicky kick,
a fat snare, deep toms and a china on key 52). The synthesiser plays the guitars and bass through an amp of its
own on their channel: a tightening high-pass, a hard-driven soft-clipping preamp and a 4x12 cabinet curve, with the
right-hand guitar a few milliseconds late to spread the pair. The modern soundtrack always plays this rig, never a
SoundFont.

Riffs are written once (`riff()` in `pieces-modern.ts`: upper case is an open power chord, lower case a palm-muted
chug) and become the lines of both guitars, both palm mutes and the bass; `lock()` writes breakdown drums that hit
with the riff. Every piece also has a hardcore breakdown (`breakdown()`): the tempo drops, the kit goes
half-time on the china, the sub drops under the first hit and a stop sets up the last drop; the short stings end
on a two-bar one. Any piece can be replaced with a MIDI file at `assets/generated/music/modern-<name>.mid`.

Every piece is original to this project, 2026, released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/):

| File | Director pieces | Title | Style |
| --- | --- | --- | --- |
| `tank` | Tank 1, 2, 3 (sections a, b, c) | Iron Lung | Metalcore: a stomping groove, a d-beat, then the breakdown with the flag in danger |
| `tank-death` | Tank Death | Last Rites | Two ringing chords over a sub drop |
| `jeep` | Jeep 1 | Two-Step Getaway | Fast hardcore punk, then a two-step |
| `asv` | MSV 1 | Slow Payload | Beatdown: a chug riff, then a slower slam with the sub |
| `asv-death` | MSV Death | Payload Lost | A falling run of chords and a tom fill |
| `heli` | Heli 1, 2 (sections a, b) | Rotorblade | Melodic metalcore: a gallop under a lead line, then a half-time chorus |
| `heli-death` | HELI Death | Autorotation | The lead dives down the neck |
| `flag-discovery` | Flag Discovery | Spotted | Stabs and a fill |
| `flag-pickup` | Flag Pickup | Run It Home | Blast beats under a tremolo riff and a lead call, then stomps |
| `win` | Win | Last Base Standing | A major-key anthem with the lead |
| `bunker` | Bunker | Holding Pattern | Clean guitar and pad, palm mutes creeping in |
| `death` | Death, Jeep Death | Flatline | Clean guitar falling through C minor, one last chord |
| `sub` | Sub | Pressure Hull | Slow doom with a sonar ping |
| `drums` | Drums (sections intro, loop) | Warm-Up | A mid-tempo hardcore groove for the menus |

## Writing or changing a piece

`score.ts` describes the notation. Each section gives every part a line; bar lines are checked against the metre,
and `npm test` compiles every piece, checks its sections against the director's start and loop points, and keeps
every note inside its instrument's range.
