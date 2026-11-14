// The sound effects, made in code: each is worked out sample by sample from tones, noise and filters, so nothing
// is recorded and nothing comes from the original's sound files. Only the names and the lengths are the game's:
// packages/client/src/sound.ts asks for each by name and plays some of them faster or slower than they were made.
//
// Everything here is plain arithmetic (no Math.sin, no Math.exp), so the files come out the same on any machine
// and the art pack's check can compare them byte for byte.

const RATE = 11025;

/** A sine wave by turns (1 = a whole cycle), from a parabola and one correction: within a thousandth. */
function sine(turns) {
  const x = turns - Math.floor(turns + 0.5);
  const y = 8 * x * (1 - 2 * Math.abs(x));
  return 0.225 * (y * Math.abs(y) - y) + y;
}
const saw = (turns) => 2 * (turns - Math.floor(turns)) - 1;
const square = (turns) => (turns - Math.floor(turns) < 0.5 ? 1 : -1);

/** Noise between -1 and 1, the same run every time for the same seed. */
function noise(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) / 8388608 - 1;
  };
}

/** e to the minus x, for fades: good to a part in a thousand over the range used. */
function fade(x) {
  if (x <= 0) return 1;
  if (x > 12) return 0;
  const h = x / 16;
  let y = 1 / (1 + h + (h * h) / 2 + (h * h * h) / 6);
  for (let i = 0; i < 4; i++) y *= y;
  return y;
}

/** A filter that can be swept: low, band and high outputs around `hz`, ringing more as `q` falls. */
function filter(rate) {
  let low = 0;
  let band = 0;
  return (x, hz, q = 1) => {
    const f = Math.min(1.3, 2 * sine(Math.min(0.24, hz / rate / 2)));
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    return { low, band, high };
  };
}

/** A sound `seconds` long as heard: sample(t, i) gives each sample, t in seconds. */
function make(seconds, sample, rate = RATE) {
  const n = Math.round(seconds * rate);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = sample(i / rate, i);
  return out;
}

/**
 * Scales a sound so its loudest sample is `peak`, and eases the first millisecond and the last few so it starts and
 * ends without a click. A loop is left alone: its end runs into its start.
 */
function finish(samples, { peak = 0.92, loop = false } = {}) {
  let top = 0;
  for (const s of samples) top = Math.max(top, Math.abs(s));
  const k = top ? peak / top : 0;
  const tail = loop ? 0 : Math.min(120, samples.length >> 2);
  const head = loop ? 0 : 12;
  return samples.map((s, i) => s * k * (i < head ? (i + 1) / head : 1) * (i >= samples.length - tail ? (samples.length - i) / tail : 1));
}

/** A thump: a low tone falling from `from` to `to` Hz and dying away over `tau` seconds. */
function thump(from, to, tau, drop = tau) {
  let phase = 0;
  return (t, dt) => {
    phase += (to + (from - to) * fade(t / drop)) * dt;
    return sine(phase) * fade(t / tau);
  };
}

/** Random grains: `per` a second on average, each a tick of noise `len` seconds long. */
function grains(seed, per, len, rate = RATE) {
  const rnd = noise(seed);
  let left = 0;
  let gain = 0;
  return () => {
    if (left <= 0 && rnd() > 1 - (2 * per) / rate) {
      left = Math.round(len * rate * (0.5 + 0.5 * Math.abs(rnd())));
      gain = 0.4 + 0.6 * Math.abs(rnd());
    }
    if (left > 0) {
      left--;
      return rnd() * gain;
    }
    return 0;
  };
}

const DT = 1 / RATE;

/** An explosion: a crack, a falling thump and a rumble that closes down, with crackle if `debris`. */
function blast(seconds, { seed, low = 55, rumble = 700, tau = 0.8, debris = 0, again = [] }) {
  const rnd = noise(seed);
  const body = filter(RATE);
  const grit = filter(RATE);
  const bits = grains(seed + 7, debris, 0.012);
  const hits = [0, ...again].map((at) => ({ at, th: thump(low * 2.4, low, tau * 0.6, 0.09) }));
  return make(seconds, (t) => {
    let s = 0;
    for (const h of hits) {
      if (t < h.at) continue;
      const u = t - h.at;
      const size = h.at ? 0.55 : 1;
      s += size * (h.th(u, DT) * 1.1 + body(rnd(), 80 + rumble * fade(u / (tau * 0.5)), 0.9).low * fade(u / tau) * 1.4 + rnd() * fade(u / 0.012) * 0.7);
    }
    if (debris) s += grit(bits(), 2400, 0.7).band * fade(t / (seconds * 0.45)) * (t > 0.15 ? 0.6 : 0);
    return s;
  });
}

