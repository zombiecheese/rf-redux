// A General MIDI synthesiser on WebAudio, in the spirit of the Roland MT-32 the original's era wrote for: each
// timbre is up to four partials (an attack transient plus tones), each with its own pitch, filter (TVF) and
// amplifier (TVA) envelopes, the way the MT-32's LA synthesis builds sounds. It goes further where the browser
// can: 64 voices against the MT-32's 32 partials, all 16 channels and 128 programs (General MIDI, where the MT-32
// had 8 parts and its own map), a stereo hall reverb, a chorus, and, when a SoundFont is loaded (soundfont.ts),
// sampled instruments in place of the built-in timbres.
//
// Channel messages follow General MIDI: program change, volume (7), pan (10), expression (11), modulation (1),
// sustain (64), reverb (91) and chorus (93) sends, RPN 0 pitch-bend range, all notes off (123), reset (121).

import type { SoundFont } from './soundfont.js';

export const MAX_VOICES = 64;
const DRUM_CH = 9;

type Wave = 'sine' | 'triangle' | 'saw' | 'square' | 'brass' | 'reed' | 'pulse' | 'organ' | 'noise';

interface Env {
  /** Seconds to full, seconds to the sustain level, the sustain level (0-1), and seconds to silence after release. */
  a: number;
  d: number;
  s: number;
  r: number;
}

interface PartialDef {
  wave: Wave;
  level: number;
  /** Cents off the note, and octaves. */
  detune?: number;
  octave?: number;
  /** A fixed pitch in Hz (drums), instead of the note's. */
  hz?: number;
  amp: Env;
  /** Lowpass (or another type) cutoff: a multiple of the note's frequency, or Hz when fixed; env adds to it. */
  filter?: { type?: BiquadFilterType; cutoff: number; fixed?: boolean; env?: number; q?: number; a?: number; d?: number; s?: number; vel?: number };
  /** A pitch sweep in cents that settles over a time (brass "blip", drum drops). */
  sweep?: { cents: number; time: number };
}

interface Patch {
  partials: PartialDef[];
  /** Delayed vibrato: rate in Hz, depth in cents, delay in seconds. */
  vibrato?: { rate: number; depth: number; delay: number };
  gain: number;
  /** Voices of a percussive patch end by themselves; held ones wait for note off. */
  oneShot?: boolean;
}

const env = (a: number, d: number, s: number, r: number): Env => ({ a, d, s, r });

// ---- The timbres -------------------------------------------------------------------------------------------------

