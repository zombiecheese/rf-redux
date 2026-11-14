// The modern view's soundtrack: original hardcore, beatdown and metalcore instrumentals, one piece for each file
// name the music director asks for (director.ts), so the same director drives it as drives the band book. Two
// double-tracked rhythm guitars in drop C (open and palm-muted on their own channels), a pick bass, a lead guitar,
// a pad, an 808 sub for the drops and a metal kit, all played by the built-in synthesiser's modern rig (synth.ts).
// Every note here was written for this project and is released under CC0 (docs/music.md).

import { pitch, PPQ, ticks, type PartDef, type PieceDef, type SectionDef } from './score.js';

// ---- The band ----------------------------------------------------------------------------------------------------

const GTR_L: PartDef = { name: 'gtrL', ch: 0, program: 30, volume: 104, pan: 12, reverb: 14 };
const GTR_R: PartDef = { name: 'gtrR', ch: 1, program: 30, volume: 104, pan: 116, reverb: 14 };
const MUTE_L: PartDef = { name: 'muteL', ch: 2, program: 28, volume: 108, pan: 16, reverb: 8 };
const MUTE_R: PartDef = { name: 'muteR', ch: 3, program: 28, volume: 108, pan: 112, reverb: 8 };
const BASS: PartDef = { name: 'bass', ch: 4, program: 34, volume: 108, pan: 64, reverb: 4 };
const LEAD: PartDef = { name: 'lead', ch: 5, program: 29, volume: 92, pan: 70, reverb: 70 };
const PAD: PartDef = { name: 'pad', ch: 6, program: 89, volume: 72, pan: 64, reverb: 100 };
const SUB: PartDef = { name: 'sub', ch: 7, program: 38, volume: 112, pan: 64, reverb: 0 };
const CLEAN: PartDef = { name: 'clean', ch: 8, program: 27, volume: 88, pan: 44, reverb: 95 };
/** Drum-channel program 16 is the synthesiser's Power kit. */
const KIT: PartDef = { name: 'drums', ch: 9, program: 16, volume: 112, pan: 64, reverb: 22 };

const RHYTHM = [GTR_L, GTR_R, MUTE_L, MUTE_R, BASS];
const DYNAMICS = new Set(['pp', 'p', 'mp', 'mf', 'f', 'ff']);
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const nm = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

// ---- Riffs -------------------------------------------------------------------------------------------------------
// A riff is written once and becomes the lines of both rhythm guitars, their palm mutes and the bass:
//   C2/8     an open power chord on that root (root, fifth, octave)
//   C2:b5/4  the root and its flat fifth;  C2:o  root and octave;  C2:1  the root alone
//   c2/16    lower case: a palm-muted chug on that note
//   r/8      a rest;  | bar lines, pp ... ff and the marks ' > ~ as in score.ts
// Lengths carry on, as in score.ts.

interface Hit {
  at: number;
  len: number;
  /** The token's length spec, and its marks. */
  spec: string;
  marks: string;
  kind: 'open' | 'mute' | 'rest';
  keys: number[];
}

type Item = Hit | string;

