// Standard MIDI Files: reading (formats 0 and 1, running status, metrical time) into absolute-tick events, writing
// them back, and laying a file out in seconds through its tempo map. The music player plays any file this reads,
// so a piece can be swapped for another .mid without code.

export type MidiEvent =
  | { kind: 'noteOn'; ch: number; note: number; vel: number }
  | { kind: 'noteOff'; ch: number; note: number; vel: number }
  | { kind: 'keyPressure'; ch: number; note: number; value: number }
  | { kind: 'control'; ch: number; controller: number; value: number }
  | { kind: 'program'; ch: number; program: number }
  | { kind: 'channelPressure'; ch: number; value: number }
  /** -8192 to 8191. */
  | { kind: 'pitchBend'; ch: number; value: number }
  | { kind: 'tempo'; usPerQuarter: number }
  | { kind: 'timeSignature'; num: number; den: number }
  /** Meta text events: 1 text, 2 copyright, 3 track name, 4 instrument, 5 lyric, 6 marker, 7 cue point. */
  | { kind: 'text'; type: number; text: string }
  | { kind: 'sysex'; data: Uint8Array }
  | { kind: 'meta'; type: number; data: Uint8Array }
  | { kind: 'endOfTrack' };

export interface TimedEvent {
  tick: number;
  event: MidiEvent;
}

export interface Smf {
  format: 0 | 1;
  /** Ticks per quarter note. */
  division: number;
  tracks: TimedEvent[][];
}

/** Text meta type of a marker, which the player uses to name a file's sections. */
export const MARKER = 6;
export const TRACK_NAME = 3;
export const COPYRIGHT = 2;

class Reader {
  pos = 0;
  constructor(readonly b: Uint8Array, readonly end = b.length) {}
  u8(): number {
    if (this.pos >= this.end) throw new Error('MIDI: unexpected end of data');
    return this.b[this.pos++]!;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u16() << 16) | this.u16()) >>> 0;
  }
  vlq(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.u8();
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new Error('MIDI: variable-length number too long');
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.end) throw new Error('MIDI: unexpected end of data');
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  tag(): string {
    return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8());
  }
}

const latin1 = (d: Uint8Array) => String.fromCharCode(...d);

export function readSmf(data: ArrayBuffer | Uint8Array): Smf {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(b);
  // RIFF-wrapped MIDI (.rmi) holds a plain file in its "data" chunk.
  if (r.tag() === 'RIFF') {
    r.u32();
    if (r.tag() !== 'RMID') throw new Error('MIDI: not a MIDI file');
    while (r.pos < b.length) {
      const id = r.tag();
      const len = r.u32() >>> 0;
      const le = ((len & 0xff) << 24) | ((len >> 8 & 0xff) << 16) | ((len >> 16 & 0xff) << 8) | (len >>> 24);
      if (id === 'data') return readSmf(r.bytes(le >>> 0));
      r.pos += le + (le & 1);
    }
    throw new Error('MIDI: no data chunk');
  }
  r.pos = 0;
  if (r.tag() !== 'MThd') throw new Error('MIDI: not a MIDI file');
  const hlen = r.u32();
  const format = r.u16();
  const ntrks = r.u16();
  const division = r.u16();
  r.pos += hlen - 6;
  if (format > 1) throw new Error(`MIDI: format ${format} files are not supported`);
  if (division & 0x8000) throw new Error('MIDI: SMPTE time is not supported');
  const tracks: TimedEvent[][] = [];
  while (tracks.length < ntrks && r.pos + 8 <= b.length) {
    const id = r.tag();
    const len = r.u32();
    if (id !== 'MTrk') {
      r.pos += len;
      continue;
    }
    tracks.push(readTrack(new Reader(b, Math.min(b.length, r.pos + len)), r.pos));
    r.pos += len;
  }
  return { format: format as 0 | 1, division, tracks };
}

