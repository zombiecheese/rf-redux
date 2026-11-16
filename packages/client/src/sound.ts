// Sound effects: the art pack's own (tools/art/sounds.mjs), or the original's SOUND folder where the art pack has
// none (exported as WAV by tools/convert_assets.py), mixed the way the
// original's sound manager does it (sub_407ba0-sub_408450, DirectSound calls in sub_423af0):
// - Every sound is one of the sound records (0x44b520-0x44b988, 0x18 bytes each): its file, a priority it holds for
//   a number of ticks before dropping to a lower one, flags, a frequency and a volume (16.16).
// - A sound is either attached to an object, heard from where that object is (and from where it was last, once it
//   is gone, unless it loops), or plays everywhere at full loudness.
// - There are two ears. One player hears from 10 px either side of the camera (msgs 6 and 7 from sub_409390);
//   with two, the left ear is player one's camera and the right ear player two's. Loudness by ear falls off from
//   1.0 at 40 px to nothing at 424 px (sub_4082b0).
// - At most 15 sounds play at once (the pool at 0x457248); a new one is dropped when all are busy.
// - Each tick the sounds are sorted by priority, then loudness, and share a budget of 0x7fff per ear (sub_407ec0):
//   each takes what it would be (loudness times its record's volume) or what is left. Its DirectSound volume is the
//   louder ear / 3 - 2200 hundredths of a dB (no louder than 0), its pan the ears' difference over the louder.

import { MINE_ARMED, VEHICLES, type Match, type MatchEvent, type Mine, type Vehicle } from '@rfw/sim';

const NAMES = [
  'boom', 'bushcrus', 'button', 'cannon', 'click', 'concrete', 'ding', 'dirthit', 'expldeb', 'expllar', 'expllow',
  'fuelwarn', 'gatemove', 'heli', 'jeepidle', 'jeepstar', 'laugh', 'metalhi', 'missile', 'missileu', 'outammo',
  'prerais', 'raise', 'servo', 'splash', 'throw1', 'throw2', 'throw3', 'tirein', 'tireout', 'tread', 'bubbles',
  'mancrush', 'drone', 'beacon',
] as const;
type Name = (typeof NAMES)[number];

/**
 * A sound record. The frequency is in Hz, or 0 for the file's own rate. Records with a negative frequency mean it
 * as a fraction of the file's rate, read from the file record's +0x10, but nothing ever fills that word in, so they
 * play at the file's own rate too (DirectSound's DSBFREQUENCY_ORIGINAL).
 */
interface Rec {
  file: Name;
  /** Priority for the first `ticks` ticks (record byte 8), and after (byte 9). */
  pri: number;
  low: number;
  ticks: number;
  /** Byte 11: 1 loops; with no object, 2 silences the right ear, 4 the left, 0x40 both. */
  flags: number;
  hz: number;
  volume: number;
}

const rec = (file: Name, pri: number, low: number, ticks: number, flags: number, hz: number, volume: number): Rec =>
  ({ file, pri, low, ticks, flags, hz: Math.max(0, hz), volume });

/** The engines (0x44b520-0x44b568). */
const TREAD = rec('tread', 210, 100, 10, 1, 1263, 0xd55);
const JEEP = rec('jeepidle', 210, 100, 10, 1, 7058, 0xccc);
const HELI = rec('heli', 210, 100, 10, 1, 0, 0x10a3);
const DRONE = rec('drone', 210, 150, 20, 0x21, -65536, 0x1111);

