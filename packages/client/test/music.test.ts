import { describe, expect, it } from 'vitest';
import {
  BUNKER, DEATH, DRUMS, Director, FLAG_DISCOVERY, HELI_1, HELI_2, PIECES, TANK_1, TANK_2, TANK_3, WIN,
  type MusicOut, type Piece, type Situation,
} from '../src/music/director.js';
import { BOOK, tr } from '../src/music/pieces.js';
import { MODERN_BOOK } from '../src/music/pieces-modern.js';
import { Player } from '../src/music/player.js';
import type { Synth } from '../src/music/synth.js';
import { PPQ, compile, compileLine, pitch, ticks } from '../src/music/score.js';
import { readSmf, timeline, writeSmf, type Smf } from '../src/music/smf.js';

describe('MIDI files', () => {
  it('reads what it writes', () => {
    const smf: Smf = {
      format: 1, division: 96, tracks: [[
        { tick: 0, event: { kind: 'tempo', usPerQuarter: 400000 } },
        { tick: 0, event: { kind: 'text', type: 6, text: 'a' } },
        { tick: 0, event: { kind: 'program', ch: 3, program: 58 } },
        { tick: 10, event: { kind: 'noteOn', ch: 3, note: 40, vel: 90 } },
        { tick: 200, event: { kind: 'pitchBend', ch: 3, value: -4096 } },
        { tick: 300, event: { kind: 'noteOff', ch: 3, note: 40, vel: 64 } },
        { tick: 300, event: { kind: 'endOfTrack' } },
      ]],
    };
    expect(readSmf(writeSmf(smf))).toEqual(smf);
  });

  it('reads running status and a note-on of velocity 0 as a note-off', () => {
    const track = [0x00, 0x90, 60, 100, 0x60, 62, 100, 0x60, 60, 0, 0x00, 62, 0, 0x00, 0xff, 0x2f, 0x00];
    const bytes = new Uint8Array([
      ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96],
      ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length], ...track,
    ]);
    const smf = readSmf(bytes);
    expect(smf.tracks[0]!.map((e) => [e.tick, e.event.kind])).toEqual([
      [0, 'noteOn'], [96, 'noteOn'], [192, 'noteOff'], [192, 'noteOff'], [192, 'endOfTrack'],
    ]);
  });

  it('times events through tempo changes', () => {
    const tl = timeline({
      format: 0, division: 100, tracks: [[
        { tick: 0, event: { kind: 'tempo', usPerQuarter: 500000 } },
        { tick: 200, event: { kind: 'tempo', usPerQuarter: 250000 } },
        { tick: 300, event: { kind: 'noteOn', ch: 0, note: 60, vel: 1 } },
      ]],
    });
    // Two beats at 120 bpm, then one at 240.
    expect(tl.events.at(-1)!.time).toBeCloseTo(1.25);
    expect(tl.beatAt(1.25)).toBeCloseTo(3);
    expect(tl.beatTime(4)).toBeCloseTo(1.5);
  });
});

describe('sequencer', () => {
  it('lets go of every note by the end of a piece, the last chord included', () => {
    const ctx = { currentTime: 0 } as unknown as BaseAudioContext;
    const sounding = new Set<string>();
    const synth = {
      noteOn: (ch: number, note: number) => sounding.add(`${ch}:${note}`),
      noteOff: (ch: number, note: number) => sounding.delete(`${ch}:${note}`),
      control: () => {}, program: () => {}, pitchBend: () => {}, resetChannels: () => {}, cutFrom: () => {},
    } as unknown as Synth;
    const param = { value: 1, setValueAtTime: () => {}, cancelScheduledValues: () => {}, linearRampToValueAtTime: () => {} };
    const player = new Player(ctx, synth, { gain: param } as unknown as GainNode);
    const tl = timeline(readSmf(writeSmf(compile(BOOK.fanfare!))));
    let ended = false;
    player.play(tl, null, 'now', () => (ended = true));
    for (let t = 0; !ended && t < tl.duration + 5; t += 0.1) {
      (ctx as { currentTime: number }).currentTime = t;
      (player as unknown as { pump(): void }).pump();
    }
    player.dispose();
    expect(ended).toBe(true);
    expect([...sounding]).toEqual([]);
  });
});