function readTrack(r: Reader, start: number): TimedEvent[] {
  r.pos = start;
  const out: TimedEvent[] = [];
  let tick = 0;
  let status = 0;
  while (r.pos < r.end) {
    tick += r.vlq();
    let s = r.b[r.pos]!;
    if (s & 0x80) r.pos++;
    else if (status) s = status;
    else throw new Error('MIDI: running status with no status');
    let event: MidiEvent;
    if (s === 0xff) {
      const type = r.u8();
      const d = r.bytes(r.vlq());
      if (type === 0x2f) {
        out.push({ tick, event: { kind: 'endOfTrack' } });
        break;
      }
      if (type === 0x51 && d.length === 3) event = { kind: 'tempo', usPerQuarter: (d[0]! << 16) | (d[1]! << 8) | d[2]! };
      else if (type === 0x58 && d.length >= 2) event = { kind: 'timeSignature', num: d[0]!, den: 2 ** d[1]! };
      else if (type >= 1 && type <= 7) event = { kind: 'text', type, text: latin1(d) };
      else event = { kind: 'meta', type, data: d.slice() };
    } else if (s === 0xf0 || s === 0xf7) {
      event = { kind: 'sysex', data: r.bytes(r.vlq()).slice() };
    } else {
      status = s;
      const ch = s & 15;
      switch (s >> 4) {
        case 0x8: event = { kind: 'noteOff', ch, note: r.u8(), vel: r.u8() }; break;
        case 0x9: {
          const note = r.u8();
          const vel = r.u8();
          event = vel ? { kind: 'noteOn', ch, note, vel } : { kind: 'noteOff', ch, note, vel: 64 };
          break;
        }
        case 0xa: event = { kind: 'keyPressure', ch, note: r.u8(), value: r.u8() }; break;
        case 0xb: event = { kind: 'control', ch, controller: r.u8(), value: r.u8() }; break;
        case 0xc: event = { kind: 'program', ch, program: r.u8() }; break;
        case 0xd: event = { kind: 'channelPressure', ch, value: r.u8() }; break;
        case 0xe: {
          const lo = r.u8();
          event = { kind: 'pitchBend', ch, value: ((r.u8() << 7) | lo) - 8192 };
          break;
        }
        default: throw new Error(`MIDI: bad status byte ${s.toString(16)}`);
      }
    }
    out.push({ tick, event });
  }
  return out;
}