const P: Record<string, Patch> = {
  piano: { gain: 0.5, partials: [
    { wave: 'triangle', level: 0.8, amp: env(0.004, 1.6, 0, 0.3), filter: { cutoff: 6, env: 10, d: 0.6, s: 0, vel: 1 } },
    { wave: 'saw', level: 0.18, amp: env(0.002, 0.5, 0, 0.2), filter: { cutoff: 3, d: 0.3 } },
  ] },
  bell: { gain: 0.35, oneShot: true, partials: [
    { wave: 'sine', level: 0.7, amp: env(0.002, 2.4, 0, 0.6) },
    { wave: 'sine', level: 0.35, detune: 386, octave: 1, amp: env(0.002, 0.8, 0, 0.3) },
    { wave: 'sine', level: 0.2, octave: 2, detune: 7, amp: env(0.001, 0.3, 0, 0.2) },
  ] },
  organ: { gain: 0.32, partials: [
    { wave: 'organ', level: 0.8, amp: env(0.01, 0.1, 1, 0.08) },
    { wave: 'sine', level: 0.3, octave: 1, amp: env(0.01, 0.1, 1, 0.08) },
  ] },
  pluck: { gain: 0.5, partials: [
    { wave: 'saw', level: 0.6, amp: env(0.002, 0.9, 0, 0.2), filter: { cutoff: 2, env: 12, d: 0.25, s: 0, vel: 1 } },
    { wave: 'noise', level: 0.12, amp: env(0.001, 0.03, 0, 0.02), filter: { type: 'bandpass', cutoff: 3, q: 2 } },
  ] },
  bass: { gain: 0.6, partials: [
    { wave: 'saw', level: 0.6, amp: env(0.005, 0.4, 0.6, 0.1), filter: { cutoff: 2, env: 6, d: 0.15, s: 0.2, q: 2 } },
    { wave: 'sine', level: 0.5, octave: -1, amp: env(0.005, 0.3, 0.8, 0.1) },
  ] },
  strings: { gain: 0.38, vibrato: { rate: 5.4, depth: 9, delay: 0.25 }, partials: [
    { wave: 'saw', level: 0.5, detune: -7, amp: env(0.07, 0.3, 0.85, 0.14), filter: { cutoff: 5, env: 3, a: 0.1, d: 0.4, s: 0.5 } },
    { wave: 'saw', level: 0.5, detune: 7, amp: env(0.09, 0.3, 0.85, 0.16), filter: { cutoff: 5, env: 3, a: 0.1, d: 0.4, s: 0.5 } },
    { wave: 'noise', level: 0.04, amp: env(0.01, 0.06, 0, 0.05), filter: { type: 'bandpass', cutoff: 4, q: 1 } },
  ] },
  timpani: { gain: 0.9, oneShot: true, partials: [
    { wave: 'sine', level: 0.9, amp: env(0.002, 1.6, 0, 0.6), sweep: { cents: 60, time: 0.08 } },
    { wave: 'triangle', level: 0.25, detune: 1500, amp: env(0.002, 0.35, 0, 0.2) },
    { wave: 'noise', level: 0.35, amp: env(0.001, 0.12, 0, 0.1), filter: { type: 'lowpass', cutoff: 900, fixed: true, q: 0.7 } },
  ] },
  // Brass: a breathy transient, then a bright tone whose filter opens with the attack and with how hard it is
  // played; a little upward blip at the start, as a lip slur does.
  trumpet: { gain: 0.42, vibrato: { rate: 5.6, depth: 12, delay: 0.3 }, partials: [
    { wave: 'brass', level: 0.75, amp: env(0.025, 0.25, 0.8, 0.1), sweep: { cents: -40, time: 0.04 },
      filter: { cutoff: 2.5, env: 9, a: 0.04, d: 0.3, s: 0.45, q: 1.2, vel: 1 } },
    { wave: 'saw', level: 0.2, detune: 6, amp: env(0.03, 0.3, 0.7, 0.1), filter: { cutoff: 4, env: 4, a: 0.05, d: 0.3, s: 0.4 } },
    { wave: 'noise', level: 0.05, amp: env(0.005, 0.05, 0, 0.03), filter: { type: 'bandpass', cutoff: 2, q: 3 } },
  ] },
  trombone: { gain: 0.48, vibrato: { rate: 5, depth: 8, delay: 0.35 }, partials: [
    { wave: 'brass', level: 0.8, amp: env(0.04, 0.3, 0.8, 0.14), sweep: { cents: -30, time: 0.06 },
      filter: { cutoff: 2, env: 6, a: 0.06, d: 0.35, s: 0.4, q: 1, vel: 1 } },
    { wave: 'saw', level: 0.2, detune: -5, amp: env(0.05, 0.3, 0.75, 0.14), filter: { cutoff: 3, env: 3, a: 0.06, d: 0.3, s: 0.4 } },
  ] },
  horn: { gain: 0.5, vibrato: { rate: 5, depth: 6, delay: 0.4 }, partials: [
    { wave: 'brass', level: 0.6, amp: env(0.06, 0.4, 0.85, 0.2), filter: { cutoff: 1.4, env: 3, a: 0.08, d: 0.4, s: 0.4, vel: 0.6 } },
    { wave: 'sine', level: 0.45, amp: env(0.05, 0.4, 0.9, 0.2) },
  ] },
  tuba: { gain: 0.7, partials: [
    { wave: 'brass', level: 0.7, amp: env(0.04, 0.3, 0.8, 0.12), filter: { cutoff: 2.5, env: 4, a: 0.05, d: 0.3, s: 0.4, vel: 0.8 } },
    { wave: 'sine', level: 0.55, amp: env(0.03, 0.3, 0.9, 0.12) },
  ] },
  brassSection: { gain: 0.36, vibrato: { rate: 5.5, depth: 8, delay: 0.35 }, partials: [
    { wave: 'brass', level: 0.5, detune: -9, amp: env(0.035, 0.3, 0.8, 0.14), filter: { cutoff: 2.2, env: 7, a: 0.05, d: 0.3, s: 0.45, vel: 1 } },
    { wave: 'brass', level: 0.5, detune: 9, amp: env(0.045, 0.3, 0.8, 0.14), filter: { cutoff: 2.2, env: 7, a: 0.05, d: 0.3, s: 0.45, vel: 1 } },
  ] },
  reed: { gain: 0.42, vibrato: { rate: 5, depth: 7, delay: 0.3 }, partials: [
    { wave: 'reed', level: 0.8, amp: env(0.02, 0.2, 0.85, 0.08), filter: { cutoff: 4, env: 3, a: 0.03, d: 0.2, s: 0.5, vel: 0.7 } },
    { wave: 'noise', level: 0.03, amp: env(0.01, 0.1, 0.3, 0.05), filter: { type: 'bandpass', cutoff: 3, q: 2 } },
  ] },
  // Fife and piccolo: a nearly pure tone with a chiff of breath at the start and a fast vibrato.
  flute: { gain: 0.36, vibrato: { rate: 6, depth: 14, delay: 0.15 }, partials: [
    { wave: 'triangle', level: 0.55, amp: env(0.02, 0.2, 0.85, 0.06) },
    { wave: 'sine', level: 0.45, amp: env(0.025, 0.2, 0.9, 0.06) },
    { wave: 'noise', level: 0.12, amp: env(0.003, 0.05, 0.08, 0.04), filter: { type: 'bandpass', cutoff: 1.5, q: 4 } },
  ] },
  lead: { gain: 0.3, vibrato: { rate: 5.5, depth: 10, delay: 0.3 }, partials: [
    { wave: 'pulse', level: 0.7, amp: env(0.01, 0.2, 0.8, 0.1), filter: { cutoff: 4, env: 4, d: 0.3, s: 0.5 } },
  ] },
  pad: { gain: 0.3, vibrato: { rate: 4, depth: 6, delay: 0.5 }, partials: [
    { wave: 'saw', level: 0.4, detune: -11, amp: env(0.4, 0.5, 0.8, 0.8), filter: { cutoff: 3, env: 1, a: 0.5, d: 1, s: 0.5 } },
    { wave: 'saw', level: 0.4, detune: 11, amp: env(0.5, 0.5, 0.8, 0.8), filter: { cutoff: 3, env: 1, a: 0.5, d: 1, s: 0.5 } },
  ] },
  // The modern rig (programs 28-30, 33-34 and 38): guitars and bass played into the channel's amp (Amp below),
  // which does the distortion, so these are the strings as they leave the pickups.
  rhythm: { gain: 0.5, partials: [
    { wave: 'saw', level: 0.55, detune: -5, amp: env(0.002, 0.25, 0.85, 0.07), filter: { cutoff: 9, q: 0.8 } },
    { wave: 'saw', level: 0.45, detune: 6, amp: env(0.003, 0.25, 0.85, 0.07), filter: { cutoff: 7, q: 0.8 } },
    { wave: 'noise', level: 0.05, amp: env(0.001, 0.02, 0, 0.01), filter: { type: 'bandpass', cutoff: 2500, fixed: true, q: 1 } },
  ] },
  // Palm-muted: the filter snaps shut, so each chug is a thump with a bite on the front.
  muted: { gain: 0.6, partials: [
    { wave: 'saw', level: 0.7, detune: -4, amp: env(0.001, 0.14, 0.25, 0.05), filter: { cutoff: 2, env: 7, d: 0.07, s: 0, q: 1.4, vel: 0.6 } },
    { wave: 'saw', level: 0.5, detune: 5, amp: env(0.001, 0.14, 0.25, 0.05), filter: { cutoff: 2, env: 6, d: 0.06, s: 0, q: 1.2, vel: 0.6 } },
  ] },
  leadGuitar: { gain: 0.42, vibrato: { rate: 5.6, depth: 22, delay: 0.22 }, partials: [
    { wave: 'saw', level: 0.6, amp: env(0.003, 0.3, 0.85, 0.18), filter: { cutoff: 6, q: 1 } },
    { wave: 'square', level: 0.3, detune: 4, amp: env(0.003, 0.3, 0.8, 0.18), filter: { cutoff: 5 } },
  ] },
  pickBass: { gain: 0.75, partials: [
    { wave: 'saw', level: 0.55, amp: env(0.002, 0.3, 0.75, 0.06), filter: { cutoff: 3, env: 8, d: 0.12, s: 0.25, q: 1.5, vel: 0.7 } },
    { wave: 'sine', level: 0.7, amp: env(0.002, 0.3, 0.9, 0.06) },
  ] },
  // An 808-style sub that drops an octave as it rings (breakdowns and the death stingers).
  subDrop: { gain: 0.9, oneShot: true, partials: [
    { wave: 'sine', level: 1, amp: env(0.003, 2.6, 0, 0.4), sweep: { cents: 1200, time: 2.2 } },
    { wave: 'triangle', level: 0.25, amp: env(0.003, 0.5, 0, 0.2), sweep: { cents: 1200, time: 2.2 } },
  ] },
  fx: { gain: 0.3, oneShot: true, partials: [
    { wave: 'noise', level: 0.6, amp: env(0.05, 1, 0, 0.4), filter: { type: 'bandpass', cutoff: 2, q: 3, env: 3, d: 0.8 } },
  ] },
};