/** The sound table (0x44b9a0): the explosion scripts and much of the game name sounds by index into it. */
const TABLE: readonly Rec[] = [
  rec('button', 150, 140, 10, 0, 0, 0x1111), // 0 Button
  rec('boom', 199, 150, 60, 0, -18264, 0x1777), // 1 Boom
  rec('boom', 180, 140, 10, 0, -36529, 0xccc), // 2 SmallBoom
  rec('bubbles', 200, 100, 20, 0, 0, 0x1555), // 3 Bubbles
  rec('missile', 180, 140, 20, 0, -34091, 0x1111), // 4 Missle
  rec('missile', 180, 140, 20, 0, -31942, 0x1555), // 5 LargeMissle
  rec('gatemove', 150, 100, 20, 0, 0, 0x1555), // 6 GateMove
  rec('click', 150, 100, 20, 0, -15466, 0x1555), // 7 GateClose
  rec('click', 150, 140, 20, 0, -31470, 0x1111), // 8 GClick
  rec('servo', 120, 120, 20, 0, -39334, 0x1111), // 9 Reload
  rec('ding', 120, 120, 20, 0, 0, 0x1111), // 10 Ding
  rec('fuelwarn', 120, 120, 20, 0, 0, 0x1111), // 11 FuelWarn
  rec('click', 150, 100, 20, 0, -16384, 0x5), // 12 PanelUp
  rec('bushcrus', 120, 110, 20, 0, 0, 0x1111), // 13 BushCrush
  rec('expllar', 190, 110, 40, 0, -32768, 0x1555), // 14 ExplLarge
  rec('expldeb', 190, 110, 40, 0, 0, 0x1111), // 15 ExplDebris
  rec('expllow', 190, 110, 40, 0, 0, 0x1111), // 16 ExplLow
  rec('mancrush', 120, 110, 10, 0, 0, 0x1111), // 17 ManCrush
  rec('cannon', 180, 140, 10, 0, 0, 0x1555), // 18 Cannon
  rec('throw1', 150, 100, 20, 0, -65536, 0x1555), // 19 Throw Grenade1
  rec('throw2', 150, 100, 20, 0, -65536, 0x1555), // 20
  rec('throw3', 150, 100, 20, 0, -65536, 0x1555), // 21
  rec('laugh', 200, 200, 10, 0, 0, 0x2ccc), // 22 Laugh
  rec('click', 200, 200, 0, 4, 0, 0x7333), // 23 TestSnd L
  rec('click', 200, 200, 0, 2, 0, 0x7333), // 24 TestSnd R
  rec('raise', 150, 140, 60, 0, 0, 0xccc), // 25 Raise
  rec('prerais', 150, 140, 60, 0, 0, 0xccc), // 26 PreRaise
  rec('servo', 200, 150, 30, 0, 3932, 0x1555), // 27 Servo
  rec('splash', 180, 150, 20, 0, -65536, 0x1111), // 28 Splash
  rec('splash', 180, 150, 20, 0, -137625, 0x1111), // 29 SmSplash
  rec('metalhi', 180, 150, 20, 2, -65536, 0xeee), // 30 MetalHit1
  rec('metalhi', 180, 150, 20, 2, -65536, 0xeee), // 31 MetalHit2
  rec('metalhi', 180, 150, 20, 0, -52428, 0xeee), // 32 MetalHit3
  rec('metalhi', 180, 150, 20, 0, -85196, 0xeee), // 33 MetalHit4
  rec('missileu', 180, 150, 20, 0, -65536, 0x1333), // 34 Concrete Hit
  rec('concrete', 180, 150, 20, 0, -72089, 0xccc), // 35 SmConcrete Hit
  rec('missileu', 180, 150, 20, 0, -65536, 0x1333), // 36 Dirt Hit
  rec('dirthit', 180, 150, 20, 0, -72089, 0xccc), // 37 SmDirt Hit
  rec('jeepstar', 180, 150, 60, 0, 0, 0x2000), // 38 JeepStart
  rec('beacon', 150, 140, 20, 0, -65536, 0xaaa), // 39 DumbDirect
  rec('tirein', 150, 140, 20, 0, -65536, 0x1555), // 40 TireIn
  rec('tireout', 150, 140, 20, 0, -65536, 0x1555), // 41 TireOut
  rec('click', 150, 140, 20, 0, -32768, 0x1111), // 42 HeliClick
  rec('outammo', 150, 140, 20, 0, -65536, 0x1111), // 43 OutAmmo
];
const sound = (i: number): Rec => TABLE[i]!;
const BUTTON = sound(0);
const BUBBLES = sound(3);
const GATE_MOVE = sound(6);
const GATE_CLOSE = sound(7);
const GCLICK = sound(8);
const DING = sound(10);
const FUEL_WARN = sound(11);
const BUSH_CRUSH = sound(13);
const EXPL_LARGE = sound(14);
const EXPL_DEBRIS = sound(15);
const EXPL_LOW = sound(16);
const MAN_CRUSH = sound(17);
const LAUGH = sound(22);
const RAISE = sound(25);
const SERVO = sound(27);
const SPLASH = sound(28);
const METAL_HIT = sound(30);
const CONCRETE_HIT = sound(34);
const DIRT_HIT = sound(36);
const JEEP_START = sound(38);
const TIRE_IN = sound(40);
const TIRE_OUT = sound(41);
const HELI_CLICK = sound(42);

