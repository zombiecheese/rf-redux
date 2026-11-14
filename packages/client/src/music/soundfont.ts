// SoundFont 2 (.sf2) instruments for the synthesiser: when one is loaded, every program and drum it has plays from
// its samples, with its key and velocity splits, loops, tuning, volume envelope, attenuation, pan and filter cutoff.
// Programs it lacks fall back to the built-in timbres (synth.ts). The Docker image ships GeneralUser GS for
// Options > Instruments (tools/soundfont/); a site can put another General MIDI one in its place (docs/music.md).

import type { Voice } from './synth.js';

// Generator numbers (SoundFont 2.04, section 8.1.2).
const G = {
  startOffset: 0, endOffset: 1, startLoopOffset: 2, endLoopOffset: 3, startCoarse: 4, filterFc: 8, filterQ: 9,
  endCoarse: 12, pan: 17, delayVol: 33, attackVol: 34, holdVol: 35, decayVol: 36, sustainVol: 37, releaseVol: 38,
  instrument: 41, keyRange: 43, velRange: 44, startLoopCoarse: 45, keynum: 46, velocity: 47, attenuation: 48,
  endLoopCoarse: 50, coarseTune: 51, fineTune: 52, sampleID: 53, sampleModes: 54, scaleTuning: 56, exclusiveClass: 57,
  rootKey: 58,
} as const;

interface Zone {
  gens: Map<number, number>;
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
}

interface SampleHeader {
  name: string;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  rate: number;
  key: number;
  correction: number;
}

interface Instrument {
  global: Map<number, number>;
  zones: Zone[];
}

interface Preset {
  bank: number;
  program: number;
  name: string;
  global: Map<number, number>;
  zones: Zone[];
}

/** Generator defaults that are not zero. */
const DEFAULTS = new Map<number, number>([
  [G.filterFc, 13500], [G.delayVol, -12000], [G.attackVol, -12000], [G.holdVol, -12000], [G.decayVol, -12000],
  [G.releaseVol, -12000], [G.keynum, -1], [G.velocity, -1], [G.scaleTuning, 100], [G.rootKey, -1],
]);

const tc = (v: number) => 2 ** (v / 1200);

export class SoundFont {
  readonly name: string;
  private readonly presets = new Map<number, Preset>();
  private readonly instruments: Instrument[] = [];
  private readonly samples: SampleHeader[] = [];
  private readonly pcm: Int16Array;
  private readonly buffers = new Map<number, AudioBuffer>();