/** General MIDI program to built-in timbre (each family of eight, with the band instruments picked out). */
function patchFor(program: number): Patch {
  if (program === 47) return P.timpani!;
  if (program === 56 || program === 59) return P.trumpet!;
  if (program === 57) return P.trombone!;
  if (program === 58) return P.tuba!;
  if (program === 60 || program === 69) return P.horn!;
  if (program >= 61 && program <= 63) return P.brassSection!;
  if (program === 28) return P.muted!;
  if (program === 29) return P.leadGuitar!;
  if (program === 30) return P.rhythm!;
  if (program === 33 || program === 34) return P.pickBass!;
  if (program === 38) return P.subDrop!;
  const family = [
    'piano', 'bell', 'organ', 'pluck', 'bass', 'strings', 'strings', 'trumpet',
    'reed', 'flute', 'lead', 'pad', 'fx', 'pluck', 'bell', 'fx',
  ][program >> 3]!;
  if (program === 45 || program === 46) return P.pluck!;
  return P[family]!;
}

/** The rhythm channel's sounds by key (General MIDI drum map; unlisted keys fall back to the nearest kind). */
const DRUM_PATCHES: Record<string, Patch> = {
  kick: { gain: 1.1, oneShot: true, partials: [
    { wave: 'sine', level: 1, hz: 52, amp: env(0.001, 0.38, 0, 0.1), sweep: { cents: 2400, time: 0.045 } },
    { wave: 'noise', level: 0.2, amp: env(0.001, 0.02, 0, 0.01), filter: { type: 'lowpass', cutoff: 2500, fixed: true } },
  ] },
  // A field snare: the drum's ring plus the snares' rattle.
  snare: { gain: 0.75, oneShot: true, partials: [
    { wave: 'triangle', level: 0.45, hz: 190, amp: env(0.001, 0.09, 0, 0.05), sweep: { cents: 500, time: 0.02 } },
    { wave: 'noise', level: 0.8, amp: env(0.001, 0.2, 0, 0.08), filter: { type: 'bandpass', cutoff: 2600, fixed: true, q: 0.8 } },
    { wave: 'noise', level: 0.3, amp: env(0.001, 0.08, 0, 0.04), filter: { type: 'highpass', cutoff: 6000, fixed: true } },
  ] },
  rim: { gain: 0.6, oneShot: true, partials: [
    { wave: 'square', level: 0.5, hz: 820, amp: env(0.0005, 0.025, 0, 0.01), filter: { type: 'bandpass', cutoff: 1800, fixed: true, q: 3 } },
    { wave: 'noise', level: 0.3, amp: env(0.0005, 0.02, 0, 0.01), filter: { type: 'highpass', cutoff: 3000, fixed: true } },
  ] },
  hat: { gain: 0.35, oneShot: true, partials: [
    { wave: 'noise', level: 0.8, amp: env(0.001, 0.05, 0, 0.03), filter: { type: 'highpass', cutoff: 7500, fixed: true } },
  ] },
  openHat: { gain: 0.35, oneShot: true, partials: [
    { wave: 'noise', level: 0.8, amp: env(0.001, 0.35, 0, 0.2), filter: { type: 'highpass', cutoff: 7000, fixed: true } },
  ] },
  crash: { gain: 0.5, oneShot: true, partials: [
    { wave: 'noise', level: 0.8, amp: env(0.001, 1.8, 0, 0.6), filter: { type: 'highpass', cutoff: 4500, fixed: true } },
    { wave: 'noise', level: 0.3, amp: env(0.001, 0.6, 0, 0.3), filter: { type: 'bandpass', cutoff: 3000, fixed: true, q: 1 } },
  ] },
  ride: { gain: 0.35, oneShot: true, partials: [
    { wave: 'square', level: 0.15, hz: 520, amp: env(0.001, 0.9, 0, 0.3), filter: { type: 'highpass', cutoff: 3000, fixed: true } },
    { wave: 'noise', level: 0.5, amp: env(0.001, 0.9, 0, 0.3), filter: { type: 'bandpass', cutoff: 8000, fixed: true, q: 2 } },
  ] },
  tom: { gain: 0.8, oneShot: true, partials: [
    { wave: 'sine', level: 0.9, amp: env(0.001, 0.4, 0, 0.15), sweep: { cents: 700, time: 0.05 } },
    { wave: 'noise', level: 0.15, amp: env(0.001, 0.05, 0, 0.03), filter: { type: 'lowpass', cutoff: 1500, fixed: true } },
  ] },
  tam: { gain: 0.6, oneShot: true, partials: [
    { wave: 'noise', level: 0.6, amp: env(0.08, 3.5, 0, 1), filter: { type: 'lowpass', cutoff: 1200, fixed: true, q: 1.5 } },
    { wave: 'sine', level: 0.3, hz: 74, amp: env(0.05, 3, 0, 1) },
  ] },
};