/** A rush of air: noise through a band that slides from one pitch to another. */
function whoosh(seconds, { seed, from, to, attack = 0.03, tau, q = 0.5 }) {
  const rnd = noise(seed);
  const f = filter(RATE);
  return make(seconds, (t) => f(rnd(), from + (to - from) * (t / seconds), q).band * Math.min(1, t / attack) * fade(t / tau));
}

/** A struck piece of metal or a bell: partials that do not line up, each ringing for its own time. */
function ring(seconds, partials, { seed = 1, click = 0.5 } = {}) {
  const rnd = noise(seed);
  return make(seconds, (t) => partials.reduce((s, [hz, gain, tau]) => s + sine(hz * t) * gain * fade(t / tau), rnd() * click * fade(t / 0.004)));
}

/** A loop of `beats` engine strokes: each a kick and a puff of exhaust, over a steady drone. */
function engine(seconds, beats, { seed, kick, drone, rasp = 0.4, rate = RATE }) {
  const rnd = noise(seed);
  const f = filter(rate);
  const per = seconds / beats;
  return make(seconds, (t) => {
    const u = t % per;
    // Whole cycles of the drone fit the loop, so it joins up without a click.
    const hum = saw(Math.round(drone * seconds) * (t / seconds)) * 0.25;
    return sine(kick * u * (1 + fade(u / (per * 0.2)))) * fade(u / (per * 0.3)) + f(rnd(), kick * 6, 0.8).low * fade(u / (per * 0.35)) * rasp + hum;
  }, rate);
}

/** A note on a horn: a sawtooth with its edge taken off, swelling in and held. */
function horn(notes) {
  const f = filter(RATE);
  const end = notes[notes.length - 1][0] + notes[notes.length - 1][1];
  return make(end, (t) => {
    const note = notes.find(([at, len]) => t >= at && t < at + len);
    if (!note) return f(0, 1800, 1).low;
    const u = t - note[0];
    const env = Math.min(1, u / 0.03) * Math.min(1, (note[1] - u) / 0.05);
    return f(saw(note[2] * t) + 0.5 * saw(note[2] * 1.004 * t), 1500 + 900 * Math.min(1, u / 0.1), 0.8).low * env;
  });
}

/** A voice saying "ha": a buzz at the voice's pitch through two mouth-shaped filters, with breath at the start. */
function laugh(seconds, has) {
  const rnd = noise(22);
  const f1 = filter(RATE);
  const f2 = filter(RATE);
  const breath = filter(RATE);
  let phase = 0;
  return make(seconds, (t) => {
    const ha = has.find(([at, len]) => t >= at && t < at + len);
    if (!ha) {
      f1(0, 700, 0.2);
      f2(0, 1150, 0.2);
      return 0;
    }
    const u = (t - ha[0]) / ha[1];
    phase += ha[2] * (1.08 - 0.2 * u) * DT;
    const buzz = saw(phase) * Math.min(1, u * 6) * (1 - u) * (1 - u);
    const h = breath(rnd(), 1600, 0.6).band * fade(u / 0.12) * 0.5;
    return f1(buzz, 640 + 120 * u, 0.18).band * 0.9 + f2(buzz, 1100, 0.2).band * 0.5 + h;
  });
}

/** Beeps: a square tone with its edge taken off (its first three odd harmonics), on for each [start, length]. */
function beeps(seconds, hz, on) {
  return make(seconds, (t) => {
    const b = on.find(([at, len]) => t >= at && t < at + len);
    if (!b) return 0;
    const env = Math.min(1, (t - b[0]) / 0.004, (b[0] + b[1] - t) / 0.004);
    return (sine(hz * t) + sine(3 * hz * t) / 3 + sine(5 * hz * t) / 5) * env;
  });
}

/** A motor: a buzz with a wobble, swelling in and out, grinding a little. */
function motor(seconds, hz, { seed, wobble = 6, grind = 0.3 }) {
  const rnd = noise(seed);
  const f = filter(RATE);
  let phase = 0;
  return make(seconds, (t) => {
    phase += hz * (1 + 0.04 * sine(wobble * t)) * Math.min(1, 0.6 + t / 0.25) * DT;
    const env = Math.min(1, t / 0.08, (seconds - t) / 0.12);
    return (f(saw(phase) + 0.6 * saw(phase * 2.01), hz * 7, 0.7).low + f(rnd(), hz * 9, 0.6).band * grind) * env;
  });
}