  constructor(data: ArrayBuffer) {
    const v = new DataView(data);
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    if (tag(0) !== 'RIFF' || tag(8) !== 'sfbk') throw new Error('SoundFont: not an SF2 file');
    const chunks = new Map<string, [number, number]>();
    let name = 'SoundFont';
    const walk = (start: number, end: number) => {
      for (let o = start; o + 8 <= end;) {
        const id = tag(o);
        const len = v.getUint32(o + 4, true);
        if (id === 'LIST') walk(o + 12, o + 8 + len);
        else chunks.set(id, [o + 8, len]);
        if (id === 'INAM') name = text(v, o + 8, len);
        o += 8 + len + (len & 1);
      }
    };
    walk(12, Math.min(data.byteLength, 8 + v.getUint32(4, true)));
    this.name = name;
    const smpl = chunks.get('smpl');
    if (!smpl) throw new Error('SoundFont: no samples');
    this.pcm = new Int16Array(data.slice(smpl[0], smpl[0] + (smpl[1] & ~1)));
    const get = (id: string): [number, number] => {
      const c = chunks.get(id);
      if (!c) throw new Error(`SoundFont: no ${id} chunk`);
      return c;
    };
    const [shdr, shdrLen] = get('shdr');
    for (let o = shdr; o + 46 <= shdr + shdrLen - 46; o += 46) {
      this.samples.push({
        name: text(v, o, 20), start: v.getUint32(o + 20, true), end: v.getUint32(o + 24, true),
        loopStart: v.getUint32(o + 28, true), loopEnd: v.getUint32(o + 32, true), rate: v.getUint32(o + 36, true),
        key: v.getUint8(o + 40), correction: v.getInt8(o + 41),
      });
    }
    const gens = (id: string) => {
      const [o, len] = get(id);
      const out: [number, number, number][] = [];
      for (let p = o; p + 4 <= o + len; p += 4) out.push([v.getUint16(p, true), v.getInt16(p + 2, true), v.getUint16(p + 2, true)]);
      return out;
    };
    const bags = (id: string) => {
      const [o, len] = get(id);
      const out: number[] = [];
      for (let p = o; p + 4 <= o + len; p += 4) out.push(v.getUint16(p, true));
      return out;
    };
    const zonesOf = (bagStart: number, bagEnd: number, bag: number[], gen: [number, number, number][], last: number) => {
      let global = new Map<number, number>();
      const zones: Zone[] = [];
      for (let b = bagStart; b < bagEnd; b++) {
        const g = new Map<number, number>();
        let keyLo = 0, keyHi = 127, velLo = 0, velHi = 127;
        for (let i = bag[b]!; i < (bag[b + 1] ?? gen.length); i++) {
          const [op, signed, unsigned] = gen[i]!;
          if (op === G.keyRange) [keyLo, keyHi] = [unsigned & 0xff, unsigned >> 8];
          else if (op === G.velRange) [velLo, velHi] = [unsigned & 0xff, unsigned >> 8];
          else g.set(op, op === G.instrument || op === G.sampleID ? unsigned : signed);
        }
        if (!g.has(last)) {
          if (b === bagStart) global = g;
          continue;
        }
        zones.push({ gens: g, keyLo, keyHi, velLo, velHi });
      }
      return { global, zones };
    };
    const ibag = bags('ibag');
    const igen = gens('igen');
    const [inst, instLen] = get('inst');
    for (let o = inst; o + 22 <= inst + instLen - 22; o += 22) {
      const z = zonesOf(v.getUint16(o + 20, true), v.getUint16(o + 42, true), ibag, igen, G.sampleID);
      this.instruments.push(z);
    }
    const pbag = bags('pbag');
    const pgen = gens('pgen');
    const [phdr, phdrLen] = get('phdr');
    for (let o = phdr; o + 38 <= phdr + phdrLen - 38; o += 38) {
      const program = v.getUint16(o + 20, true);
      const bank = v.getUint16(o + 22, true);
      const z = zonesOf(v.getUint16(o + 24, true), v.getUint16(o + 62, true), pbag, pgen, G.instrument);
      this.presets.set(bank * 128 + program, { bank, program, name: text(v, o, 20), ...z });
    }
  }

  has(bank: number, program: number): boolean {
    return this.presets.has(bank * 128 + program);
  }

  private buffer(ctx: BaseAudioContext, id: number): AudioBuffer | null {
    let b = this.buffers.get(id);
    if (b) return b;
    const s = this.samples[id];
    if (!s || s.end <= s.start || s.rate < 3000) return null;
    b = ctx.createBuffer(1, s.end - s.start, Math.min(s.rate, 384000));
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = this.pcm[s.start + i]! / 32768;
    this.buffers.set(id, b);
    return b;
  }