/**
 * The Power kit (drum-channel program 16, as GS and GM2 number it): the modern view's metal kit, with a kick that
 * clicks, a snare with a fat body, deep toms and a china in place of the tam-tam.
 */
const POWER: Record<string, Patch> = {
  kick: { gain: 1.25, oneShot: true, partials: [
    { wave: 'sine', level: 1, hz: 50, amp: env(0.001, 0.32, 0, 0.08), sweep: { cents: 3000, time: 0.03 } },
    { wave: 'square', level: 0.25, hz: 1800, amp: env(0.0005, 0.006, 0, 0.004), filter: { type: 'bandpass', cutoff: 3500, fixed: true, q: 1.2 } },
    { wave: 'noise', level: 0.35, amp: env(0.0005, 0.012, 0, 0.006), filter: { type: 'highpass', cutoff: 3000, fixed: true } },
  ] },
  snare: { gain: 0.95, oneShot: true, partials: [
    { wave: 'triangle', level: 0.7, hz: 185, amp: env(0.001, 0.13, 0, 0.06), sweep: { cents: 700, time: 0.02 } },
    { wave: 'sine', level: 0.35, hz: 330, amp: env(0.001, 0.06, 0, 0.03) },
    { wave: 'noise', level: 0.9, amp: env(0.001, 0.26, 0, 0.1), filter: { type: 'bandpass', cutoff: 3200, fixed: true, q: 0.6 } },
    { wave: 'noise', level: 0.35, amp: env(0.001, 0.1, 0, 0.05), filter: { type: 'highpass', cutoff: 7000, fixed: true } },
  ] },
  china: { gain: 0.5, oneShot: true, partials: [
    { wave: 'noise', level: 0.8, amp: env(0.001, 1.1, 0, 0.4), filter: { type: 'bandpass', cutoff: 4200, fixed: true, q: 0.9 } },
    { wave: 'square', level: 0.12, hz: 431, amp: env(0.001, 0.7, 0, 0.3), filter: { type: 'highpass', cutoff: 2500, fixed: true } },
    { wave: 'square', level: 0.1, hz: 617, amp: env(0.001, 0.6, 0, 0.3), filter: { type: 'highpass', cutoff: 3000, fixed: true } },
  ] },
  crash: { gain: 0.55, oneShot: true, partials: [
    { wave: 'noise', level: 0.8, amp: env(0.001, 2.2, 0, 0.6), filter: { type: 'highpass', cutoff: 4000, fixed: true } },
    { wave: 'noise', level: 0.35, amp: env(0.001, 0.8, 0, 0.3), filter: { type: 'bandpass', cutoff: 6000, fixed: true, q: 0.8 } },
  ] },
  tom: { gain: 0.95, oneShot: true, partials: [
    { wave: 'sine', level: 0.95, amp: env(0.001, 0.55, 0, 0.15), sweep: { cents: 900, time: 0.04 } },
    { wave: 'triangle', level: 0.25, octave: 1, amp: env(0.001, 0.12, 0, 0.05) },
    { wave: 'noise', level: 0.2, amp: env(0.001, 0.03, 0, 0.02), filter: { type: 'bandpass', cutoff: 2500, fixed: true } },
  ] },
};