/** What the game asks for by name. A loop repeats without a click. */
export function sounds() {
  const out = {};
  const put = (name, samples, opts) => {
    out[name] = finish(samples, opts);
  };

  put('boom', blast(2.94, { seed: 1, low: 48, rumble: 600, tau: 0.7 }));
  put('expldeb', blast(2.67, { seed: 2, low: 60, rumble: 900, tau: 0.5, debris: 260 }));
  put('expllar', blast(7.16, { seed: 3, low: 36, rumble: 800, tau: 1.9, debris: 60, again: [0.42, 0.95, 1.7] }));
  put('expllow', blast(4.49, { seed: 4, low: 32, rumble: 260, tau: 1.3 }));
  put('missileu', blast(1.27, { seed: 5, low: 75, rumble: 1300, tau: 0.3, debris: 120 }));

  // A gun: the crack first, then the thump and the air it pushed.
  {
    const rnd = noise(6);
    const f = filter(RATE);
    const th = thump(170, 55, 0.14, 0.05);
    put('cannon', make(0.94, (t) => rnd() * fade(t / 0.006) + f(rnd(), 300 + 2600 * fade(t / 0.05), 0.8).low * fade(t / 0.22) * 1.2 + th(t, DT) * 1.3));
  }

  put('missile', whoosh(0.88, { seed: 7, from: 500, to: 2700, attack: 0.02, tau: 0.42, q: 0.35 }));
  put('throw1', whoosh(0.38, { seed: 8, from: 900, to: 380, attack: 0.05, tau: 0.13 }));
  put('throw2', whoosh(0.37, { seed: 9, from: 1150, to: 520, attack: 0.04, tau: 0.12 }));
  put('throw3', whoosh(0.33, { seed: 10, from: 760, to: 1250, attack: 0.05, tau: 0.11 }));

  put('metalhi', ring(0.53, [[1130, 1, 0.09], [1790, 0.7, 0.07], [2680, 0.5, 0.05], [3920, 0.35, 0.03], [640, 0.4, 0.05]], { seed: 11, click: 0.9 }));
  put('ding', ring(0.97, [[1320, 1, 0.28], [2647, 0.45, 0.17], [3975, 0.25, 0.09], [5310, 0.1, 0.05]], { seed: 12, click: 0.15 }));
  put('beacon', ring(0.5, [[1480, 1, 0.11], [1486, 0.6, 0.14]], { seed: 13, click: 0 }));
  put('button', beeps(0.19, 990, [[0, 0.05], [0.07, 0.09]]), { peak: 0.5 });
  put('fuelwarn', beeps(0.77, 780, [[0, 0.16], [0.26, 0.16], [0.52, 0.2]]), { peak: 0.5 });
  put('outammo', beeps(0.19, 196, [[0, 0.06], [0.09, 0.08]]), { peak: 0.5 });

  // A latch: a tick, the ring of the plate it hit, and a smaller tick as it settles.
  {
    const rnd = noise(14);
    put('click', make(0.84, (t) => {
      const u = t - 0.11;
      return rnd() * fade(t / 0.002) + sine(1850 * t) * fade(t / 0.012) * 0.7 + sine(640 * t) * fade(t / 0.03) * 0.4 + (u > 0 ? (rnd() * fade(u / 0.002) + sine(2300 * u) * fade(u / 0.008)) * 0.35 : 0);
    }));
  }

  // Hits on the ground: a dull thud and what it throws up.
  {
    const rnd = noise(15);
    const f = filter(RATE);
    const g = grains(16, 90, 0.008);
    const th = thump(110, 60, 0.07);
    put('dirthit', make(0.7, (t) => f(rnd(), 520, 0.9).low * fade(t / 0.09) * 1.3 + th(t, DT) + g() * fade(t / 0.25) * 0.25 * (t > 0.05 ? 1 : 0)));
  }
  {
    const rnd = noise(17);
    const f = filter(RATE);
    const g = grains(18, 160, 0.004);
    put('concrete', make(0.47, (t) => f(rnd(), 1500, 0.5).band * fade(t / 0.05) + rnd() * fade(t / 0.003) * 0.6 + g() * fade(t / 0.16) * 0.5 * (t > 0.03 ? 1 : 0)));
  }
  {
    const f = filter(RATE);
    const g = grains(19, 420, 0.006);
    put('bushcrus', make(1.09, (t) => f(g(), 2600, 0.6).high * Math.min(1, t / 0.04) * fade(t / 0.4)));
  }
  {
    const rnd = noise(20);
    const f = filter(RATE);
    put('mancrush', make(0.27, (t) => f(rnd(), 300 + 1500 * fade(t / 0.04), 0.5).low * fade(t / 0.07) + sine(240 * t * fade(t / 0.2)) * fade(t / 0.05) * 0.6));
  }

  // Water: the slap, the spray falling back, and bubbles.
  {
    const rnd = noise(21);
    const f = filter(RATE);
    const g = grains(23, 500, 0.003);
    put('splash', make(0.81, (t) => f(rnd(), 900 + 2200 * fade(t / 0.1), 0.45).band * fade(t / 0.2) + f(g(), 3000, 0.6).high * fade(t / 0.35) * 0.5));
  }
  {
    const rnd = noise(24);
    let phase = 0;
    let at = 0;
    let len = 0.04;
    let base = 400;
    put('bubbles', make(1.88, (t) => {
      if (t - at > len * 1.25) {
        at = t;
        len = 0.025 + 0.035 * Math.abs(rnd());
        base = 260 + 520 * Math.abs(rnd());
      }
      const u = (t - at) / len;
      phase += base * (1 + 0.9 * u) * DT;
      return u < 1 ? sine(phase) * u * (1 - u) * 4 * fade(t / 1.4) : 0;
    }));
  }

  // The jeep's floats filling with air and letting it go.
  {
    const rnd = noise(25);
    const f = filter(RATE);
    put('tirein', make(1.18, (t) => f(rnd(), 1400 + 2600 * (t / 1.18), 0.25).band * Math.min(1, t / 0.05, (1.18 - t) / 0.2)));
  }
  {
    const rnd = noise(26);
    const f = filter(RATE);
    put('tireout', make(1.05, (t) => f(rnd(), 3600 - 2500 * (t / 1.05), 0.3).band * Math.min(1, t / 0.02) * fade(t / 0.5)));
  }

  put('gatemove', motor(1.68, 68, { seed: 27, wobble: 5, grind: 0.5 }));
  put('servo', motor(1.0, 230, { seed: 28, wobble: 9, grind: 0.15 }));

  // The starter turning over, faster and faster, until the engine catches.
  {
    const rnd = noise(29);
    const f = filter(RATE);
    let phase = 0;
    put('jeepstar', make(0.82, (t) => {
      phase += (14 + 34 * (t / 0.82)) * DT;
      const u = phase - Math.floor(phase);
      return sine(90 * u * (1 + fade(u / 0.2))) * fade(u / 0.3) + f(rnd(), 700, 0.8).low * fade(u / 0.35) * 0.5 * Math.min(1, t / 0.1);
    }));
  }

  // The flag going up: a roll on the drum, then the call.
  {
    const rnd = noise(30);
    const f = filter(RATE);
    put('prerais', make(1.04, (t) => {
      const u = (t * 26) % 1;
      return f(rnd(), 1900, 0.5).band * fade(u / 0.25) * (0.25 + 0.75 * (t / 1.04));
    }));
  }
  put('raise', horn([[0, 0.2, 392], [0.24, 0.2, 523.25], [0.48, 0.2, 659.25], [0.72, 0.5, 784], [1.3, 0.2, 659.25], [1.54, 0.2, 784], [1.78, 1.36, 1046.5]]));

  put('laugh', laugh(3.81, [[0.05, 0.42, 150], [0.52, 0.36, 142], [0.93, 0.33, 134], [1.3, 0.31, 126], [1.65, 0.3, 118], [1.99, 0.3, 110], [2.33, 0.34, 102], [2.72, 0.8, 92]]));

  // The engines, which loop. The game plays the tank's far slower than it is stored and the jeep's a little slower,
  // so each is made at the speed it is heard at.
  put('tread', engine(20622 / 1263, 147, { seed: 31, kick: 46, drone: 31, rasp: 0.7, rate: 1263 }), { loop: true });
  put('jeepidle', engine(6682 / 7058, 27, { seed: 32, kick: 85, drone: 57, rasp: 0.5, rate: 7058 }), { loop: true });
  {
    // The helicopter: 24 beats of the blades, each a thud and a wash of air, over the turbine's whine.
    const rnd = noise(33);
    const f = filter(RATE);
    const per = 1.58 / 24;
    put('heli', make(1.58, (t) => {
      const u = t % per;
      return sine(70 * u) * fade(u / (per * 0.25)) + f(rnd(), 420, 0.7).low * (0.25 + fade(u / (per * 0.3))) * 0.8 + sine(Math.round(1.58 * 610) * (t / 1.58)) * 0.08;
    }), { loop: true });
  }
  {
    // The drone: two buzzes a little apart, beating four times a loop.
    const n = 58;
    put('drone', make(0.53, (t) => saw(n * (t / 0.53)) * 0.6 + saw((n + 4) * (t / 0.53)) * 0.5 + square(2 * n * (t / 0.53)) * 0.15), { loop: true });
  }
  return out;
}

/** A sound as an 8-bit mono WAV file at the game's 11025 Hz. */
export function wav(samples) {
  const out = Buffer.alloc(44 + samples.length);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples.length, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE, 28);
  out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples.length, 40);
  for (let i = 0; i < samples.length; i++) out[44 + i] = Math.max(0, Math.min(255, Math.round(128 + samples[i] * 127)));
  return out;
}