describe('score notation', () => {
  it('names notes and lengths', () => {
    expect(pitch('C4')).toBe(60);
    expect(pitch('F#5')).toBe(78);
    expect(pitch('Bb1')).toBe(34);
    expect(pitch('sn')).toBe(38);
    expect(ticks('4')).toBe(PPQ);
    expect(ticks('8.')).toBe(PPQ * 0.75);
    expect(ticks('8t')).toBe(PPQ / 3);
    expect(ticks('2.+4.')).toBe(PPQ * 4.5);
    expect(tr('Bb3/4 F#5 r/8 sn', 2)).toBe('C4/4 Ab5 r/8 sn');
  });

  it('carries lengths on, repeats, and checks bar lines', () => {
    const r = compileLine('| ( C4/8 D4 )*2 E4/2 |', PPQ * 4);
    expect(r.notes.map((n) => [n.at, n.keys[0]])).toEqual([[0, 60], [240, 62], [480, 60], [720, 62], [960, 64]]);
    expect(r.length).toBe(PPQ * 4);
    expect(() => compileLine('| C4/4 D4 E4 |', PPQ * 4)).toThrow(/lasts 3 beats/);
  });

  it('compiles every piece in the band book, bar lines checked, with a section for each start and loop point', () => {
    for (const [name, def] of Object.entries(BOOK)) {
      const tl = timeline(readSmf(writeSmf(compile(def))));
      expect(tl.events.some((e) => e.event.kind === 'noteOn'), name).toBe(true);
      expect(tl.sections.map((s) => s.name), name).toEqual(def.sections.map((s) => s.name));
    }
    for (const p of PIECES) {
      const def = BOOK[p.file];
      expect(def, p.name).toBeDefined();
      for (const s of [p.start, p.loop]) if (s) expect(def!.sections.map((x) => x.name), p.name).toContain(s);
    }
  });

  it('keeps every note in its instrument\'s range', () => {
    const range: Record<number, [number, number]> = {
      0: [52, 86], 1: [41, 79], 2: [40, 74], 3: [26, 65], 4: [74, 108], 5: [50, 96], 6: [40, 100], 7: [38, 57], 8: [55, 86],
    };
    for (const [name, def] of Object.entries(BOOK)) {
      for (const track of compile(def).tracks) {
        for (const { event: e } of track) {
          if (e.kind !== 'noteOn' || e.ch === 9) continue;
          const [lo, hi] = range[e.ch]!;
          expect(e.note >= lo && e.note <= hi, `${name}: channel ${e.ch} note ${e.note}`).toBe(true);
        }
      }
    }
  });
});

describe('modern soundtrack', () => {
  it('compiles every piece, with a section for each start and loop point the director uses', () => {
    for (const [name, def] of Object.entries(MODERN_BOOK)) {
      const tl = timeline(readSmf(writeSmf(compile(def))));
      expect(tl.events.some((e) => e.event.kind === 'noteOn'), name).toBe(true);
      expect(tl.sections.map((s) => s.name), name).toEqual(def.sections.map((s) => s.name));
    }
    for (const p of PIECES) {
      const def = MODERN_BOOK[p.file];
      expect(def, p.name).toBeDefined();
      for (const s of [p.start, p.loop]) if (s) expect(def!.sections.map((x) => x.name), p.name).toContain(s);
    }
  });

  it('keeps every note on a drop-C guitar, a five-string bass and the lead\'s neck', () => {
    // Guitars from low C, the bass from its low B, the lead up to the 24th fret of the top string.
    const range: Record<number, [number, number]> = {
      0: [36, 72], 1: [36, 72], 2: [36, 60], 3: [36, 60], 4: [23, 60], 5: [52, 89], 6: [45, 84], 7: [24, 48], 8: [48, 88],
    };
    for (const [name, def] of Object.entries(MODERN_BOOK)) {
      for (const track of compile(def).tracks) {
        for (const { event: e } of track) {
          if (e.kind !== 'noteOn' || e.ch === 9) continue;
          const [lo, hi] = range[e.ch]!;
          expect(e.note >= lo && e.note <= hi, `${name}: channel ${e.ch} note ${e.note}`).toBe(true);
        }
      }
    }
  });
});

class FakeOut implements MusicOut {
  played: [string, boolean, string][] = [];
  fading = false;
  ready = true;
  fades = 0;
  play(piece: Piece, fromLoop: boolean, how: 'start' | 'beat' | 'cut'): void {
    this.played.push([piece.name, fromLoop, how]);
  }
  fadeOut(): void {
    this.fades++;
  }
  stop(): void {}
  get last(): string | undefined {
    return this.played.at(-1)?.[0];
  }
}

const calm: Situation = { flagRevealed: false, flagTaken: false, sub: false, driving: false, inBunker: 1, humans: 1 };

function setup(randoms: number[] = []) {
  const out = new FakeOut();
  const vehicles = new Set<object>();
  let drivingNow = false;
  const d = new Director<object>(out, (v) => vehicles.has(v), () => drivingNow, () => 1, () => randoms.shift() ?? 0);
  const tick = (s: Partial<Situation> = {}) => {
    d.update();
    d.situation({ ...calm, ...s }, (v) => ({ vehicle: v, kind: 'tank', ownFlagCarried: false, enemyFlagNear: false, left: 1 }));
  };
  return { out, d, vehicles, tick, setDriving: (on: boolean) => (drivingNow = on) };
}