function drumFor(key: number, kit = 0): { patch: Patch; hz?: number } {
  if (kit === 16) {
    if (key === 35 || key === 36) return { patch: POWER.kick! };
    if (key === 38 || key === 40) return { patch: POWER.snare! };
    if (key === 52) return { patch: POWER.china! };
    if (key === 49 || key === 55 || key === 57) return { patch: POWER.crash! };
    if (key >= 41 && key <= 50 && key !== 42 && key !== 44 && key !== 46) return { patch: POWER.tom!, hz: 48 * 2 ** ((key - 41) / 11) };
  }
  if (key === 35 || key === 36) return { patch: DRUM_PATCHES.kick! };
  if (key === 37 || key === 39 || key === 75 || key === 76 || key === 77) return { patch: DRUM_PATCHES.rim! };
  if (key === 38 || key === 40) return { patch: DRUM_PATCHES.snare! };
  if (key === 42 || key === 44 || key === 54 || key === 69 || key === 70) return { patch: DRUM_PATCHES.hat! };
  if (key === 46) return { patch: DRUM_PATCHES.openHat! };
  if (key === 49 || key === 55 || key === 57) return { patch: DRUM_PATCHES.crash! };
  if (key === 51 || key === 53 || key === 59) return { patch: DRUM_PATCHES.ride! };
  if (key === 52) return { patch: DRUM_PATCHES.tam! };
  // Toms (41-50 odd/even) and the rest: a tom tuned by key.
  return { patch: DRUM_PATCHES.tom!, hz: 55 * 2 ** ((key - 35) / 14) };
}

// ---- Engine ------------------------------------------------------------------------------------------------------

export interface Voice {
  ch: number;
  note: number;
  start: number;
  released: boolean;
  /** Release from a time; returns when it falls silent. */
  release(time: number): number;
  /** Silence at once from a time (a voice stolen or cut). */
  kill(time: number): void;
  /** Pitch bend (cents) from a time. */
  bend(cents: number, time: number): void;
  end: number;
}

interface Channel {
  program: number;
  bank: number;
  volume: number;
  expression: number;
  pan: number;
  sustain: boolean;
  bend: number;
  bendRange: number;
  mod: number;
  rpn: [number, number];
  input: GainNode;
  /** The straight path from input to panner, and the amp beside it once a guitar or bass program asks for one. */
  dry: GainNode;
  amp: Amp | null;
  rig: Rig | null;
  panner: StereoPannerNode;
  reverb: GainNode;
  chorus: GainNode;
  held: Voice[];
}

type Rig = 'rhythm' | 'lead' | 'bass';

/** Which amp a program plays through: the modern rig's guitars and bass. */
function rigFor(program: number): Rig | null {
  if (program === 28 || program === 30) return 'rhythm';
  if (program === 29) return 'lead';
  if (program === 33 || program === 34) return 'bass';
  return null;
}

interface Amp {
  /** How hard the preamp is driven, and the level out of the cabinet. */
  drive: GainNode;
  wet: GainNode;
}

