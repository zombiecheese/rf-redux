// The band book: our arrangements of public-domain music for a military band, one MIDI piece per file name the
// music director asks for (director.ts). Every tune here was published long enough ago that it is in the public
// domain everywhere we know of, and every arrangement is written here from scratch and released under CC0, so the
// MIDI files built from these lines are free of anyone else's copyright. Sources and licences: docs/music.md.

import type { PartDef, PieceDef } from './score.js';

// ---- The band ----------------------------------------------------------------------------------------------------

const TRUMPET: PartDef = { name: 'trumpet', ch: 0, program: 56, volume: 100, pan: 74, reverb: 45 };
const HORN: PartDef = { name: 'horn', ch: 1, program: 60, volume: 96, pan: 50, reverb: 60 };
const TROMBONE: PartDef = { name: 'trombone', ch: 2, program: 57, volume: 100, pan: 84, reverb: 45 };
const TUBA: PartDef = { name: 'tuba', ch: 3, program: 58, volume: 104, pan: 64, reverb: 35 };
const PICCOLO: PartDef = { name: 'piccolo', ch: 4, program: 72, volume: 92, pan: 44, reverb: 40 };
const CLARINET: PartDef = { name: 'clarinet', ch: 5, program: 71, volume: 96, pan: 38, reverb: 45 };
const STRINGS: PartDef = { name: 'strings', ch: 6, program: 48, volume: 92, pan: 64, reverb: 60 };
const TIMPANI: PartDef = { name: 'timpani', ch: 7, program: 47, volume: 104, pan: 64, reverb: 50 };
const BUGLE: PartDef = { name: 'bugle', ch: 8, program: 56, volume: 108, pan: 60, reverb: 75 };
const DRUMS: PartDef = { name: 'drums', ch: 9, program: 0, volume: 100, pan: 64, reverb: 35 };