function parseRiff(line: string): Item[] {
  line = tidy(line);
  const out: Item[] = [];
  let at = 0;
  let spec = '4';
  for (const tok of line.trim().split(/\s+/).filter(Boolean)) {
    if (tok === '|' || DYNAMICS.has(tok)) {
      out.push(tok);
      continue;
    }
    const m = /^([A-Ga-g][#b]?-?\d|r)(?::(b5|o|1))?(?:\/([0-9.t+]+))?(['>~]*)$/.exec(tok);
    if (!m) throw new Error(`riff: bad token "${tok}"`);
    if (m[3]) spec = m[3];
    const len = ticks(spec);
    if (m[1] === 'r') out.push({ at, len, spec, marks: m[4] ?? '', kind: 'rest', keys: [] });
    else {
      const muted = m[1]![0] === m[1]![0]!.toLowerCase();
      const root = pitch(m[1]![0]!.toUpperCase() + m[1]!.slice(1));
      const shape = m[2] ?? (muted ? '1' : '5');
      const keys = shape === '1' ? [root] : shape === 'o' ? [root, root + 12] : shape === 'b5' ? [root, root + 6] : [root, root + 7, root + 12];
      out.push({ at, len, spec, marks: m[4] ?? '', kind: muted ? 'mute' : 'open', keys });
    }
    at += len;
  }
  return out;
}

const rest = (h: Hit) => `r/${h.spec}`;
const chord = (keys: number[], h: Hit, marks = h.marks) => `${keys.map(nm).join('+')}/${h.spec}${marks}`;

/** A riff as the lines of the rhythm section: both guitars, both palm-muted guitars and the bass. */
function riff(line: string): Record<string, string> {
  const items = parseRiff(line);
  const map = (f: (h: Hit) => string) => items.map((i) => (typeof i === 'string' ? i : f(i))).join(' ');
  const gtr = map((h) => (h.kind === 'open' ? chord(h.keys, h) : rest(h)));
  const mute = map((h) => (h.kind === 'mute' ? chord(h.keys, h) : rest(h)));
  const bass = map((h) => (h.kind === 'rest' ? rest(h) : chord([h.keys[0]! - 12], h, h.kind === 'mute' ? `${h.marks.replace("'", '')}'` : h.marks)));
  return { gtrL: gtr, gtrR: gtr, muteL: mute, muteR: mute, bass };
}

/**
 * Drums that lock to a riff, the way a breakdown is played: a kick under every hit, the snare on the given beats
 * (in place of the kick), and a cymbal on every beat a hit or rest starts on. The first hit gets a crash.
 */
function lock(line: string, o: { snare: number[]; top: string; every?: number; crash?: boolean }): string {
  const every = o.every ?? PPQ;
  let first = o.crash ?? true;
  const items = parseRiff(line);
  // Bar lengths are found from the bar lines, so snares land on beats within each bar.
  let barStart = 0;
  return items.map((i) => {
    if (typeof i === 'string') {
      if (i === '|') barStart = -1;
      return i;
    }
    if (barStart < 0) barStart = i.at;
    const pos = i.at - barStart;
    const onBeat = pos % every === 0;
    // A long rest is a stop (the mosh call before the drop): the kit holds off too.
    const snare = o.snare.some((b) => pos === b * PPQ) && (i.kind !== 'rest' || i.len < 2 * PPQ);
    const parts: string[] = [];
    if (snare) parts.push('sn');
    else if (i.kind !== 'rest') parts.push('bd');
    if (first && parts.length) {
      parts.push('cy');
      first = false;
    } else if (onBeat) parts.push(o.top);
    return parts.length ? `${parts.join('+')}/${i.spec}${snare || i.marks.includes('>') ? '>' : ''}` : `r/${i.spec}`;
  }).join(' ');
}

/** n copies of a bar or run of bars, bar lines between. */
const rep = (n: number, ...bars: string[]) => `| ${Array.from({ length: n }, () => bars.join(' | ')).join(' | ')} |`;
const join = (...bars: string[]) => `| ${bars.join(' | ')} |`;

/** Joins line pieces: doubled bar lines, and a loudness between two bar lines, fold into one. */
const tidy = (line: string) => line.replace(/\|\s*(pp|p|mp|mf|f|ff)\s*\|/g, '| $1').replace(/\|(\s*\|)+/g, '|');

/** Merges part lines. */
const with_ = (...lines: Record<string, string>[]) =>
  Object.fromEntries(Object.entries(Object.assign({}, ...lines) as Record<string, string>).map(([k, v]) => [k, tidy(v)]));

/** A rhythm part with a crash on its first beat. */
const crashOn = (line: string) => line.replace(/^(\|\s*(?:pp|p|mp|mf|f|ff)?\s*)(bd|sn)\+(hh|rc|cn)/, '$1$2+cy');

// ---- Tank: "Iron Lung" -------------------------------------------------------------------------------------------
// Metalcore in three parts, as the band book's tank suite has: a stomping groove (Tank 1), a thrashing d-beat
// (Tank 2) and, with the flag in danger, the breakdown (Tank 3).

const T_A1 = 'c2/16 c2 C2/8 c2/16 c2 Eb2/8 c2/16 c2 c2 c2 D2/8 Db2/8';
const T_A2 = 'c2/16 c2 C2/8 c2/16 c2 F2/8 c2/16 c2 Gb2/8 F2/8 Eb2/8';
const T_A3 = 'c2/16 c2 C2/8 c2/16 c2 Eb2/8 Db2/4 C2:b5/4';
const T_B1 = 'c2/16 c2 c2 c2 Eb2/8 c2/16 c2 c2 c2 c2 c2 F2/8 Gb2/8';
const T_B2 = 'c2/16 c2 c2 c2 Ab2/8 c2/16 c2 c2 c2 G2/8 c2/16 c2 Gb2/8';
const T_C1 = "C2/8> r/16 c2 r/8 c2/16 c2 r/8 c2/8 r/16 c2 Db2/8>";
const T_C2 = "C2/8> r/16 c2 r/8 c2/16 c2 F#2:b5/4> G2:b5/4>";
const DBEAT = 'bd+rc/8 bd+rc sn+rc> rc bd+rc bd+rc sn+rc> rc';

const tankA = `f ${rep(2, T_A1, T_A2, T_A1, T_A3)}`;
const tankB = `f ${rep(4, T_B1, T_B2)}`;
const tankC = `ff ${rep(2, T_C1, T_C1, T_C1, T_C2)}`;

const tank: PieceDef = {
  title: 'Iron Lung', credit: 'Original, Return Fire: Redux, 2026', bpm: 150, meter: [4, 4],
  parts: [...RHYTHM, LEAD, SUB, KIT],
  sections: [
    { name: 'a', parts: with_(riff(tankA), { drums: lock(tankA, { snare: [1, 3], top: 'hh', every: PPQ / 2 }) }) },
    { name: 'b', parts: with_(riff(tankB), { drums: `f ${crashOn(rep(8, DBEAT))}` }) },
    { name: 'c', parts: with_(riff(tankC), {
      drums: lock(tankC, { snare: [2], top: 'cn' }),
      sub: `| ${['C2/1', 'r/1', 'r/1', 'r/1', 'C2/1', 'r/1', 'r/1', 'r/1'].join(' | ')} |`,
      lead: `mf ${rep(2, 'r/1', 'r/1', 'r/1', 'r/2 G5/4 F#5/4~')}`,
    }) },
  ],
};

// ---- Jeep: "Two-Step Getaway" ------------------------------------------------------------------------------------
// Fast hardcore punk for the fastest thing on the island, then a two-step.

const J1 = 'C2/8 C2 Eb2 C2 F2/4 Eb2/8 Db2';
const J2 = 'C2/8 C2 Eb2 C2 G2/4 F2/8 F#2';
const J3 = 'Ab2/4 G2 F2/8 Eb2 F2/4';
const J4 = 'Ab2/4 G2 Bb2/8 Ab2 G2/4';
const PUNK = 'bd+hh/8 hh sn+hh> hh bd+hh bd+hh sn+hh> hh';
const TWO_STEP = 'bd+rc/8 rc sn+rc> rc bd+rc rc sn+rc> bd+rc';

const jeep: PieceDef = {
  title: 'Two-Step Getaway', credit: 'Original, Return Fire: Redux, 2026', bpm: 200, meter: [4, 4],
  parts: [...RHYTHM, KIT],
  sections: [
    { name: 'a', parts: with_(riff(`f ${rep(4, J1, J2)}`), { drums: `f ${crashOn(rep(8, PUNK))}` }) },
    { name: 'b', parts: with_(riff(`f ${rep(4, J3, J4)}`), { drums: `f ${crashOn(rep(8, TWO_STEP))}` }) },
  ],
};

// ---- MSV: "Slow Payload" -----------------------------------------------------------------------------------------
// Beatdown for the missile launcher: a swung chug riff, then a slam half again as slow with the sub dropping.

const A1 = 'c2/16 c2 r/8 C2/8 r/16 c2 c2/16 r/16 c2/8 Db2/4>';
const A2 = 'c2/16 c2 r/8 C2/8 r/16 c2 Eb2:b5/4> D2:b5/4>';
const A3 = 'C2/4> r/8 c2/16 c2 C2:b5/4. r/8';
const A4 = 'C2/8> c2/16 c2 c2/8 c2/16 c2 Db2/2>';
const asvA = `f ${rep(4, A1, A2)}`;
const asvB = `ff ${rep(2, A3, A4)}`;

const asv: PieceDef = {
  title: 'Slow Payload', credit: 'Original, Return Fire: Redux, 2026', bpm: 92, meter: [4, 4],
  parts: [...RHYTHM, SUB, KIT],
  sections: [
    { name: 'a', parts: with_(riff(asvA), { drums: lock(asvA, { snare: [2], top: 'cn' }) }) },
    { name: 'b', bpm: 76, parts: with_(riff(asvB), {
      drums: lock(asvB, { snare: [2], top: 'cn' }),
      sub: '| C2/1 | r/1 | C2/1 | r/1 |',
    }) },
  ],
};

// A falling run of open chords, toms tumbling after it.
const asvDeath: PieceDef = {
  title: 'Payload Lost', credit: 'Original, Return Fire: Redux, 2026', bpm: 96, meter: [4, 4],
  parts: [...RHYTHM, SUB, KIT],
  sections: [{ name: 'a', parts: with_(riff('ff | Eb2/4> D2> Db2> C2> | C2:b5/1~ |'), {
    drums: '| bd+cy/4> bd+cy> bd+cy> bd+cy> | ht/16 ht mt mt lt lt ft ft bd+cy/2 |',
    sub: '| r/1 | C2/1 |',
  }) }],
};

// ---- Helicopter: "Rotorblade" --------------------------------------------------------------------------------
// Melodic metalcore: a galloping verse under a lead line, then a half-time chorus with the lead up high.

const gallop = (root: string) => {
  const mute = root[0]!.toLowerCase() + root.slice(1);
  return Array.from({ length: 4 }, () => `${root}/8 ${mute}/16 ${mute}`).join(' ');
};
const halftime = (root: string) => {
  const mute = root[0]!.toLowerCase() + root.slice(1);
  return `${root}/4.> ${mute}/16 ${mute} ${root}/4> ${mute}/8 ${mute}`;
};
const HELI_LEAD_A = join('G4/4 C5 Eb5 D5', 'C5/4. Bb4/8 Ab4/2', 'G4/4 Bb4 Eb5 F5', 'D5/2. Bb4/4',
  'G4/4 C5 Eb5 G5', 'F5/4. Eb5/8 C5/2', 'Bb4/4 C5 D5 Eb5', 'F5/2 G5/2');
const heliA = `f ${rep(2, gallop('C2'), gallop('Ab2'), gallop('Eb2'), gallop('Bb2'))}`;
const heliB = `ff ${rep(2, halftime('Ab2'), halftime('Bb2'), halftime('C2'), halftime('C2'))}`;

const heli: PieceDef = {
  title: 'Rotorblade', credit: 'Original, Return Fire: Redux, 2026', bpm: 170, meter: [4, 4],
  parts: [...RHYTHM, LEAD, PAD, KIT],
  sections: [
    { name: 'a', parts: with_(riff(heliA), {
      lead: `f ${HELI_LEAD_A}`,
      drums: `f ${crashOn(rep(8, 'bd+rc/8 bd+rc sn+rc> bd+rc bd+rc bd+rc sn+rc> bd+rc'))}`,
    }) },
    { name: 'b', parts: with_(riff(heliB), {
      lead: `ff ${join('C6/1', 'D6/1', 'Eb6/2 D6/2', 'C6/2 G5/2', 'C6/1', 'D6/1', 'Eb6/2 F6/4 Eb6', 'D6/2 C6/2')}`,
      pad: `p ${rep(2, 'Ab3+C4+Eb4/1', 'Bb3+D4+F4/1', 'C4+Eb4+G4/1', 'C4+Eb4+G4/1')}`,
      drums: lock(heliB, { snare: [2], top: 'cn' }),
    }) },
  ],
};

// The lead dives the length of the neck as the helicopter goes down.
const heliDeath: PieceDef = {
  title: 'Autorotation', credit: 'Original, Return Fire: Redux, 2026', bpm: 120, meter: [4, 4],
  parts: [...RHYTHM, LEAD, SUB, KIT],
  sections: [{ name: 'a', parts: with_(riff('| r/1 | ff C2/1~ |'), {
    lead: 'ff | C6/16 B5 Bb5 A5 Ab5 G5 F#5 F5 E5 Eb5 D5 Db5 C5 B4 Bb4 A4 | Ab4/1~ |',
    drums: '| ht/16 ht ht ht mt mt mt mt lt lt lt lt ft ft ft ft | bd+cy/1 |',
    sub: '| r/1 | C2/1 |',
  }) }],
};

// ---- Tank death: "Last Rites" ------------------------------------------------------------------------------------

const tankDeath: PieceDef = {
  title: 'Last Rites', credit: 'Original, Return Fire: Redux, 2026', bpm: 70, meter: [4, 4],
  parts: [...RHYTHM, PAD, SUB, KIT],
  sections: [{ name: 'a', parts: with_(riff('ff | C2/1~ | F#2:b5/1~ |'), {
    pad: 'mp | C4+Eb4+G4/1 | C4+F#4+A4/1~ |',
    sub: '| C2/1 | C2/1 |',
    drums: '| bd+cy/1 | bd+cn/1 |',
  }) }],
};

// ---- Death: "Flatline" -------------------------------------------------------------------------------------------
// A clean guitar falls through C minor, and the band lands one last chord.

const death: PieceDef = {
  title: 'Flatline', credit: 'Original, Return Fire: Redux, 2026', bpm: 64, meter: [4, 4],
  parts: [...RHYTHM, CLEAN, PAD, SUB, KIT],
  sections: [{ name: 'a', parts: with_(riff('| r/1 | r/1 | r/1 | ff C2/1~ |'), {
    clean: `mf ${join('C4/8 G4 Eb5 G4 C5 G4 Eb5 G4', 'Ab3/8 Eb4 C5 Eb4 Ab4 Eb4 C5 Eb4', 'G3/8 D4 B4 D4 G4 D4 B4 D4', 'C4+G4+Eb5/1~')}`,
    pad: 'pp | C4+Eb4+G4/1 | Ab3+C4+Eb4/1 | G3+B3+D4/1 | C4+Eb4+G4/1~ |',
    sub: '| r/1 | r/1 | r/1 | C2/1 |',
    drums: '| r/1 | r/1 | r/2 ft/16 ft lt lt mt mt ht ht | bd+cy/1 |',
  }) }],
};

// ---- Flag discovery: "Spotted" -----------------------------------------------------------------------------------

const flagDiscovery: PieceDef = {
  title: 'Spotted', credit: 'Original, Return Fire: Redux, 2026', bpm: 160, meter: [4, 4],
  parts: [...RHYTHM, KIT],
  sections: [{ name: 'a', parts: with_(riff('ff | C2/8> C2> r/4 Eb2/8> Eb2> r/4 | F#2:b5/2~ G2:b5/2~ |'), {
    drums: '| bd+cy/8> bd+cy> r/4 bd+cy/8> bd+cy> sn/16 sn sn sn | bd+cy/2 sn/16 sn sn sn ht ht mt mt |',
  }) }],
};

// ---- Flag pickup: "Run It Home" ----------------------------------------------------------------------------------
// The flag is out: blast beats under a tremolo riff and a call on the lead, then stomps for the run home.

const tremolo = (root: string, n: number) => Array.from({ length: n }, () => `${root}/16`).join(' ');
const P1 = `${tremolo('C2', 8)} ${tremolo('Db2', 4)} ${tremolo('Eb2', 2)} ${tremolo('D2', 2)}`;
const P2 = `${tremolo('C2', 8)} ${tremolo('Ab2', 4)} ${tremolo('G2', 4)}`;
const P3 = 'C2/4> r/4 C2/4> r/8 c2/16 c2';
const P4 = 'Eb2/4> r/4 D2/4> Db2/4>';
const pickB = `ff ${rep(4, P3, P4)}`;

const flagPickup: PieceDef = {
  title: 'Run It Home', credit: 'Original, Return Fire: Redux, 2026', bpm: 180, meter: [4, 4],
  parts: [...RHYTHM, LEAD, KIT],
  sections: [
    { name: 'a', parts: with_(riff(`f ${rep(4, P1, P2)}`), {
      lead: `f ${rep(2, 'G4/8 G4 C5/4 G4/8 C5 Eb5/4', 'D5/8 C5 Bb4/4 C5/2', 'G4/8 G4 C5/4 G4/8 C5 G5/4', 'F5/8 Eb5 D5/4 Eb5/2')}`,
      drums: `f ${rep(8, '( bd+cy/16 sn )*8')}`,
    }) },
    { name: 'b', parts: with_(riff(pickB), { drums: lock(pickB, { snare: [1, 3], top: 'cn' }) }) },
  ],
};

// ---- Win: "Last Base Standing" -----------------------------------------------------------------------------------

const winHymn = `f ${rep(2, 'Ab2/8 ab2/16 ab2 Ab2/8 ab2/16 ab2 Ab2/8 ab2/16 ab2 Ab2/8 ab2/16 ab2',
  'Bb2/8 bb2/16 bb2 Bb2/8 bb2/16 bb2 Bb2/8 bb2/16 bb2 Bb2/8 bb2/16 bb2',
  'C2/8 c2/16 c2 C2/8 c2/16 c2 C2/8 c2/16 c2 C2/8 c2/16 c2',
  'C2/2 Eb2/4 G2/4')}`;
const win: PieceDef = {
  title: 'Last Base Standing', credit: 'Original, Return Fire: Redux, 2026', bpm: 140, meter: [4, 4],
  parts: [...RHYTHM, LEAD, PAD, SUB, KIT],
  sections: [
    { name: 'intro', parts: with_(riff('ff | r/1 | C2/1~ |'), {
      drums: '| sn/16 sn sn sn sn sn sn sn ht ht ht ht ft ft ft ft | bd+cy/1 |',
      sub: '| r/1 | C2/1 |',
    }) },
    { name: 'anthem', parts: with_(riff(winHymn), {
      lead: `ff ${join('C5/4 D5 Eb5 G5', 'F5/4. Eb5/8 D5/2', 'Eb5/4 F5 G5 Bb5', 'C6/1', 'C5/4 D5 Eb5 G5', 'Ab5/4. G5/8 F5/2', 'G5/4 Bb5 C6 D6', 'C6/1')}`,
      pad: `mp ${rep(2, 'Ab3+C4+Eb4/1', 'Bb3+D4+F4/1', 'C4+E4+G4/1', 'C4+E4+G4/1')}`,
      drums: `f ${crashOn(rep(8, 'bd+rc/8 bd+rc sn+rc> bd+rc bd+rc bd+rc sn+rc> bd+rc'))}`,
    }) },
    { name: 'end', parts: with_(riff('ff | C2:o/1~ |'), {
      lead: 'ff | C6/1~ |',
      pad: 'mf | C4+E4+G4/1~ |',
      drums: '| bd+cy/1 |',
    }) },
  ],
};

// ---- Bunker: "Holding Pattern" -----------------------------------------------------------------------------------
// Clean guitar and pad in the lift bay, the kit on rims and hats, palm mutes creeping in the second time round.

const BUNKER_CLEAN = join('C4/8 G4 Eb5 G4 D5 G4 Eb5 G4', 'Ab3/8 Eb4 C5 Eb4 Bb4 Eb4 C5 Eb4', 'Eb4/8 Bb4 G5 Bb4 F5 Bb4 G5 Bb4', 'Bb3/8 F4 D5 F4 C5 F4 D5 F4');
const bunker: PieceDef = {
  title: 'Holding Pattern', credit: 'Original, Return Fire: Redux, 2026', bpm: 76, meter: [4, 4],
  parts: [...RHYTHM, CLEAN, PAD, KIT],
  sections: [{ name: 'a', parts: with_(riff(`p ${rep(4, 'r/1')} mp ${rep(1, 'c2/8 r/8 c2/16 c2 r/8 c2/8 r/8 c2/16 c2 r/8', 'ab2/8 r/8 ab2/16 ab2 r/8 ab2/8 r/8 ab2/16 ab2 r/8', 'eb2/8 r/8 eb2/16 eb2 r/8 eb2/8 r/8 eb2/16 eb2 r/8', 'bb2/8 r/8 bb2/16 bb2 r/8 bb2/8 r/8 Bb2:o/4~')}`), {
    clean: `mp ${BUNKER_CLEAN} ${BUNKER_CLEAN}`,
    pad: `pp ${rep(2, 'C4+Eb4+G4/1', 'Ab3+C4+Eb4/1', 'Bb3+Eb4+G4/1', 'Bb3+D4+F4/1')}`,
    drums: `pp ${rep(4, 'bd/8 hh rim hh bd bd rim hh')} p ${rep(4, 'bd/8 hh sn hh bd bd sn hh')}`,
  }) }],
};

// ---- Submarine: "Pressure Hull" ----------------------------------------------------------------------------------

const sub: PieceDef = {
  title: 'Pressure Hull', credit: 'Original, Return Fire: Redux, 2026', bpm: 60, meter: [4, 4],
  parts: [...RHYTHM, LEAD, PAD, KIT],
  sections: [{ name: 'a', parts: with_(riff('f | C2/1~ | Db2/1~ | Eb2/2 D2/2 | C2/1~ |'), {
    lead: 'mp | C6/4 r/4 r/2 | C6/4 r/4 r/2 | C6/4 r/4 r/2 | C6/4 r/4 r/2 |',
    pad: 'p | C3+G3+C4/1 | Db3+Ab3+Db4/1 | Eb3+Bb3/2 D3+A3/2 | C3+G3+C4/1~ |',
    drums: '| bd+cn/2 sn/2> | bd+cn/2 sn/2> | bd+cn/2 sn/2> | bd+cy/1 |',
  }) }],
};

// ---- Menus: "Warm-Up" --------------------------------------------------------------------------------------------
// A mid-tempo hardcore groove for the menus: the kit leads, the bass and palm mutes keep it moving.

const MENU = ['c2/8 r/16 c2 r/8 c2/8 eb2/8 r/16 eb2 f2/8 eb2/8', 'c2/8 r/16 c2 r/8 c2/8 gb2/8 f2/8 eb2/8 db2/8'];
const menuLoop = `mp ${rep(4, ...MENU)}`;
const drums: PieceDef = {
  title: 'Warm-Up', credit: 'Original, Return Fire: Redux, 2026', bpm: 112, meter: [4, 4],
  parts: [...RHYTHM, KIT],
  sections: [
    { name: 'intro', parts: { drums: 'f | sn/16 sn sn sn sn sn sn sn sn sn sn sn ht ht ft ft | sn/2. bd+cy/4> |' } },
    { name: 'loop', parts: with_(riff(menuLoop), { drums: `mf ${crashOn(rep(4, 'bd+hh/8 hh sn+hh> bd+hh r/8 bd+hh sn+hh> hh', 'bd+hh/8 hh sn+hh> bd+hh bd+hh hh sn+hh> oh'))}` }) },
  ],
};

// ---- Breakdowns ---------------------------------------------------------------------------------------------------
// Every piece gets a hardcore breakdown: the tempo drops, the kit goes half-time on the china with the kick locked to
// the chugs, the sub drops under the first hit, and a stop (the mosh call) sets up the last drop.

const BD_A = 'C2/8> r/8 c2/16 c2 r/8 C2/8> r/8 c2/16 c2 c2/8';
const BD_B = 'C2/8> r/8 c2/16 c2 r/8 Db2:b5/4> r/4';
const BD_C = 'C2/8t> C2> C2> r/4 c2/16 c2 r/8 F#2:b5/4>';
const BD_D = 'C2/4> r/4 r/2';
const BD_E = 'C2/4.> c2/16 c2 Db2/4.> c2/16 c2';
const BD_F = 'c2/16 c2 c2 c2 C2/8> r/8 c2/16 c2 c2 c2 Eb2:b5/8> D2:b5/8>';
const BD_G = 'C2/8> c2/16 c2 r/8 c2/16 c2 G2:b5/4> F#2:b5/4>';

/**
 * A breakdown section: its bars of riff, the bars the sub drops on, and its tempo. A lead line can ride on top.
 */
function breakdown(name: string, bpm: number, barsOf: string[], drops: number[], extra: Record<string, string> = {}): SectionDef {
  const line = `ff ${join(...barsOf)}`;
  return { name, bpm, parts: with_(riff(line), {
    drums: lock(line, { snare: [2], top: 'cn' }),
    sub: join(...barsOf.map((_, i) => (drops.includes(i) ? 'C2/1' : 'r/1'))),
  }, extra) };
}

/** Adds a section to a piece (before another, or at the end), giving the piece a sub if it has none. */
function add(piece: PieceDef, section: SectionDef, before?: string): void {
  if (!piece.parts.some((p) => p.name === 'sub')) piece.parts.push(SUB);
  const at = before ? piece.sections.findIndex((x) => x.name === before) : -1;
  if (at >= 0) piece.sections.splice(at, 0, section);
  else piece.sections.push(section);
}

const BIG = [BD_A, BD_B, BD_A, BD_D, BD_E, BD_F, BD_C, BD_D];
add(tank, breakdown('d', 130, BIG, [0, 4]));
add(jeep, breakdown('c', 150, [BD_A, BD_B, BD_A, BD_G, BD_A, BD_B, BD_C, BD_D], [0, 4]));
add(asv, breakdown('c', 68, [BD_E, BD_C, BD_E, BD_D, BD_F, BD_G, BD_C, BD_D], [0, 4]));
add(heli, breakdown('c', 128, BIG, [0, 4], { lead: `f ${join('r/1', 'r/1', 'r/1', 'r/2 G5/4 F#5/4~', 'r/1', 'r/1', 'r/1', 'r/2 Db6/4 C6/4~')}` }));
add(flagPickup, breakdown('c', 140, [BD_F, BD_B, BD_F, BD_D, BD_A, BD_G, BD_C, BD_D], [0, 4]));
add(win, breakdown('breakdown', 120, [BD_A, BD_B, BD_C, BD_D], [0]), 'end');
add(bunker, breakdown('b', 76, [BD_E, BD_B, BD_E, BD_D], [0], { pad: `pp ${join('C4+Eb4+G4/1', 'Ab3+C4+Eb4/1', 'C4+Eb4+G4/1', 'C4+Eb4+G4/1')}` }));
add(sub, breakdown('b', 60, [BD_E, BD_C], [0]));
add(drums, breakdown('breakdown', 112, [BD_A, BD_B, BD_A, BD_D], [0]));
// The stings end on a two-bar breakdown hit.
const STING = [BD_C, 'C2:b5/1~'];
for (const piece of [tankDeath, asvDeath, heliDeath, flagDiscovery]) add(piece, breakdown('breakdown', 120, STING, [0]));
add(death, breakdown('breakdown', 120, STING, [0]));

/** The modern soundtrack, by the file name the director uses. The splash's fanfare is the band book's. */
export const MODERN_BOOK: Record<string, PieceDef> = {
  tank, 'tank-death': tankDeath, jeep, asv, 'asv-death': asvDeath, heli, 'heli-death': heliDeath,
  'flag-discovery': flagDiscovery, 'flag-pickup': flagPickup, win, bunker, death, sub, drums,
};