const mtof = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class Synth {
  readonly out: GainNode;
  private readonly channels: Channel[] = [];
  private voices: Voice[] = [];
  private readonly noise: AudioBuffer;
  private readonly waves = new Map<Wave, PeriodicWave>();
  /** Sampled instruments, used for every program they have (while sampled is on). */
  soundfont: SoundFont | null = null;
  /** The modern soundtrack plays its own rig, not a SoundFont's samples. */
  sampled = true;

  constructor(readonly ctx: BaseAudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    this.out.connect(comp).connect(destination);
    const reverbIn = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = hall(ctx);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.55;
    reverbIn.connect(convolver).connect(reverbOut).connect(this.out);
    const chorusIn = ctx.createGain();
    chorus(ctx, chorusIn, this.out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 0x1234567;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[i] = (seed / 0x80000000) - 1;
    }
    for (let ch = 0; ch < 16; ch++) {
      const input = ctx.createGain();
      const dry = ctx.createGain();
      const panner = ctx.createStereoPanner();
      const reverb = ctx.createGain();
      const chor = ctx.createGain();
      input.connect(dry).connect(panner).connect(this.out);
      panner.connect(reverb).connect(reverbIn);
      panner.connect(chor).connect(chorusIn);
      this.channels.push({
        program: 0, bank: ch === DRUM_CH ? 128 : 0, volume: 100, expression: 127, pan: 64, sustain: false, bend: 0, bendRange: 2,
        mod: 0, rpn: [127, 127], input, dry, amp: null, rig: null, panner, reverb, chorus: chor, held: [],
      });
      this.mix(ch, 0);
    }
  }

  private wave(w: Wave): PeriodicWave | null {
    if (w === 'sine' || w === 'triangle' || w === 'square' || w === 'saw' || w === 'noise') return null;
    let p = this.waves.get(w);
    if (!p) {
      const n = 48;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) {
        // Brass: a sawtooth with its middle harmonics lifted; reed: odd harmonics; pulse: a 25% pulse; organ:
        // drawbars 16', 8', 4', 2 2/3'.
        if (w === 'brass') imag[k] = (1 / k) * (k >= 3 && k <= 8 ? 1.6 : 1) * (k > 16 ? 0.5 : 1);
        else if (w === 'reed') imag[k] = k % 2 ? 1 / k : 0.08 / k;
        else if (w === 'pulse') imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
        else if (w === 'organ') imag[k] = k === 1 ? 1 : k === 2 ? 0.8 : k === 3 ? 0.5 : k === 4 ? 0.6 : k === 6 ? 0.3 : k === 8 ? 0.25 : 0;
      }
      p = this.ctx.createPeriodicWave(real, imag);
      this.waves.set(w, p);
    }
    return p;
  }

  private mix(ch: number, time: number): void {
    const c = this.channels[ch]!;
    const g = (c.volume / 127) ** 2 * (c.expression / 127) ** 2;
    c.input.gain.setValueAtTime(g, time);
    c.panner.pan.setValueAtTime(Math.max(-1, Math.min(1, (c.pan - 64) / 63)), time);
  }

  get active(): number {
    return this.voices.length;
  }

  noteOn(ch: number, note: number, vel: number, time: number): void {
    const c = this.channels[ch];
    if (!c) return;
    // Notes are scheduled in time order, so a voice silent by this note's start is done with.
    this.voices = this.voices.filter((v) => v.end > time);
    // A drum hit again chokes the one still sounding; any note steals the oldest voice when all are busy.
    if (ch === DRUM_CH) for (const v of this.voices) if (v.ch === ch && v.note === note && !v.released) v.release(time);
    while (this.voices.length >= MAX_VOICES) {
      const victim = this.voices.find((v) => v.released) ?? this.voices[0]!;
      victim.kill(time);
      this.voices.splice(this.voices.indexOf(victim), 1);
    }
    const bend = c.bend * c.bendRange * 100;
    const voice = (this.sampled ? this.soundfont?.voice(this.ctx, c.input, c.bank, ch === DRUM_CH ? 0 : c.program, note, vel, time, bend) : null)
      ?? this.builtIn(ch, c, note, vel, time, bend);
    if (!voice) return;
    voice.ch = ch;
    this.voices.push(voice);
  }

  noteOff(ch: number, note: number, time: number): void {
    const c = this.channels[ch];
    if (!c) return;
    const v = this.voices.find((x) => x.ch === ch && x.note === note && !x.released && x.start <= time);
    if (!v) return;
    if (c.sustain) c.held.push(v);
    else v.release(time);
  }

  control(ch: number, controller: number, value: number, time: number): void {
    const c = this.channels[ch];
    if (!c) return;
    switch (controller) {
      case 0: c.bank = ch === DRUM_CH ? 128 : value; break;
      case 1: c.mod = value; break;
      case 7: c.volume = value; this.mix(ch, time); break;
      case 10: c.pan = value; this.mix(ch, time); break;
      case 11: c.expression = value; this.mix(ch, time); break;
      case 64:
        c.sustain = value >= 64;
        if (!c.sustain) for (const v of c.held.splice(0)) v.release(time);
        break;
      case 91: c.reverb.gain.setValueAtTime(value / 127, time); break;
      case 93: c.chorus.gain.setValueAtTime(value / 127, time); break;
      case 100: c.rpn[0] = value; break;
      case 101: c.rpn[1] = value; break;
      case 6: if (c.rpn[0] === 0 && c.rpn[1] === 0) c.bendRange = value; break;
      case 121:
        c.expression = 127; c.mod = 0; c.sustain = false; c.bend = 0; c.rpn = [127, 127];
        this.mix(ch, time);
        break;
      case 120: case 123:
        for (const v of this.voices) if (v.ch === ch && !v.released) v.release(time);
        break;
    }
  }

  program(ch: number, program: number, time = this.ctx.currentTime): void {
    const c = this.channels[ch];
    if (!c) return;
    c.program = program;
    this.setRig(ch, ch === DRUM_CH ? null : rigFor(program), time);
  }

  /** Switches a channel between its straight path and its amp (built the first time it is wanted). */
  private setRig(ch: number, rig: Rig | null, time: number): void {
    const c = this.channels[ch]!;
    if (rig === c.rig) return;
    c.rig = rig;
    if (rig && !c.amp) c.amp = buildAmp(this.ctx, c.input, c.panner, ch);
    const a = c.amp;
    // The bass keeps some of its clean low end beside the drive.
    c.dry.gain.setValueAtTime(rig === null ? 1 : rig === 'bass' ? 0.45 : 0, time);
    if (!a) return;
    a.drive.gain.setValueAtTime(rig === 'rhythm' ? 34 : rig === 'lead' ? 16 : rig === 'bass' ? 3 : 0, time);
    a.wet.gain.setValueAtTime(rig === 'rhythm' ? 0.3 : rig === 'lead' ? 0.2 : rig === 'bass' ? 0.32 : 0, time);
  }

  pitchBend(ch: number, value: number, time: number): void {
    const c = this.channels[ch];
    if (!c) return;
    c.bend = value / 8192;
    for (const v of this.voices) if (v.ch === ch) v.bend(c.bend * c.bendRange * 100, time);
  }

  /** Releases every voice from a time (a quick fade), and drops any not yet started. */
  cutFrom(time: number, fade = 0.08): void {
    for (const v of this.voices) {
      if (v.start < time) v.release(time);
      v.kill(v.start < time ? time + fade : time);
    }
    this.voices = this.voices.filter((v) => v.start < time);
  }

  /** Every channel's controllers and program back to power-on state from a time (sounding notes carry on). */
  resetChannels(time: number): void {
    this.channels.forEach((c, ch) => {
      Object.assign(c, { program: 0, bank: ch === DRUM_CH ? 128 : 0, volume: 100, expression: 127, pan: 64, sustain: false, bend: 0, bendRange: 2, mod: 0, held: [] });
      this.setRig(ch, null, time);
      c.reverb.gain.setValueAtTime(40 / 127, time);
      c.chorus.gain.setValueAtTime(0, time);
      this.mix(ch, time);
    });
  }

  private builtIn(ch: number, c: Channel, note: number, vel: number, time: number, bend: number): Voice | null {
    const ctx = this.ctx;
    const drum = ch === DRUM_CH ? drumFor(note, c.program) : null;
    const patch = drum ? drum.patch : patchFor(c.program);
    const v01 = vel / 127;
    const out = ctx.createGain();
    out.gain.value = patch.gain * (0.25 + 0.75 * v01 * v01);
    out.connect(c.input);
    const base = drum?.hz ?? mtof(note);
    const nodes: { src: AudioScheduledSourceNode; amp: GainNode; env: Env; detune: AudioParam | null; offset: number }[] = [];
    let lfoGain: GainNode | null = null;
    if (patch.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = patch.vibrato.rate;
      lfoGain = ctx.createGain();
      const depth = patch.vibrato.depth * (1 + c.mod / 32);
      lfoGain.gain.setValueAtTime(0, time);
      lfoGain.gain.linearRampToValueAtTime(depth, time + patch.vibrato.delay + 0.3);
      lfo.connect(lfoGain);
      lfo.start(time);
      nodes.push({ src: lfo, amp: lfoGain, env: env(0, 0, 1, 0), detune: null, offset: 0 });
    }
    let longest = 0;
    for (const p of patch.partials) {
      const amp = ctx.createGain();
      let src: AudioScheduledSourceNode;
      let detune: AudioParam | null = null;
      const f = (p.hz ?? base) * 2 ** (p.octave ?? 0);
      if (p.wave === 'noise') {
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        s.loop = true;
        s.loopEnd = this.noise.duration;
        src = s;
      } else {
        const o = ctx.createOscillator();
        const pw = this.wave(p.wave);
        if (pw) o.setPeriodicWave(pw);
        else o.type = p.wave === 'saw' ? 'sawtooth' : (p.wave as OscillatorType);
        o.frequency.value = Math.min(f, ctx.sampleRate / 2 - 1);
        // Double-tracked guitars on neighbouring channels sit a few cents apart, as two takes do.
        const off = (p.detune ?? 0) + (drum ? 0 : bend) + (c.rig === 'rhythm' ? (ch % 2 ? 5 : -5) : 0);
        o.detune.setValueAtTime(off + (p.sweep?.cents ?? 0), time);
        if (p.sweep) o.detune.setTargetAtTime(off, time, p.sweep.time / 3);
        if (lfoGain && !drum) lfoGain.connect(o.detune);
        detune = o.detune;
        src = o;
      }
      let head: AudioNode = src;
      if (p.filter) {
        const fl = ctx.createBiquadFilter();
        fl.type = p.filter.type ?? 'lowpass';
        fl.Q.value = p.filter.q ?? 0.7;
        const nyq = ctx.sampleRate / 2 - 100;
        const cut = (k: number) => Math.min(nyq, Math.max(20, p.filter!.fixed ? k : k * f));
        const velK = 1 - (p.filter.vel ?? 0) * (1 - v01);
        const lo = cut(p.filter.cutoff * (0.6 + 0.4 * velK));
        if (p.filter.env) {
          const hi = cut((p.filter.cutoff + p.filter.env * velK) * (0.6 + 0.4 * velK));
          const sus = lo + (hi - lo) * (p.filter.s ?? 0);
          fl.frequency.setValueAtTime(lo, time);
          fl.frequency.linearRampToValueAtTime(hi, time + (p.filter.a ?? 0.005));
          fl.frequency.setTargetAtTime(sus, time + (p.filter.a ?? 0.005), (p.filter.d ?? 0.2) / 3);
        } else fl.frequency.setValueAtTime(lo, time);
        src.connect(fl);
        head = fl;
      }
      head.connect(amp).connect(out);
      const e = p.amp;
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(p.level, time + e.a);
      amp.gain.setTargetAtTime(p.level * e.s, time + e.a, Math.max(0.001, e.d / 3));
      src.start(time);
      if (patch.oneShot) {
        const stop = time + e.a + e.d * 1.5 + 0.05;
        src.stop(stop);
        longest = Math.max(longest, stop);
      }
      nodes.push({ src, amp, env: e, detune, offset: p.detune ?? 0 });
    }
    const voice: Voice = {
      ch, note, start: time, released: false, end: patch.oneShot ? longest : Infinity,
      release: (t) => {
        if (voice.released) return voice.end;
        voice.released = true;
        if (patch.oneShot) return voice.end;
        let end = t;
        for (const n of nodes) {
          if (n.detune === null) continue;
          n.amp.gain.cancelScheduledValues(t);
          // Hold the level reached so far, then let it die away.
          n.amp.gain.setTargetAtTime(0, t, Math.max(0.005, n.env.r / 4));
          end = Math.max(end, t + n.env.r * 1.5 + 0.05);
        }
        for (const n of nodes) n.src.stop(end);
        voice.end = end;
        return end;
      },
      kill: (t) => {
        voice.released = true;
        for (const n of nodes) {
          n.amp.gain.cancelScheduledValues(t);
          n.amp.gain.setTargetAtTime(0, t, 0.01);
          try {
            n.src.stop(t + 0.06);
          } catch {
            // Already stopped.
          }
        }
        voice.end = Math.min(voice.end, t + 0.06);
      },
      bend: (cents, t) => {
        if (drum) return;
        for (const n of nodes) if (n.detune) n.detune.setValueAtTime(n.offset + cents, t);
      },
    };
    nodes[nodes.length - 1]?.src.addEventListener('ended', () => out.disconnect());
    return voice;
  }
}

