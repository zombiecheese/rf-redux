# Music

The original played its score from the CD's audio tracks. The remake does not use those: it plays MIDI band
arrangements of public-domain military and classical music, chosen the way the original chose its tracks.

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
  built-in timbres. Put one at `assets/generated/music/soundfont.sf2` (served as `/generated/music/soundfont.sf2`)
  to load it every time, or load one for a visit from **Options > Jukebox**. None ships with the game. Good
  General MIDI ones with licences that allow this: FluidR3_GM (MIT licence) and GeneralUser GS (free to use and
  share; read its licence file).
- **Replacing a piece**: put a MIDI file at `assets/generated/music/<name>.mid`, where `<name>` is one of the file
  names below. Name its sections with marker events to match the start and loop points the director uses.
- **Options > Music** switches the music off and on (as the original's menu did); **Options > Sound** sets the
  master, effects and music volume (V mutes everything); **Options > Jukebox** plays any piece.

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

## Writing or changing a piece

`score.ts` describes the notation. Each section gives every part a line; bar lines are checked against the metre,
and `npm test` compiles every piece, checks its sections against the director's start and loop points, and keeps
every note inside its instrument's range.
