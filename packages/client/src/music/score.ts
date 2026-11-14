// A small text notation for writing the band arrangements, compiled to Standard MIDI Files (smf.ts). Each piece is
// a list of sections (which become MIDI markers, so the player can start or loop at one), and each section gives
// every part a line of notes:
//
//   C4 F#5 Bb3     a note: letter, optional # or b, octave (C4 is middle C, MIDI 60)
//   C4+E4+G4       a chord
//   r              a rest
//   bd sn ...      a drum (DRUMS below), in a part on the drum channel
//   /4 /8. /8t     its length: 1 whole, 2 half, 4 quarter, 8, 16, 32; "." dotted, "t" triplet; /2+8 adds them.
//                  A length carries on to the following notes until another is given.
//   '  >  ~  z     after the length: staccato, accent, held for its full length, or a roll (repeated 32nds)
//   pp p mp mf f ff  the loudness from here on
//   |              a bar line: every whole bar between two must fill the section's metre, which catches slips
//   ( ... )*3      a repeat
//
// The notation is ours; what it encodes is credited per piece in docs/music.md.

import { COPYRIGHT, MARKER, TRACK_NAME, type Smf, type TimedEvent } from './smf.js';

export const PPQ = 480;

export const DRUMS: Record<string, number> = {
  bd: 36, rim: 37, sn: 38, hh: 42, ph: 44, oh: 46, lt: 45, mt: 47, ht: 50, cy: 49, rc: 51, cy2: 57, tam: 52,
};

const DYNAMICS: Record<string, number> = { pp: 32, p: 48, mp: 64, mf: 80, f: 100, ff: 118 };
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface PartDef {
  name: string;
  /** MIDI channel 0-15; 9 is the drums. */
  ch: number;
  /** General MIDI program (0-127). */
  program: number;
  /** Channel volume (CC7), pan (CC10, 64 centre) and reverb send (CC91). */
  volume?: number;
  pan?: number;
  reverb?: number;
}

export interface SectionDef {
  name: string;
  /** Quarter notes per minute from this section on (the piece's tempo when left out). */
  bpm?: number;
  /** Time signature, as [beats, beat value]: [6, 8] is six eighths. Defaults to the piece's. */
  meter?: [number, number];
  /** Each part's line, by part name. A part left out rests. */
  parts: Record<string, string>;
}

export interface PieceDef {
  title: string;
  /** Who wrote the music the arrangement is of, and when; this goes into the file's copyright text. */
  credit: string;
  bpm: number;
  meter: [number, number];
  parts: PartDef[];
  sections: SectionDef[];
}

interface Note {
  at: number;
  len: number;
  /** Sounding length (staccato shortens it). */
  sound: number;
  keys: number[];
  vel: number;
  roll: boolean;
}

interface LineResult {
  notes: Note[];
  length: number;
}

/** MIDI number of a note name, or of a drum. */
export function pitch(name: string): number {
  const drum = DRUMS[name];
  if (drum !== undefined) return drum;
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`score: bad note "${name}"`);
  const n = (Number(m[3]) + 1) * 12 + LETTER[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  if (n < 0 || n > 127) throw new Error(`score: note "${name}" out of range`);
  return n;
}

/** Ticks in a length like "4", "8.", "8t" or "2+8". */
export function ticks(spec: string): number {
  let total = 0;
  for (const part of spec.split('+')) {
    const m = /^(1|2|4|8|16|32)(\.|t)?$/.exec(part);
    if (!m) throw new Error(`score: bad length "/${spec}"`);
    let t = (PPQ * 4) / Number(m[1]);
    if (m[2] === '.') t *= 1.5;
    if (m[2] === 't') t = (t * 2) / 3;
    total += t;
  }
  return total;
}

/** Expands ( ... )*n repeats. */
function expand(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t !== '(') {
      if (/^\)\*\d+$/.test(t)) throw new Error('score: unmatched ")"');
      out.push(t);
      continue;
    }
    let depth = 1;
    let j = i + 1;
    for (; j < tokens.length; j++) {
      if (tokens[j] === '(') depth++;
      else if (/^\)\*\d+$/.test(tokens[j]!) && --depth === 0) break;
    }
    if (j >= tokens.length) throw new Error('score: unmatched "("');
    const inner = expand(tokens.slice(i + 1, j));
    const n = Number(tokens[j]!.slice(2));
    for (let k = 0; k < n; k++) out.push(...inner);
    i = j;
  }
  return out;
}