/**
 * A guitar amp and cabinet: tighten the lows, drive a soft-clipping preamp hard, then a 4x12 cabinet's curve (a
 * thump at 110 Hz, the scooped mids, a presence peak and the speaker's roll-off). Right-hand channels come in a few
 * milliseconds late, which spreads a double-tracked pair across the stereo field.
 */
function buildAmp(ctx: BaseAudioContext, input: AudioNode, output: AudioNode, ch: number): Amp {
  const tight = ctx.createBiquadFilter();
  tight.type = 'highpass';
  tight.frequency.value = 120;
  const drive = ctx.createGain();
  drive.gain.value = 0;
  const shaper = ctx.createWaveShaper();
  shaper.curve = clipCurve();
  shaper.oversample = '4x';
  const eq = ([['lowshelf', 110, 1, 0.7], ['peaking', 650, -4, 0.9], ['peaking', 2400, 7, 0.9], ['lowpass', 6500, 0, 0.9], ['lowpass', 9000, 0, 0.7]] as const)
    .map(([type, f, gain, q]) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.gain.value = gain;
      b.Q.value = q;
      return b;
    });
  const late = ctx.createDelay(0.03);
  late.delayTime.value = ch % 2 ? 0.011 : 0;
  const wet = ctx.createGain();
  wet.gain.value = 0;
  let node: AudioNode = input.connect(tight).connect(drive).connect(shaper);
  for (const b of eq) node = node.connect(b);
  node.connect(late).connect(wet).connect(output);
  return { drive, wet };
}