/** Each projectile type's firing sound (shot type +0x18, played on the shot by sub_4148f0); type 3 is silent. */
const SHOT_SOUNDS: readonly (number | null)[] = [18, 4, 5, null, 4, 18, 4, 18, 5, 5, 5, 18];
/** The grenade throws (PTR_PTR_0044b9ec[rand(3)] in sub_4159a0). */
const THROWS = [19, 20, 21];

/**
 * The tread and jeep loops' pitch range in Hz (vehicle def +0x244 and +0x248): sub_40ee60 sets the frequency to
 * lo + ((hi - lo) * |speed|) >> 16 each tick.
 */
const ENGINE_HZ = { tank: [0x4ef, 0x116a], jeep: [0x1b92, 0x3a0c], asv: [0x4ef, 0x116a] } as const;
/** sub_40eeb0: the heli loop's frequency is 0xa3d Hz plus 0xa3d times the rotor speed (16.16). */
const HELI_HZ = 0xa3d;
/** The jeep idles 0x62 ticks after its start-up sound (sub_40d8f0, sub_40d940). */
const JEEP_IDLE_AFTER = 0x62;
/** The fuel warning sounds every 120 ticks once a vehicle is below an eighth of its fuel (sub_40b980). */
const FUEL_WARN_TICKS = 120;

/** The engine loop's frequency in Hz for a vehicle. */
function engineHz(v: Vehicle): number {
  if (v.kind === 'heli') return HELI_HZ + Math.floor((HELI_HZ * (v.heli?.rotorSpeed ?? 0)) / 65536);
  const [lo, hi] = ENGINE_HZ[v.kind];
  return lo + (((hi - lo) * Math.abs(v.speed)) >> 16);
}

const MAX_VOICES = 15;
/** How long before sounds that failed to load are tried again, on a later key press or tap. */
const RETRY_MS = 10_000;
const EAR_BUDGET = 0x7fff;
/** One player's ears are this far either side of the camera (DAT_00442fd0, 10 px). */
const EAR_OFFSET = 10;

/** Loudness (16.16) at a distance in pixels: full within 40 px, nothing from 424 px (sub_4082b0). */
function loudness(dx: number, dy: number): number {
  const d = Math.floor(Math.hypot(Math.trunc(dx), Math.trunc(dy)));
  const left = 0x1a8 - d;
  if (left > 0x180) return 0x10000;
  return left < 1 ? 0 : Math.floor((left * 0x10000) / 0x180);
}

/** A DirectSound attenuation (hundredths of a dB, 0 or less) as a gain. */
const gain = (db: number) => 10 ** (db / 2000);

interface Point {
  x: number;
  y: number;
}

interface Voice {
  rec: Rec;
  /** Tick it started, for its priority. */
  start: number;
  /** Where it is heard from (pixels), followed each tick while its object lives; null plays everywhere. */
  at: Point | null;
  follow?: () => Point;
  /** The drone loop is heard from the nearest drone to each ear (sub_40a150). */
  nearest?: (ear: Point) => Point | null;
  source: AudioBufferSourceNode;
  left: GainNode;
  right: GainNode;
  ended: boolean;
}

interface Engine {
  voice: Voice | null;
  /** When the jeep's idle starts. */
  idleAt: number;
  phase?: string;
}