  /** A voice for a note on a bank (128 is drums) and program, or null when the SoundFont has no such preset. */
  voice(ctx: BaseAudioContext, dest: AudioNode, bank: number, program: number, note: number, vel: number, time: number, bend: number): Voice | null {
    const preset = this.presets.get(bank * 128 + program) ?? (bank === 128 ? this.presets.get(128 * 128) : this.presets.get(program));
    if (!preset) return null;
    const out = ctx.createGain();
    out.connect(dest);
    const parts: { src: AudioBufferSourceNode; amp: GainNode; release: number; base: number; peak: number }[] = [];
    for (const pz of preset.zones) {
      if (note < pz.keyLo || note > pz.keyHi || vel < pz.velLo || vel > pz.velHi) continue;
      const instrument = this.instruments[pz.gens.get(G.instrument)!];
      if (!instrument) continue;
      for (const iz of instrument.zones) {
        if (note < iz.keyLo || note > iz.keyHi || vel < iz.velLo || vel > iz.velHi) continue;
        // Instrument generators set values (zone over global over default); preset ones add to them.
        const gen = (op: number) => (iz.gens.get(op) ?? instrument.global.get(op) ?? DEFAULTS.get(op) ?? 0)
          + (op === G.sampleID || op === G.sampleModes || op === G.rootKey || op === G.exclusiveClass ? 0 : pz.gens.get(op) ?? preset.global.get(op) ?? 0);
        const id = gen(G.sampleID);
        const s = this.samples[id];
        const buf = this.buffer(ctx, id);
        if (!s || !buf) continue;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const loopMode = gen(G.sampleModes) & 3;
        const offset = (fine: number, coarse: number) => gen(fine) + gen(coarse) * 32768;
        const start = Math.max(0, offset(G.startOffset, G.startCoarse));
        if (loopMode === 1 || loopMode === 3) {
          src.loop = true;
          src.loopStart = (s.loopStart - s.start + offset(G.startLoopOffset, G.startLoopCoarse)) / s.rate;
          src.loopEnd = (s.loopEnd - s.start + offset(G.endLoopOffset, G.endLoopCoarse)) / s.rate;
        }
        const root = gen(G.rootKey) >= 0 ? gen(G.rootKey) : s.key;
        const key = gen(G.keynum) >= 0 ? gen(G.keynum) : note;
        const cents = (key - root) * gen(G.scaleTuning) + gen(G.coarseTune) * 100 + gen(G.fineTune) + s.correction;
        src.detune.value = cents + (bank === 128 ? 0 : bend);
        const base = cents;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = Math.min(ctx.sampleRate / 2 - 100, 8.176 * tc(gen(G.filterFc)));
        filter.Q.value = Math.max(0.0001, gen(G.filterQ) / 10);
        const amp = ctx.createGain();
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.max(-1, Math.min(1, gen(G.pan) / 500));
        src.connect(filter).connect(amp).connect(pan).connect(out);
        // Velocity and attenuation in centibels; the volume envelope in timecents.
        const peak = 10 ** (-(gen(G.attenuation) * 0.4) / 200) * (vel / 127) ** 2;
        const delay = tc(gen(G.delayVol));
        const attack = tc(gen(G.attackVol));
        const hold = tc(gen(G.holdVol));
        const decay = tc(gen(G.decayVol));
        const sustain = peak * 10 ** (-Math.max(0, gen(G.sustainVol)) / 200);
        const t0 = time + delay;
        amp.gain.setValueAtTime(0, time);
        amp.gain.setValueAtTime(0, t0);
        amp.gain.linearRampToValueAtTime(peak, t0 + attack);
        amp.gain.setValueAtTime(peak, t0 + attack + hold);
        amp.gain.setTargetAtTime(sustain, t0 + attack + hold, decay / 5);
        src.start(time, start / s.rate);
        if (!src.loop) src.stop(time + delay + (buf.duration - start / s.rate) / tc(src.detune.value) + 0.05);
        parts.push({ src, amp, release: Math.min(8, tc(gen(G.releaseVol))), base, peak });
      }
    }
    if (!parts.length) {
      out.disconnect();
      return null;
    }
    const voice: Voice = {
      ch: -1, note, start: time, released: false, end: Infinity,
      release: (t) => {
        if (voice.released) return voice.end;
        voice.released = true;
        let end = t;
        for (const p of parts) {
          p.amp.gain.cancelScheduledValues(t);
          p.amp.gain.setTargetAtTime(0, t, p.release / 5);
          end = Math.max(end, t + p.release + 0.05);
        }
        for (const p of parts) {
          try {
            p.src.stop(end);
          } catch {
            // Already stopped.
          }
        }
        voice.end = end;
        return end;
      },
      kill: (t) => {
        voice.released = true;
        for (const p of parts) {
          p.amp.gain.cancelScheduledValues(t);
          p.amp.gain.setTargetAtTime(0, t, 0.01);
          try {
            p.src.stop(t + 0.06);
          } catch {
            // Already stopped.
          }
        }
        voice.end = Math.min(voice.end, t + 0.06);
      },
      bend: (cents, t) => {
        if (bank === 128) return;
        for (const p of parts) p.src.detune.setValueAtTime(p.base + cents, t);
      },
    };
    return voice;
  }
}

function text(v: DataView, o: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = v.getUint8(o + i);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}