/** Compiles one part's line in a section; bar is the metre's length in ticks. */
export function compileLine(line: string, bar: number): LineResult {
  const tokens = expand(line.trim().split(/\s+/).filter(Boolean));
  const notes: Note[] = [];
  let at = 0;
  let len = PPQ;
  let vel = DYNAMICS.mf!;
  let barStart: number | null = null;
  for (const tok of tokens) {
    if (tok === '|') {
      if (barStart !== null && at - barStart !== bar) {
        throw new Error(`score: bar at beat ${barStart / PPQ} lasts ${(at - barStart) / PPQ} beats, not ${bar / PPQ}`);
      }
      barStart = at;
      continue;
    }
    const dyn = DYNAMICS[tok];
    if (dyn !== undefined) {
      vel = dyn;
      continue;
    }
    const m = /^([^/'>~z]+)(?:\/([0-9.t+]+))?(['>~z]*)$/.exec(tok);
    if (!m) throw new Error(`score: bad token "${tok}"`);
    if (m[2]) len = ticks(m[2]);
    const marks = m[3] ?? '';
    if (m[1] !== 'r') {
      const keys = m[1]!.split('+').map(pitch);
      const sound = marks.includes("'") ? Math.round(len * 0.45) : marks.includes('~') ? len : Math.round(len * 0.92);
      notes.push({ at, len, sound, keys, vel: Math.min(127, vel + (marks.includes('>') ? 18 : 0)), roll: marks.includes('z') });
    }
    at += len;
  }
  return { notes, length: at };
}

/** Compiles a piece into a format-1 file: a conductor track (tempo, metre, markers) and a track per part. */
export function compile(piece: PieceDef): Smf {
  const conductor: TimedEvent[] = [
    { tick: 0, event: { kind: 'text', type: TRACK_NAME, text: piece.title } },
    { tick: 0, event: { kind: 'text', type: COPYRIGHT, text: `${piece.credit}. Arrangement CC0 1.0, Return Fire: Redux.` } },
  ];
  const tracks: TimedEvent[][] = piece.parts.map((p) => [
    { tick: 0, event: { kind: 'text', type: TRACK_NAME, text: p.name } },
    { tick: 0, event: { kind: 'control', ch: p.ch, controller: 0, value: 0 } },
    { tick: 0, event: { kind: 'program', ch: p.ch, program: p.program } },
    { tick: 0, event: { kind: 'control', ch: p.ch, controller: 7, value: p.volume ?? 100 } },
    { tick: 0, event: { kind: 'control', ch: p.ch, controller: 10, value: p.pan ?? 64 } },
    { tick: 0, event: { kind: 'control', ch: p.ch, controller: 91, value: p.reverb ?? 40 } },
  ]);
  const names = new Set(piece.parts.map((p) => p.name));
  let start = 0;
  let bpm = 0;
  let meter: [number, number] = [0, 0];
  for (const s of piece.sections) {
    for (const name of Object.keys(s.parts)) if (!names.has(name)) throw new Error(`score: "${piece.title}" has no part "${name}"`);
    const nextBpm = s.bpm ?? (start === 0 ? piece.bpm : bpm);
    const nextMeter = s.meter ?? (start === 0 ? piece.meter : meter);
    if (nextBpm !== bpm) conductor.push({ tick: start, event: { kind: 'tempo', usPerQuarter: Math.round(60e6 / nextBpm) } });
    if (nextMeter[0] !== meter[0] || nextMeter[1] !== meter[1]) {
      conductor.push({ tick: start, event: { kind: 'timeSignature', num: nextMeter[0], den: nextMeter[1] } });
    }
    bpm = nextBpm;
    meter = nextMeter;
    conductor.push({ tick: start, event: { kind: 'text', type: MARKER, text: s.name } });
    const bar = (nextMeter[0] * PPQ * 4) / nextMeter[1];
    let length = -1;
    piece.parts.forEach((p, i) => {
      const line = s.parts[p.name];
      if (line === undefined) return;
      let res: LineResult;
      try {
        res = compileLine(line, bar);
      } catch (err) {
        throw new Error(`${piece.title}, ${s.name}, ${p.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (length >= 0 && res.length !== length) {
        throw new Error(`${piece.title}, ${s.name}: ${p.name} lasts ${res.length / PPQ} beats, other parts ${length / PPQ}`);
      }
      length = res.length;
      for (const n of res.notes) place(tracks[i]!, p.ch, n, start);
    });
    start += Math.max(0, length);
  }
  conductor.push({ tick: start, event: { kind: 'endOfTrack' } });
  for (const t of tracks) {
    t.sort((a, b) => a.tick - b.tick || order(a) - order(b));
    t.push({ tick: start, event: { kind: 'endOfTrack' } });
  }
  return { format: 1, division: PPQ, tracks: [conductor, ...tracks] };
}

/** Within a tick, note-offs go before note-ons, so a repeated note is not cut short. */
const order = (e: TimedEvent) => (e.event.kind === 'noteOff' ? 0 : e.event.kind === 'noteOn' ? 2 : 1);

function place(track: TimedEvent[], ch: number, n: Note, start: number): void {
  const hits: [number, number, number][] = [];
  if (n.roll) {
    const step = PPQ / 8;
    for (let t = 0; t < n.len; t += step) hits.push([t, Math.min(step - 10, n.len - t), t === 0 ? n.vel : Math.round(n.vel * 0.8)]);
  } else hits.push([0, n.sound, n.vel]);
  for (const [off, len, vel] of hits) {
    for (const key of n.keys) {
      track.push({ tick: start + n.at + off, event: { kind: 'noteOn', ch, note: key, vel } });
      track.push({ tick: start + n.at + off + Math.max(1, len), event: { kind: 'noteOff', ch, note: key, vel: 64 } });
    }
  }
}