/** The sample rate in a WAV file's header (fmt chunk, bytes 24-27), or 0 if it is not a plain WAV. */
function wavRate(data: ArrayBuffer): number {
  if (data.byteLength < 28) return 0;
  const view = new DataView(data);
  return view.getUint32(0, false) === 0x52494646 ? view.getUint32(24, true) : 0;
}

/** World coordinates (16.16) in pixels. */
const px = (x: number, y: number): Point => ({ x: x / 65536, y: y / 65536 });
/** A tile's centre in pixels. */
const tile = (i: number): Point => ({ x: (i % 128) * 32 + 16, y: Math.floor(i / 128) * 32 + 16 });

export class Sound {
  private ctx: AudioContext | null = null;
  private buffers = new Map<Name, AudioBuffer>();
  /** Each sound's own sample rate, which decoding resamples away; pitch is set against it. */
  private rates = new Map<Name, number>();
  private voices: Voice[] = [];
  private engines = new Map<Vehicle, Engine>();
  private fuelWarnAt = new WeakMap<Vehicle, number>();
  private mineLit = new WeakMap<Mine, boolean>();
  private droneLoop: Voice | null = null;
  private tick = 0;
  /** Every voice goes through this, for the volume in Options > Sound and Music > Volume. */
  private out: GainNode | null = null;
  private volume = 1;
  /** Paused with the game: the context stays suspended until the game lets it go. */
  private held = false;
  private loading = false;
  /** When sounds that failed to load may be tried again. */
  private retryAt = 0;
  private tries = 0;

  /** The effects volume as a gain (0-1), master volume and mute included. */
  setVolume(gain: number): void {
    this.volume = gain;
    if (this.out) this.out.gain.value = gain;
  }