class Writer {
  bytes: number[] = [];
  u8(...v: number[]): void {
    for (const x of v) this.bytes.push(x & 0xff);
  }
  u16(v: number): void {
    this.u8(v >> 8, v);
  }
  u32(v: number): void {
    this.u8(v >>> 24, v >>> 16, v >>> 8, v);
  }
  vlq(v: number): void {
    const out = [v & 0x7f];
    for (v >>>= 7; v; v >>>= 7) out.unshift((v & 0x7f) | 0x80);
    this.u8(...out);
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
}

/** Writes a file. Each track's events must be in tick order; an end-of-track is added where one is missing. */
export function writeSmf(smf: Smf): Uint8Array {
  const w = new Writer();
  w.str('MThd');
  w.u32(6);
  w.u16(smf.format);
  w.u16(smf.tracks.length);
  w.u16(smf.division);
  for (const track of smf.tracks) {
    const t = new Writer();
    let last = 0;
    let ended = false;
    for (const { tick, event: e } of track) {
      if (tick < last) throw new Error('MIDI: track events out of order');
      t.vlq(tick - last);
      last = tick;
      switch (e.kind) {
        case 'noteOn': t.u8(0x90 | e.ch, e.note, e.vel); break;
        case 'noteOff': t.u8(0x80 | e.ch, e.note, e.vel); break;
        case 'keyPressure': t.u8(0xa0 | e.ch, e.note, e.value); break;
        case 'control': t.u8(0xb0 | e.ch, e.controller, e.value); break;
        case 'program': t.u8(0xc0 | e.ch, e.program); break;
        case 'channelPressure': t.u8(0xd0 | e.ch, e.value); break;
        case 'pitchBend': {
          const v = e.value + 8192;
          t.u8(0xe0 | e.ch, v & 0x7f, v >> 7);
          break;
        }
        case 'tempo': t.u8(0xff, 0x51, 3, e.usPerQuarter >> 16, e.usPerQuarter >> 8, e.usPerQuarter); break;
        case 'timeSignature': t.u8(0xff, 0x58, 4, e.num, Math.log2(e.den), 24, 8); break;
        case 'text':
          t.u8(0xff, e.type);
          t.vlq(e.text.length);
          t.str(e.text);
          break;
        case 'sysex':
          t.u8(0xf0);
          t.vlq(e.data.length);
          t.u8(...e.data);
          break;
        case 'meta':
          t.u8(0xff, e.type);
          t.vlq(e.data.length);
          t.u8(...e.data);
          break;
        case 'endOfTrack':
          t.u8(0xff, 0x2f, 0);
          ended = true;
          break;
      }
      if (ended) break;
    }
    if (!ended) t.u8(0, 0xff, 0x2f, 0);
    w.str('MTrk');
    w.u32(t.bytes.length);
    w.u8(...t.bytes);
  }
  return Uint8Array.from(w.bytes);
}

/** An event placed in time, ready to play. */
export interface PlayEvent {
  time: number;
  tick: number;
  event: MidiEvent;
}

export interface Section {
  name: string;
  time: number;
}

/** A file laid out in seconds: every track's events merged in order, its sections (markers) and its length. */
export interface Timeline {
  events: PlayEvent[];
  sections: Section[];
  /** When the last event happens (the end of the last track). */
  duration: number;
  /** The beat grid: when each quarter note falls is beatTime(n). */
  beatTime(beat: number): number;
  /** The quarter-note beat at a time (fractional). */
  beatAt(time: number): number;
}

/** Merges the tracks and turns ticks into seconds through the tempo map (120 bpm until the first tempo). */
export function timeline(smf: Smf): Timeline {
  const merged: TimedEvent[] = [];
  smf.tracks.forEach((track) => merged.push(...track));
  // A stable sort by tick keeps each track's order, and puts tracks in file order within a tick.
  merged.sort((a, b) => a.tick - b.tick);
  const tempos: { tick: number; time: number; us: number }[] = [{ tick: 0, time: 0, us: 500000 }];
  for (const e of merged) {
    if (e.event.kind !== 'tempo') continue;
    const prev = tempos[tempos.length - 1]!;
    const time = prev.time + ((e.tick - prev.tick) * prev.us) / 1e6 / smf.division;
    if (e.tick === prev.tick) tempos[tempos.length - 1] = { tick: e.tick, time: prev.time, us: e.event.usPerQuarter };
    else tempos.push({ tick: e.tick, time, us: e.event.usPerQuarter });
  }
  const at = (tick: number): number => {
    let t = tempos[0]!;
    for (const x of tempos) {
      if (x.tick > tick) break;
      t = x;
    }
    return t.time + ((tick - t.tick) * t.us) / 1e6 / smf.division;
  };
  const tickAt = (time: number): number => {
    let t = tempos[0]!;
    for (const x of tempos) {
      if (x.time > time) break;
      t = x;
    }
    return t.tick + ((time - t.time) * 1e6 * smf.division) / t.us;
  };
  const events: PlayEvent[] = [];
  const sections: Section[] = [];
  let duration = 0;
  for (const e of merged) {
    const time = at(e.tick);
    duration = Math.max(duration, time);
    if (e.event.kind === 'text' && e.event.type === MARKER) sections.push({ name: e.event.text.trim(), time });
    if (e.event.kind === 'endOfTrack') continue;
    events.push({ time, tick: e.tick, event: e.event });
  }
  return {
    events, sections, duration,
    beatTime: (beat) => at(beat * smf.division),
    beatAt: (time) => tickAt(time) / smf.division,
  };
}