let curve: Float32Array<ArrayBuffer> | null = null;
/** An asymmetric soft clip, as a valve preamp gives. */
function clipCurve(): Float32Array<ArrayBuffer> {
  if (curve) return curve;
  const n = 2048;
  curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.5 + 0.15) - Math.tanh(0.15);
  }
  return curve;
}

/** A stereo hall: decaying noise, darker as it fades, with a few early reflections. */
function hall(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2.6);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = c ? 0x9e3779b9 : 0x7f4a7c15;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = seed / 0x80000000 - 1;
      const t = i / ctx.sampleRate;
      const k = 0.15 + 0.8 * Math.exp(-t * 2.5);
      lp += (n - lp) * k;
      d[i] = lp * Math.exp(-t * 2.6) * (t < 0.012 ? t / 0.012 : 1);
    }
    for (const [ms, g] of [[17, 0.5], [29, 0.35], [43, 0.3], [61, 0.2]] as const) {
      const at = Math.floor(((ms + (c ? 4 : 0)) * ctx.sampleRate) / 1000);
      if (at < len) d[at]! += g;
    }
  }
  return buf;
}

/** A two-tap chorus: the send through two delay lines that wander a few milliseconds, one per side. */
function chorus(ctx: BaseAudioContext, input: AudioNode, output: AudioNode): void {
  const merger = ctx.createChannelMerger(2);
  [0.6, 0.83].forEach((rate, i) => {
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.018 + i * 0.006;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const depth = ctx.createGain();
    depth.gain.value = 0.003;
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();
    input.connect(delay).connect(merger, 0, i);
  });
  merger.connect(output);
}