describe('music director', () => {
  it('starts a match on the Bunker theme', () => {
    const { out, d, tick } = setup();
    d.matchStart();
    tick();
    expect(out.played).toEqual([['Bunker', false, 'start']]);
  });

  it('refuses a lower priority, and at equal priority a piece whose range does not take it in', () => {
    const { d } = setup();
    expect(d.request(BUNKER, 0x80)).toBe(0);
    expect(d.request(DEATH, 0x7f)).toBe(-1);
    expect(d.request(PIECES.findIndex((p) => p.name === 'Heli 2'), 0x80)).toBe(-1);
    expect(d.request(TANK_2, 0x80)).toBe(0);
    expect(d.request(99, 0x80)).toBe(-10);
  });

  it('lets a priority sink by one a tick, to 40 below where it began', () => {
    const { d } = setup();
    d.request(FLAG_DISCOVERY, 0xfe);
    for (let i = 0; i < 100; i++) d.update();
    expect(d.priority).toBe(0xfe - 40);
  });

  it('plays a launched tank\'s theme, then changes to the picked one on the beat', () => {
    const { out, d, vehicles, tick, setDriving } = setup([6]);
    d.matchStart();
    tick();
    const tank = {};
    vehicles.add(tank);
    setDriving(true);
    d.launch(tank, 'tank');
    tick({ driving: true, inBunker: 0 });
    // Bunker fades out (as it faded in from silence), then Tank 1; the random pick (6 of 8) asks for Tank 2.
    expect(out.fades).toBe(2);
    expect(out.last).toBe('Tank 1');
    tick({ driving: true, inBunker: 0 });
    expect(out.played.at(-1)).toEqual(['Tank 2', false, 'beat']);
  });

  it('picks the first theme outright for a tank or helicopter with two more left in the bunker', () => {
    const { d } = setup([6, 6]);
    const score = { vehicle: {}, ownFlagCarried: false, enemyFlagNear: false };
    expect(d.pick({ ...score, kind: 'tank', left: 2 })).toBe(TANK_1);
    expect(d.pick({ ...score, kind: 'heli', left: 2 })).toBe(HELI_1);
    // Any other count leaves it to the draw (6 of 8 is the second theme), and a flag in danger still comes first.
    expect(d.pick({ ...score, kind: 'tank', left: 1 })).toBe(TANK_2);
    expect(d.pick({ ...score, kind: 'heli', left: 255 })).toBe(HELI_2);
    expect(d.pick({ ...score, kind: 'tank', left: 2, enemyFlagNear: true })).toBe(TANK_3);
  });

  it('cuts to the tank\'s death piece when the scored tank dies, and goes back to its theme after', () => {
    const { out, d, vehicles, tick, setDriving } = setup([0]);
    const tank = {};
    vehicles.add(tank);
    setDriving(true);
    d.launch(tank, 'tank');
    tick({ driving: true, inBunker: 0 });
    tick({ driving: true, inBunker: 0 });
    expect(d.state).toBe(4);
    for (let i = 0; i < 60; i++) tick({ driving: true, inBunker: 0 });
    vehicles.delete(tank);
    setDriving(false);
    d.destroyed(tank, 'tank');
    tick({ inBunker: 0 });
    tick({ inBunker: 0 });
    expect(out.played.at(-1)).toEqual(['Tank Death', false, 'cut']);
    // Back in a new tank when it ends: the death piece hands back to what played before it.
    const next = {};
    vehicles.add(next);
    setDriving(true);
    d.ended();
    d.update();
    expect(out.last).toBe('Tank 1');
  });

  it('plays Death for a vehicle that was not being scored', () => {
    const { out, d, tick } = setup();
    d.matchStart();
    tick();
    d.destroyed({}, 'jeep');
    tick();
    tick();
    expect(out.last).toBe('Death');
  });

  it('loops a looping piece from its loop section when it ends', () => {
    const { out, d, tick } = setup();
    d.request(TANK_1, 0x80);
    tick({ inBunker: 0 });
    d.ended();
    d.update();
    expect(out.played.at(-1)).toEqual(['Tank 1', true, 'start']);
    expect(PIECES[TANK_1]!.loop).toBe('c');
  });

  it('hands a piece that plays once back to Bunker when nobody drives', () => {
    const { out, d, tick } = setup();
    d.request(FLAG_DISCOVERY, 0xfe);
    tick();
    expect(out.last).toBe('Flag Discovery');
    d.ended();
    d.update();
    expect(out.last).toBe('Bunker');
  });

  it('holds the Win piece, and plays Drums in the menus', () => {
    const { out, d } = setup();
    d.menus();
    d.update();
    expect(out.last).toBe('Drums');
    d.request(WIN, 0xff);
    d.update();
    expect(out.played.at(-1)).toEqual(['Win', false, 'cut']);
    d.ended();
    d.update();
    expect(out.last).toBe('Win');
    expect(PIECES[DRUMS]!.start).toBe('intro');
  });

  it('stays quiet while the music is off, and picks up again when it is back on', () => {
    const { out, d, tick } = setup();
    d.setOff(true);
    d.matchStart();
    tick();
    expect(out.played).toEqual([]);
    d.setOff(false);
    d.update();
    expect(out.last).toBe('Bunker');
  });

  it('stops when a watched vehicle goes', () => {
    const { d, vehicles, tick } = setup();
    const v = {};
    vehicles.add(v);
    d.launch(v, 'jeep');
    tick({ driving: true, inBunker: 0 });
    vehicles.delete(v);
    d.update();
    expect(d.requested).toBe(null);
  });
});