  /**
   * Browsers only allow audio after a key press or click, so this is called from each one. The first starts the
   * audio and loads the sounds; later ones start it again if the browser left it suspended (a context made from a
   * key that does not count, such as Esc, or a tap, stays silent until resumed), and retry sounds that failed to load.
   */
  async unlock(): Promise<void> {
    if (this.ctx) {
      if (!this.held && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      if (this.buffers.size < NAMES.length && performance.now() >= this.retryAt) await this.load();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(ctx.destination);
    await this.load();
  }

  /**
   * Every sound effect loaded and decoded, as a match loads, so none is missing (or decoded) when it first plays.
   * Before the first key press or tap there is no audio yet: unlock loads them then.
   */
  async preload(): Promise<void> {
    if (!this.ctx) return;
    await this.loads;
    if (this.buffers.size < NAMES.length && performance.now() >= this.retryAt) await this.load();
  }

  /** The load under way. */
  private loads: Promise<void> | null = null;

  /** Loads every sound not loaded yet. */
  private load(): Promise<void> {
    if (!this.ctx || this.loading) return this.loads ?? Promise.resolve();
    this.loads = this.loadNow().finally(() => (this.loads = null));
    return this.loads;
  }

  private async loadNow(): Promise<void> {
    const ctx = this.ctx!;
    this.loading = true;
    await Promise.all(NAMES.filter((name) => !this.buffers.has(name)).map(async (name) => {
      try {
        // The art pack's own sound (tools/art/sounds.mjs) first, then the asset pack's.
        let res = await fetch(`/art/pack/sound/${name}.wav`).catch(() => null);
        if (!res?.ok) res = await fetch(`/generated/sound/${name}.wav`);
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        const rate = wavRate(data);
        if (rate) this.rates.set(name, rate);
        this.buffers.set(name, await ctx.decodeAudioData(data));
      } catch {
        // A missing or unreadable sound is skipped, and tried again later.
      }
    }));
    this.loading = false;
    // Sounds that were never imported are not asked for forever: the wait doubles each time.
    this.retryAt = performance.now() + RETRY_MS * 2 ** this.tries++;
  }

  /** Starts a sound, heard from a point (pixels) or everywhere; null if it has no buffer or all voices are busy. */
  private start(r: Rec, at: Point | null, follow?: () => Point): Voice | null {
    const ctx = this.ctx;
    const buffer = this.buffers.get(r.file);
    if (!ctx || !buffer) return null;
    if (this.voices.length >= MAX_VOICES) this.voices = this.voices.filter((v) => !v.ended);
    if (this.voices.length >= MAX_VOICES) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = (r.flags & 1) !== 0;
    this.pitch(source, r.file, r.hz);
    // Mono into a gain per ear, so the pan can attenuate either side the way DirectSound's does.
    const left = ctx.createGain();
    const right = ctx.createGain();
    left.gain.value = 0;
    right.gain.value = 0;
    const merger = ctx.createChannelMerger(2);
    source.connect(left).connect(merger, 0, 0);
    source.connect(right).connect(merger, 0, 1);
    merger.connect(this.out ?? ctx.destination);
    const voice: Voice = { rec: r, start: this.tick, at, follow, source, left, right, ended: false };
    source.onended = () => {
      voice.ended = true;
    };
    source.start();
    this.voices.push(voice);
    return voice;
  }

  /** Holds every sound while the game is paused, and lets them carry on after. */
  hold(on: boolean): void {
    this.held = on;
    if (this.ctx) void (on ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
  }

  /** Stops every sound, for leaving a match. */
  reset(): void {
    for (const v of this.voices) this.stop(v);
    this.voices = [];
    this.engines.clear();
    this.droneLoop = null;
  }

  private stop(voice: Voice | null): void {
    if (!voice || voice.ended) return;
    voice.ended = true;
    voice.source.stop();
  }

  private pitch(source: AudioBufferSourceNode, file: Name, hz: number): void {
    const rate = this.rates.get(file);
    source.playbackRate.value = hz && rate ? hz / rate : 1;
  }

  /** A sound from the bunker and menus, heard everywhere: the lift raising, or a click. */
  ui(sound: 'raise' | 'click'): void {
    this.start(sound === 'raise' ? RAISE : GCLICK, null);
  }

  /** The bunker lift on the map (the modern view): its hatch's motors as it opens, and the clunk as it locks at the top. */
  lift(event: 'open' | 'lock', at: number): void {
    this.start(event === 'open' ? SERVO : GATE_CLOSE, tile(at));
  }

  /** Plays the explosion scripts' sounds (index into the sound table, positions in pixels). */
  scripted(sounds: readonly { sound: number; x: number; y: number }[]): void {
    for (const s of sounds) {
      const r = TABLE[s.sound];
      if (r) this.start(r, { x: s.x, y: s.y });
    }
  }

  /**
   * Plays the sounds for one tick's events. With scripts, the explosions' own scripts play the sounds of hits,
   * destroyed vehicles and buildings, and downed drones. viewers, the players shown here, hear their own skulls.
   */
  events(m: Match, events: readonly MatchEvent[], scripts = false, viewers?: readonly number[]): void {
    const jeep = (player: number): Point | null => {
      const v = m.players[player]?.vehicle;
      return v ? px(v.x, v.y) : null;
    };
    for (const e of events) {
      switch (e.type) {
        case 'fired': {
          const at = px(e.x, e.y);
          if (e.shot === 'grenade') this.start(sound(THROWS[Math.floor(Math.random() * 3)]!), at);
          // An ASV laying a mine beeps (sub_409ca0); so does an arming mine each time its light comes on.
          else if (e.shot === 'mine') this.start(BUTTON, at);
          else {
            const s = SHOT_SOUNDS[e.shot];
            if (s != null) this.start(sound(s), at);
          }
          break;
        }
        case 'hit': {
          if (scripts && !(e.target === 'vehicle' && e.shot !== 'mine')) break;
          const at = px(e.x, e.y);
          if (e.target === 'water') this.start(SPLASH, at);
          else if (e.target === 'ground') this.start(DIRT_HIT, at);
          else if (e.target === 'vehicle') this.start(e.shot === 'mine' ? EXPL_LOW : METAL_HIT, at);
          else this.start(CONCRETE_HIT, at);
          break;
        }
        case 'destroyed':
          if (!scripts && !e.fuelOut) this.start(e.drowned ? BUBBLES : EXPL_LARGE, px(e.x, e.y));
          break;
        case 'wreckBlown':
          if (!scripts) this.start(EXPL_DEBRIS, px(e.x, e.y));
          break;
        case 'wreckSunk':
          if (!scripts) this.start(SPLASH, px(e.x, e.y));
          break;
        case 'tyres':
          this.start(e.out ? TIRE_OUT : TIRE_IN, px(e.x, e.y));
          break;
        case 'weapon':
          this.start(HELI_CLICK, px(e.x, e.y));
          break;
        case 'buildingDestroyed':
          if (!scripts) this.start(e.crushed ? BUSH_CRUSH : EXPL_DEBRIS, tile(e.tile));
          break;
        case 'gate':
          this.start(e.sound === 'move' ? GATE_MOVE : GATE_CLOSE, tile(e.tile));
          break;
        case 'soldierKilled':
          this.start(MAN_CRUSH, px(e.x, e.y));
          break;
        case 'droneDown':
          if (!scripts) this.start(EXPL_LARGE, px(e.x, e.y));
          break;
        case 'resupply':
          this.start(DING, px(e.x, e.y));
          break;
        case 'flagTaken':
        case 'captured':
          // On the jeep (sub_432d00-sub_432e40).
          this.start(DING, jeep(e.player));
          break;
        case 'flagReturned':
          // Docking with its own flag (sub_40e090) dings everywhere.
          this.start(DING, null);
          break;
        case 'won':
          this.start(LAUGH, null);
          break;
        case 'laugh':
          // The skull's laugh plays everywhere (sub_418830), for the views shown here.
          if (!viewers || viewers.includes(e.player)) this.start(LAUGH, null);
          break;
      }
    }
  }

  /**
   * One tick of the mixer: engines, the drone loop, fuel warnings and mine beeps, then every sound's volume and
   * pan, heard from the local players' cameras (pixels).
   */
  update(m: Match, cameras: readonly Point[]): void {
    if (!this.ctx) return;
    this.tick = m.tick;
    this.updateEngines(m);
    this.updateDrones(m);
    for (const p of m.players) {
      const v = p.vehicle;
      if (!v) continue;
      // Below an eighth of its fuel (def word 0x84 * 0x2000), and no sooner than 120 ticks after the last.
      if (v.fuel < VEHICLES[v.kind].fuel / 8 && (this.fuelWarnAt.get(v) ?? -1) < m.tick) {
        this.fuelWarnAt.set(v, m.tick + FUEL_WARN_TICKS);
        this.start(FUEL_WARN, px(v.x, v.y));
      }
    }
    for (const mine of m.mines) {
      if (mine.arm >= MINE_ARMED) continue;
      // sub_409cd0: the light is on while the blink counter is below the arming progress's whole part.
      const lit = mine.blink < mine.arm >> 16;
      if (lit && this.mineLit.get(mine) === false) this.start(BUTTON, px(mine.x, mine.y));
      this.mineLit.set(mine, lit);
    }
    this.mix(cameras);
  }

  /**
   * Each vehicle's engine (vehicle def +0x240, started at launch by sub_40b980): the tread loop for the tank and
   * ASV; for the jeep its start-up sound, then the idle loop; for the helicopter the servo, the rotor loop once the
   * engine has wound up (sub_40e8c0), and the servo again as the rotor stops (sub_40ecd0).
   */
  private updateEngines(m: Match): void {
    const live = new Set<Vehicle>();
    for (const p of m.players) {
      const v = p.vehicle;
      if (!v) continue;
      live.add(v);
      const follow = () => px(v.x, v.y);
      let e = this.engines.get(v);
      if (!e) {
        e = { voice: null, idleAt: m.tick + JEEP_IDLE_AFTER };
        this.engines.set(v, e);
        if (v.kind === 'jeep' || v.kind === 'heli') this.start(v.kind === 'jeep' ? JEEP_START : SERVO, follow(), follow);
      }
      // The loop is retried until it starts, in case the sounds were still loading or every voice was busy.
      if ((v.kind === 'tank' || v.kind === 'asv') && !e.voice) e.voice = this.start(TREAD, follow(), follow);
      if (v.kind === 'jeep' && !e.voice && m.tick >= e.idleAt) e.voice = this.start(JEEP, follow(), follow);
      if (v.heli) {
        const phase = v.heli.phase;
        if (!e.voice && phase !== 'spinup' && phase !== 'stop' && phase !== 'docked') {
          e.voice = this.start(HELI, follow(), follow);
        }
        if (phase === 'stop' && e.phase !== 'stop') {
          this.stop(e.voice);
          e.voice = null;
          this.start(SERVO, follow(), follow);
        }
        e.phase = phase;
      }
      if (e.voice) this.pitch(e.voice.source, e.voice.rec.file, engineHz(v));
    }
    // A loop ends with its vehicle.
    for (const [v, e] of this.engines) {
      if (live.has(v)) continue;
      this.stop(e.voice);
      this.engines.delete(v);
    }
  }

  /**
   * One Drone loop while any drone is in the air (sub_40a7b0 starts it with the first, sub_40a010 stops it with the
   * last), heard from the nearest drone.
   */
  private updateDrones(m: Match): void {
    if (!m.drones.length) {
      this.stop(this.droneLoop);
      this.droneLoop = null;
      return;
    }
    if (!this.droneLoop || this.droneLoop.ended) {
      this.droneLoop = this.start(DRONE, null);
      if (!this.droneLoop) return;
    }
    this.droneLoop.nearest = (ear) => {
      let best: Point | null = null;
      let dist = Infinity;
      for (const d of m.drones) {
        const at = px(d.x, d.y);
        const dd = Math.hypot(at.x - ear.x, at.y - ear.y);
        if (dd < dist) {
          dist = dd;
          best = at;
        }
      }
      return best;
    };
  }

  /** sub_407ba0, sub_407d40 and sub_407ec0: priorities, the ears' budgets, then volume and pan. */
  private mix(cameras: readonly Point[]): void {
    this.voices = this.voices.filter((v) => !v.ended);
    const [one, two] = cameras;
    if (!one) return;
    const ears: [Point, Point] = two ? [one, two] : [{ x: one.x - EAR_OFFSET, y: one.y }, { x: one.x + EAR_OFFSET, y: one.y }];
    const hear = (at: Point | null, ear: Point) => (at ? loudness(at.x - ear.x, at.y - ear.y) : 0);
    const heard = this.voices.map((voice) => {
      if (voice.follow) voice.at = voice.follow();
      let l: number;
      let r: number;
      if (voice.nearest) {
        l = hear(voice.nearest(ears[0]), ears[0]);
        r = hear(voice.nearest(ears[1]), ears[1]);
      } else if (voice.at) {
        l = hear(voice.at, ears[0]);
        r = hear(voice.at, ears[1]);
      } else {
        const f = voice.rec.flags;
        l = f & 0x44 ? 0 : 0x10000;
        r = f & 0x42 ? 0 : 0x10000;
      }
      const pri = this.tick - voice.start < voice.rec.ticks ? voice.rec.pri : voice.rec.low;
      return { voice, l, r, pri };
    });
    heard.sort((a, b) => b.pri - a.pri || b.l + b.r - (a.l + a.r));
    let budgetL = EAR_BUDGET;
    let budgetR = EAR_BUDGET;
    for (const { voice, l, r } of heard) {
      // Only a sound some ear can hear gets a DirectSound buffer (sub_407d40).
      if (l <= 0 && r <= 0) {
        voice.left.gain.value = 0;
        voice.right.gain.value = 0;
        continue;
      }
      const vl = Math.min(budgetL, (l * voice.rec.volume) >> 16);
      const vr = Math.min(budgetR, (r * voice.rec.volume) >> 16);
      budgetL -= vl;
      budgetR -= vr;
      const loud = Math.max(vl, vr);
      const db = Math.min(0, Math.trunc(loud / 3) - 0x898);
      const pan = loud === 0 ? 0 : Math.max(-10000, Math.min(10000, Math.trunc(((vr - vl) * 10000) / loud)));
      // DirectSound's pan attenuates the far side: a negative pan quietens the right, a positive one the left.
      voice.left.gain.value = gain(db - Math.max(0, pan));
      voice.right.gain.value = gain(db + Math.min(0, pan));
    }
  }
}