// ---- Helpers for writing lines -----------------------------------------------------------------------------------

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A line transposed by some semitones. */
export function tr(line: string, semitones: number): string {
  return line.replace(/([A-G])(#|b)?(-?\d)/g, (_, l: string, acc: string | undefined, oct: string) => {
    const n = (Number(oct) + 1) * 12 + LETTER[l]! + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + semitones;
    return `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
  });
}

/** Every note of a line played short. */
function stac(line: string): string {
  return line.split(/\s+/).map((t) => (/^[A-G][^']*\d(\/[0-9.t+]+)?$/.test(t) ? `${t}'` : t)).join(' ');
}

/** n bars of the same bar, bar lines included. */
const bars = (n: number, bar: string) => `| ( ${bar} | )*${n}`;

// ---- Tank: "Mars, the Bringer of War" -----------------------------------------------------------------------------
// Holst's five-four ostinato under the low brass, growing over three movements. Tank 1 starts at the first,
// Tank 2 at the second, Tank 3 (the flag in danger) at the third, as the original's three tank tracks did.

const ost = (n: string) => `${n}/8t' ${n}' ${n}' ${n}/4' ${n}' ${n}/8' ${n}' ${n}/4'`;
const SNARE_OST = 'sn/8t sn sn sn/4 sn sn/8 sn sn/4';

const tank: PieceDef = {
  title: 'Mars, the Bringer of War', credit: 'Gustav Holst, The Planets, 1914 (published 1921)', bpm: 168, meter: [5, 4],
  parts: [TRUMPET, HORN, TROMBONE, TUBA, STRINGS, TIMPANI, DRUMS],
  sections: [
    { name: 'a', parts: {
      strings: `p ${bars(8, ost('G3'))}`,
      timpani: `pp ${bars(8, ost('G2'))}`,
      horn: 'mp | r/1+4 | r/1+4 | G3/1+4 | G3/2. Ab3/2 | G3/1+4 | D4/2. Db4/2 | C4/1+4 | G3/1+4 |',
      tuba: `p ${bars(8, 'G2/1+4')}`,
    } },
    { name: 'b', parts: {
      strings: `mf ${bars(8, ost('G3'))}`,
      timpani: `p ${bars(8, ost('G2'))}`,
      trombone: 'mf | G3+D4/1+4 | G3+D4/1+4 | Ab3+Eb4/2. G3+D4/2 | Ab3+Eb4/2. G3+D4/2 | F3+C4/1+4 | F3+C4/2. Gb3+Db4/2 | G3+D4/1+4 | G3+D4/1+4 |',
      horn: 'mf | D4/1+4 | D4/2. Eb4/2 | D4/1+4 | A4/2. Ab4/2 | G4/1+4 | G4/2. Ab4/2 | G4/1+4 | r/1+4 |',
      tuba: `mf ${bars(8, 'G2/1+4')}`,
      drums: '| ( r/1+4 | )*6 p sn/1+4z | f sn/2.z cy/2> |',
    } },
    { name: 'c', parts: {
      strings: `f ${bars(8, ost('G3'))}`,
      timpani: `f ${bars(8, ost('G2'))}`,
      trumpet: `ff | ${['D5+G5', 'Eb5+Ab5', 'D5+G5', 'Eb5+Ab5', 'Db5+F5', 'C5+E5', 'Db5+F5', 'D5+G5'].map(ost).join(' | ')} |`,
      trombone: 'f | G3+D4/1+4 | Ab3+Eb4/1+4 | G3+D4/1+4 | Ab3+Eb4/1+4 | Gb3+Db4/1+4 | F3+C4/1+4 | Gb3+Db4/1+4 | G3+D4/1+4 |',
      horn: 'f | G4/1+4 | Ab4/1+4 | G4/2. D5/2 | Eb5/1+4 | Db5/1+4 | C5/1+4 | Db5/2. C5/2 | G4/1+4 |',
      tuba: `f ${bars(8, 'G2/1+4')}`,
      drums: `f | cy/4> r/4 r r r | ( ${SNARE_OST} | )*6 sn/1+4z |`,
    } },
  ],
};

// Chopin's funeral march, its opening phrase for low brass over the tolling chords.
const tankDeath: PieceDef = {
  title: 'Funeral March', credit: 'Frederic Chopin, Piano Sonata No. 2, Op. 35, 1837', bpm: 54, meter: [4, 4],
  parts: [HORN, TROMBONE, TUBA, TIMPANI, DRUMS],
  sections: [{ name: 'a', parts: {
    trombone: 'mp | Bb3/4 Bb3/8. Bb3/16 Bb3/4 Db4/8. C4/16 | C4/8. Bb3/16 Bb3/8. A3/16 Bb3/2 | p Bb3/4 Bb3/8. Bb3/16 Bb3/4 Db4/8. C4/16 | C4/8. Bb3/16 Bb3/8. A3/16 Bb3/2~ |',
    horn: 'p | Db3+F3/1 | Db3+F3/1 | Db3+F3/1 | Db3+F3/1~ |',
    tuba: 'mp | ( Bb1+F2/4 Gb1+Db2/4 )*2 | ( Bb1+F2/4 Gb1+Db2/4 )*2 | ( Bb1+F2/4 Gb1+Db2/4 )*2 | Bb1+F2/1~ |',
    timpani: 'p | Bb2/4 r Bb2 r | Bb2/4 r Bb2 r | Bb2/4 r Bb2 r | pp Bb2/1z |',
    drums: 'p | bd/4 r bd r | bd/4 r bd r | bd/4 r bd r | bd/1 |',
  } }],
};

// ---- Jeep: "Yankee Doodle" for fife and drum -------------------------------------------------------------------

const YANKEE = 'G5/8 G5 A5 B5 | G5 B5 A5 D5 | G5 G5 A5 B5 | G5/4 F#5 | G5/8 G5 A5 B5 | C6 B5 A5 G5 | F#5 D5 E5 F#5 | G5/4 G5 |';
const OOMPAH: Record<string, string> = { G: 'G2/8 r D3 r', C: 'C3/8 r G2 r', D: 'D3/8 r A2 r' };
const YANKEE_BASS = ['G', 'G', 'G', 'D', 'G', 'C', 'D', 'G'].map((h) => OOMPAH[h]).join(' | ');
const CADENCE = 'bd+sn/8> sn/16 sn bd+sn/8 sn/8';

const jeep: PieceDef = {
  title: 'Yankee Doodle', credit: 'Traditional, about 1755', bpm: 150, meter: [2, 4],
  parts: [TRUMPET, TUBA, PICCOLO, DRUMS],
  sections: [
    { name: 'a', parts: {
      piccolo: `f | ${YANKEE} ${YANKEE}`,
      tuba: `mf | ${YANKEE_BASS} | ${YANKEE_BASS} |`,
      drums: `mf ${bars(16, CADENCE)}`,
    } },
    { name: 'b', parts: {
      piccolo: `ff | ${YANKEE}`,
      trumpet: `f | ${tr(YANKEE, -12)}`,
      tuba: `f | ${YANKEE_BASS} |`,
      drums: `f | bd+sn+cy/8> sn/16 sn bd+sn/8 sn/8 | ( ${CADENCE} | )*7`,
    } },
  ],
};

// ---- ASV: "In the Hall of the Mountain King" as a creeping band march --------------------------------------------

const KING = 'B2/8 C#3 D3 E3 F#3 D3 F#3/4 | F3/8 C#3 F3/4 E3/8 C3 E3/4 | B2/8 C#3 D3 E3 F#3 D3 F#3 B3 | A3 F#3 D3 F#3 A3/2 |';
const KING_BASS = "B1/4' F#2' B1' F#2' | C#2' G#2' C#2' C2' | B1' F#2' B1' D2' | F#1' C#2' F#1/2 |";
const MARCH = 'bd+sn/4> sn/8 sn bd+sn/4 sn/4';

const asv: PieceDef = {
  title: 'In the Hall of the Mountain King', credit: 'Edvard Grieg, Peer Gynt, 1875', bpm: 96, meter: [4, 4],
  parts: [TRUMPET, TROMBONE, TUBA, CLARINET, TIMPANI, DRUMS],
  sections: [
    { name: 'a', parts: {
      tuba: `mp | ${stac(KING)} ${stac(KING)}`,
      clarinet: `| ( r/1 | )*4 mf ${stac(tr(KING, 12))}`,
      drums: `p ${bars(8, 'r/4 sn/4 r/4 sn/4')}`,
    } },
    { name: 'b', bpm: 116, parts: {
      trumpet: `f | ${stac(tr(KING, 12))} ${stac(tr(KING, 12))}`,
      trombone: `f | ${stac(KING)} ${stac(KING)}`,
      clarinet: `f | ${stac(tr(KING, 24))} ${stac(tr(KING, 24))}`,
      tuba: `f | ${KING_BASS} ${KING_BASS}`,
      timpani: `f ${bars(8, 'B2/4 r F#2 r')}`,
      drums: `f | bd+sn+cy/4> sn/8 sn bd+sn/4 sn/4 | ( ${MARCH} | )*7`,
    } },
  ],
};

const asvDeath: PieceDef = {
  title: 'The Mountain King Falls', credit: 'After Edvard Grieg, Peer Gynt, 1875', bpm: 66, meter: [4, 4],
  parts: [TROMBONE, TUBA, TIMPANI, DRUMS],
  sections: [{ name: 'a', parts: {
    tuba: 'f | B2/4 A2 G2 F#2 | F2/4 E2 D#2 D2 | B1+F#2/1~ |',
    trombone: 'mf | D3+F#3/1 | C3+F3/1 | B2+D3+F#3/1~ |',
    timpani: 'mf | r/1 | r/2 F#2/4 F#2 | B2/1z |',
    drums: '| r/1 | r/2 bd/4 bd | bd+tam/1 |',
  } }],
};

// ---- Helicopter: the Valkyries' ride --------------------------------------------------------------------------
// A free band setting after Wagner: the dotted nine-eight horn call climbing its chords over string tremolo.

const RIDE = [
  'B3/8. F#3/16 B3/8 D4/4. D4/8. B3/16 D4/8',
  'F#4/4. F#4/8. D4/16 F#4/8 A4/4.',
  'A4/8. F#4/16 A4/8 C#5/4. C#5/8. A4/16 C#5/8',
  'F#4/2.+4.',
].join(' | ') + ' |';
const RIDE_STRINGS = 'B3+F#4/2.+4.z | B3+D4+F#4/2.+4.z | A3+C#4+F#4/2.+4.z | A#3+C#4+F#4/2.+4.z |';
const RIDE_TUBA = 'B1/4.> r/2. | D2/4.> r/2. | C#2/4.> r/2. | F#1/4.> r/2. |';
const RIDE_TIMPANI = 'B2/4.> r/4. F#2/4. | B2/4. r/4. F#2/4. | F#2/4.> r/4. C#3/4. | F#2/2.+4.z |';
const RIDE_DRUMS = '| cy/4.> r/2. | ( r/2.+4. | )*2 sn/2.+4.z | cy/4.> r/2. | ( r/2.+4. | )*2 sn/2.+4.z |';

const heli: PieceDef = {
  title: 'Ride of the Valkyries', credit: 'After Richard Wagner, Die Walkure, 1856', bpm: 140, meter: [9, 8],
  parts: [TRUMPET, HORN, TUBA, STRINGS, TIMPANI, DRUMS],
  sections: [
    { name: 'a', parts: {
      horn: `f | ${RIDE} ${RIDE}`,
      trumpet: `| ( r/2.+4. | )*4 ff ${tr(RIDE, 12)}`,
      strings: `mf | ${RIDE_STRINGS} ${RIDE_STRINGS}`,
      tuba: `f | ${RIDE_TUBA} ${RIDE_TUBA}`,
      timpani: `mf | ${RIDE_TIMPANI} ${RIDE_TIMPANI}`,
      drums: RIDE_DRUMS,
    } },
    { name: 'b', parts: {
      horn: `f | ${tr(RIDE, 5)} ${RIDE}`,
      trumpet: `f | ${tr(RIDE, 5)} ff ${tr(RIDE, 12)}`,
      strings: `f | ${tr(RIDE_STRINGS, 5)} ${RIDE_STRINGS}`,
      tuba: `f | ${tr(RIDE_TUBA, 5)} ${RIDE_TUBA}`,
      timpani: `f | ${tr(RIDE_TIMPANI, 5)} ${RIDE_TIMPANI}`,
      drums: RIDE_DRUMS,
    } },
  ],
};

const heliDeath: PieceDef = {
  title: 'The Valkyrie Falls', credit: 'After Richard Wagner, Die Walkure, 1856', bpm: 120, meter: [9, 8],
  parts: [TRUMPET, TROMBONE, TUBA, TIMPANI, DRUMS],
  sections: [{ name: 'a', parts: {
    trumpet: 'ff | F#5/4. E5/4. D5/4. | C#5/4. B4/4. A#4/4. | B4/2.+4.~ |',
    trombone: 'f | F#3+B3/4. E3+A3/4. D3+G3/4. | C#3+F#3/4. B2+E3/4. A#2+C#3/4. | B2+F#3/2.+4.~ |',
    tuba: 'f | B1/2.+4. | F#1/2.+4. | B1/2.+4.~ |',
    timpani: 'f | r/2.+4. | F#2/2.+4.z | B2/2.+4.z |',
    drums: '| cy/4.> r/2. | r/2.+4. | bd+cy/4.> r/2. |',
  } }],
};

// ---- Flags -------------------------------------------------------------------------------------------------------

// The cavalry's Charge on the bugle, the band answering.
const CHARGE = 'G4/8t C5 E5 G5/4. E5/8 G5/4';
const flagDiscovery: PieceDef = {
  title: 'Charge', credit: 'United States Army bugle call, 19th century', bpm: 116, meter: [4, 4],
  parts: [HORN, TROMBONE, TUBA, TIMPANI, BUGLE, DRUMS],
  sections: [{ name: 'a', parts: {
    bugle: `f | ${CHARGE} | G5/1~ | ff ${CHARGE} | C6/1~ |`,
    horn: '| r/1 | r/1 | r/1 | f C4+E4+G4/1~ |',
    trombone: '| r/1 | r/1 | r/1 | f C3+G3/1~ |',
    tuba: '| r/1 | r/1 | r/1 | f C2/1~ |',
    timpani: 'f | r/1 | r/1 | r/2 G2/2z | C3/1z |',
    drums: '| p sn/1z | sn/1z | f sn/1z | ff bd+cy/1 |',
  } }],
};

// Bringing the flag home: a quick march of our own, in bugle-call style, over sixteenth-note snare.
const HOMEWARD = 'G4/16 G4 C5/8 E5 C5 | G5/4 E5 | G4/16 G4 C5/8 E5 G5 | C6/4 G5 | E5/8 E5/16 E5 G5/8 E5 | C5/8 C5/16 C5 E5/8 C5 | G4/8 C5 E5 G5 | C5/4 r |';
const HOMEWARD_CHORDS = 'C3+E3/2 | C3+G3/2 | C3+E3/2 | E3+G3/2 | C3+G3/2 | C3+E3/2 | B2+D3+G3/2 | C3+E3/2 |';
const HOMEWARD_BASS = 'C2/8 r G2 r | C2/8 r G2 r | C2/8 r G2 r | C2/8 r G2 r | C2/8 r G2 r | C2/8 r G2 r | G1/8 r D2 r | C2/8 r G2 r |';
const SIXTEENTHS = 'sn/16> sn sn sn bd+sn/16> sn sn sn';
const flagPickup: PieceDef = {
  title: 'Homeward with the Colours', credit: 'Original, Return Fire: Redux, 2026', bpm: 144, meter: [2, 4],
  parts: [TRUMPET, TROMBONE, TUBA, BUGLE, DRUMS],
  sections: [
    { name: 'a', parts: {
      bugle: `f | ${HOMEWARD}`,
      trombone: `mf | ${HOMEWARD_CHORDS}`,
      tuba: `mf | ${HOMEWARD_BASS}`,
      drums: `mf ${bars(8, SIXTEENTHS)}`,
    } },
    { name: 'b', parts: {
      bugle: `ff | ${HOMEWARD}`,
      trumpet: `f | ${tr(HOMEWARD, -12)}`,
      trombone: `f | ${HOMEWARD_CHORDS}`,
      tuba: `f | ${HOMEWARD_BASS}`,
      drums: `f | sn+cy/16> sn sn sn bd+sn/16> sn sn sn | ( ${SIXTEENTHS} | )*7`,
    } },
  ],
};

// ---- Win: the "Ode to Joy" for full band, after the Charge in D -------------------------------------------------

const ODE = 'F#4/4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | F#4/4. E4/8 E4/2 | F#4/4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | E4/4. D4/8 D4/2 |';
const win: PieceDef = {
  title: 'Ode to Joy', credit: 'Ludwig van Beethoven, Symphony No. 9, 1824', bpm: 100, meter: [4, 4],
  parts: [TRUMPET, HORN, TROMBONE, TUBA, PICCOLO, TIMPANI, BUGLE, DRUMS],
  sections: [
    { name: 'intro', parts: {
      bugle: `f | ${tr(CHARGE, 2)} | A5/1~ |`,
      tuba: '| r/1 | f D2/1 |',
      timpani: 'mf | A2/1z | D3/2z A2/2 |',
      drums: '| mf sn/1z | f sn/2z cy/2> |',
    } },
    { name: 'hymn', parts: {
      trumpet: `f | ${tr(ODE, 12)}`,
      horn: `mf | ${ODE}`,
      piccolo: `mf | ${tr(ODE, 24)}`,
      trombone: 'mf | D3+F#3+A3/1 | C#3+E3+A3/1 | D3+F#3+A3/2 G3+B3+D4/2 | A2+C#3+E3/1 | D3+F#3+A3/1 | C#3+E3+A3/1 | D3+F#3+A3/2 G3+B3+D4/2 | A2+C#3+E3/2 D3+F#3+A3/2 |',
      tuba: 'mf | D2/2 A1/2 | A1/2 E2/2 | D2/2 G1/2 | A1/1 | D2/2 A1/2 | A1/2 E2/2 | D2/2 G1/2 | A1/2 D2/2 |',
      timpani: 'mf | D3/4 r A2 r | A2/4 r A2 r | D3/4 r A2 r | A2/1z | D3/4 r A2 r | A2/4 r A2 r | D3/4 r A2 r | A2/2 D3/2 |',
      drums: `mf ${bars(8, MARCH)}`,
    } },
    { name: 'end', parts: {
      trumpet: 'ff | D5+F#5+A5/1~ |',
      horn: 'f | D4+F#4+A4/1~ |',
      piccolo: 'f | D6/1~ |',
      trombone: 'f | D3+A3/1~ |',
      tuba: 'f | D2/1~ |',
      timpani: 'f | D3/1z |',
      drums: 'ff | bd+cy/1 |',
    } },
  ],
};

// ---- Bunker: a quiet bugle air of our own over a soft street beat -----------------------------------------------

const bunker: PieceDef = {
  title: 'Standing By', credit: 'Original, Return Fire: Redux, 2026', bpm: 80, meter: [4, 4],
  parts: [HORN, TROMBONE, TUBA, STRINGS, DRUMS],
  sections: [{ name: 'a', parts: {
    horn: `p | ${tr('G4/4 C5 E5/2 | G5/4. E5/8 C5/2 | E5/4 C5 G4/2 | C5/1 | G4/4 C5 E5/2 | G5/4. E5/8 G5/2 | E5/4 C5 E5 G4 | C5/1 |', -12)}`,
    trombone: 'pp | C3+G3/1 | A2+E3/1 | F2+C3/1 | G2+D3/1 | C3+G3/1 | A2+E3/1 | F2+C3/2 G2+D3/2 | C3+G3/1 |',
    tuba: 'pp | C2/1 | A1/1 | F1/1 | G1/1 | C2/1 | A1/1 | F1/2 G1/2 | C2/1 |',
    strings: 'pp | E4+G4/1 | E4+A4/1 | F4+A4/1 | D4+G4/1 | E4+G4/1 | E4+A4/1 | F4+A4/2 D4+G4/2 | E4+G4/1 |',
    drums: `pp ${bars(8, 'bd+sn/8 sn/16 sn sn/8 sn rim/4 sn/8 sn')}`,
  } }],
};

// ---- Death: Taps -------------------------------------------------------------------------------------------------

const death: PieceDef = {
  title: 'Taps', credit: 'Daniel Butterfield, United States Army bugle call, 1862', bpm: 52, meter: [4, 4],
  parts: [{ ...BUGLE, reverb: 100 }],
  sections: [{ name: 'a', parts: {
    bugle: `f | ${tr('r/2. G3/8. G3/16 | C4/2. G3/8. C4/16 | E4/2. G3/8. C4/16 | E4/4 G3/8. C4/16 E4/4 G3/8. C4/16 | E4/2. C4/8. E4/16 | G4/2. E4/8. C4/16 | G3/2. G3/8. G3/16 | C4/1~ |', 12)}`,
  } }],
};

// ---- Submarine: "Dies irae" --------------------------------------------------------------------------------------

const DIES = 'F3/4 E3 F3 D3 | E3 C3 D3/2 | F3/4 F3 G3 F3 | E3 D3 C3 E3 | F3 E3 D3/2 | D3/1~ |';
const sub: PieceDef = {
  title: 'Dies irae', credit: 'Plainchant sequence, 13th century', bpm: 66, meter: [4, 4],
  parts: [HORN, TROMBONE, TUBA, STRINGS, TIMPANI, DRUMS],
  sections: [{ name: 'a', parts: {
    trombone: `mf | ${DIES}`,
    tuba: `mf | ${tr(DIES, -12)}`,
    horn: `p | ${tr(DIES, 12)}`,
    strings: 'pp | D3+A3/1z | ( D3+A3/1z | )*4 D3+A3/1z |',
    timpani: 'f | D2/1z | r/1 | D2/4 r r r | r/1 | D2/4 r A2/4 r | D2/1z |',
    drums: '| tam/1 | r/1 | r/1 | r/1 | tam/1 | bd/1 |',
  } }],
};

// ---- Menus: a drum corps cadence of our own -------------------------------------------------------------------

const DRUM_A = 'bd+sn/8> sn/16 sn sn/8 sn bd+sn/8> sn/16 sn sn/8 sn';
const DRUM_B = 'bd+sn/8> sn sn/16 sn sn sn sn/8 bd+sn/8> sn/16 sn sn/8';
const DRUM_C = 'bd+lt/8> mt ht mt bd+lt/8 mt ht/4';
const DRUM_D = 'sn/2z bd+sn/8> sn bd+cy/4>';
const drums: PieceDef = {
  title: 'Drums', credit: 'Original, Return Fire: Redux, 2026', bpm: 112, meter: [4, 4],
  parts: [DRUMS],
  sections: [
    { name: 'intro', parts: { drums: 'f | sn/1z | sn/2.z bd+cy/4> |' } },
    { name: 'loop', parts: { drums: `mf | ${[DRUM_A, DRUM_B, DRUM_A, DRUM_C, DRUM_A, DRUM_B, DRUM_C, DRUM_D].join(' | ')} |` } },
  ],
};

// ---- Fanfare: the Zombiecheese Productions splash, a fanfare of our own ------------------------------------------
// A graveyard tremolo while ZOMBIE climbs out of the ground, a minor-key call to arms as CHEESE lands, then the band
// turns it to D major for the big finish.

const fanfare: PieceDef = {
  title: 'Zombiecheese Fanfare', credit: 'Original, Return Fire: Redux, 2026', bpm: 152, meter: [4, 4],
  parts: [TRUMPET, HORN, TROMBONE, TUBA, STRINGS, TIMPANI, DRUMS],
  sections: [{ name: 'a', parts: {
    strings: 'pp | D3+A3+F4/1z | p D3+A3/1z | Bb3+D4+F4/2 A3+C#4+E4/2 | f D4+F#4+A4/1 | ff D3+A3+D4+F#4/1~ |',
    timpani: 'p | D2/1z | mf D2/4 r A2 r | D2/4 r A2/4 r | f D2/4> A2 D2 A2 | ff D2/1z |',
    trumpet: '| r/1 | f A4/8t A4 A4 D5/4 A4/8t A4 A4 F5/4 | A5/4. G5/8 F5/8t E5 D5 C#5/4 | ff D5+F#5/8 D5+F#5 F#5+A5/4 D5+F#5/8 F#5+A5 A5+D6/4 | D5+F#5+A5/1~ |',
    horn: '| r/1 | mf D4/8t D4 D4 F4/4 D4/8t D4 D4 A4/4 | F4/4. E4/8 D4/8t C#4 B3 A3/4 | f A4/8 A4 D5/4 A4/8 D5 F#5/4 | ff D4+A4/1~ |',
    trombone: '| r/1 | mf D3+A3/1 | Bb2+F3+D4/2 A2+E3+C#4/2 | f D3+A3/4> r D3+A3/4> r | ff D3+F#3+A3/1~ |',
    tuba: '| r/1 | mf D2/1 | Bb1/2 A1/2 | f D2/4> A1 D2 A1 | ff D2/1~ |',
    drums: '| pp sn/2.z mf sn/4> | sn/8t sn sn sn/4 sn/8t sn sn sn/4 | bd+sn/4> sn/8 sn bd+sn/4 sn/4 | f bd+cy/4> sn/8 sn bd+sn/4 sn/8 sn | ff bd+cy/1 |',
  } }],
};

/** Every piece by the file name the director uses. */
export const BOOK: Record<string, PieceDef> = {
  tank, 'tank-death': tankDeath, jeep, asv, 'asv-death': asvDeath, heli, 'heli-death': heliDeath,
  'flag-discovery': flagDiscovery, 'flag-pickup': flagPickup, win, bunker, death, sub, drums, fanfare,
};
