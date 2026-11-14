// The music director, ported from the original (sub_40ef00-sub_40f694, its pieces at 0x4463b8). It picks what
// plays from what is happening, the same way, and drives the MIDI player (music.ts) where the original drove the
// CD (its MCI thread, sub_405140-sub_4056a0):
// - There are 18 pieces (PIECES). A request names one (or silence) with a priority; it is refused when the
//   piece playing holds a higher priority, or the same one and the new piece's own range does not take it in.
//   A granted priority then sinks by one a tick, down to 40 below where it started (sub_40f1c0, sub_40efe0).
// - A piece may watch an object (the vehicle it was asked for); when that goes, the music stops.
// - Switching from one piece to the next goes one of three ways, by the new piece's table of the pieces it may
//   follow, else its default: fade the old one out first, change on the beat (one tank theme to another), or cut
//   straight in (a vehicle's death). The original's fourth way (return to the previous piece) no table uses.
// - When a piece ends: one that plays once hands back to the piece before it if a player is driving, else to the
//   Bunker theme; one that loops goes again from its loop section (sub_40f600).
// - Each tick the situation is weighed in order (sub_40f3c0): a vehicle destroyed (its own death piece if it was
//   the vehicle being scored, else Death), a flag discovered, the submarine out, a flag picked up by its enemy, a
//   player driving (the vehicle's theme), every player in the bunker (Bunker). A small state number keeps a
//   situation's piece from being asked for again each tick, and steps back down when the situation is over.
//
// What triggers each part (sub_40b980 driving, sub_40c7e0 a vehicle's death, 0x432803 a flag shown, 0x432ac9 a flag
// taken, sub_434b30 the submarine) is in music.ts. The original's random picks used the game's random numbers;
// here they use the client's own, since music must not touch the shared deterministic sim.

export type Transition = 'fade' | 'beat' | 'cut' | 'previous';

export interface Piece {
  name: string;
  /** The MIDI piece (pieces.ts) and its sections: where it starts, where it loops back to. */
  file: string;
  start: string | null;
  loop: string | null;
  /** Plays once rather than looping (the original's play flag 2). */
  once: boolean;
  /** At equal priority, the pieces it takes over from (bytes 1 and 2). */
  min: number;
  max: number;
  /** Its default transition (byte 9), and the pieces it follows differently (the table at +0x10). */
  transition: Transition;
  after?: Record<number, Transition>;
}

const TANK_FROM: Record<number, Transition> = { 0: 'beat', 1: 'beat', 2: 'beat' };
const HELI_FROM: Record<number, Transition> = { 8: 'beat', 9: 'beat' };

/**
 * The pieces, in the original's order (0x4463b8, 0x2c bytes each). The CD tracks they played are now sections of
 * our MIDI pieces: the tank suite's three movements, the helicopter's two, the drums' intro and loop.
 */
export const PIECES: readonly Piece[] = [
  { name: 'Tank 1', file: 'tank', start: 'a', loop: 'c', once: false, min: 0, max: 3, transition: 'fade', after: TANK_FROM },
  { name: 'Tank 2', file: 'tank', start: 'b', loop: 'a', once: false, min: 0, max: 3, transition: 'fade', after: TANK_FROM },
  { name: 'Tank 3', file: 'tank', start: 'c', loop: 'a', once: false, min: 0, max: 3, transition: 'fade', after: TANK_FROM },
  { name: 'Tank Death', file: 'tank-death', start: null, loop: null, once: true, min: 0, max: 3, transition: 'fade', after: { 0: 'cut', 1: 'cut', 2: 'cut' } },
  { name: 'Jeep 1', file: 'jeep', start: null, loop: null, once: false, min: 4, max: 4, transition: 'fade', after: { 4: 'beat' } },
  // The jeep's death played the same CD track as Death.
  { name: 'Jeep Death', file: 'death', start: null, loop: null, once: true, min: 5, max: 5, transition: 'fade', after: { 4: 'cut', 12: 'cut' } },
  { name: 'MSV 1', file: 'asv', start: null, loop: null, once: false, min: 6, max: 7, transition: 'fade', after: { 6: 'beat' } },
  { name: 'MSV Death', file: 'asv-death', start: null, loop: null, once: true, min: 6, max: 7, transition: 'fade', after: { 6: 'cut' } },
  { name: 'Heli 1', file: 'heli', start: 'a', loop: 'b', once: false, min: 8, max: 10, transition: 'fade', after: HELI_FROM },
  { name: 'Heli 2', file: 'heli', start: 'b', loop: 'a', once: false, min: 8, max: 3, transition: 'fade', after: HELI_FROM },
  { name: 'HELI Death', file: 'heli-death', start: null, loop: null, once: true, min: 8, max: 10, transition: 'fade', after: { 8: 'cut', 9: 'cut' } },
  { name: 'Flag Discovery', file: 'flag-discovery', start: null, loop: null, once: true, min: 11, max: 11, transition: 'cut' },
  { name: 'Flag Pickup', file: 'flag-pickup', start: null, loop: null, once: false, min: 12, max: 12, transition: 'fade' },
  { name: 'Win', file: 'win', start: null, loop: null, once: true, min: 13, max: 13, transition: 'cut' },
  { name: 'Bunker', file: 'bunker', start: null, loop: null, once: false, min: 14, max: 14, transition: 'fade' },
  { name: 'Death', file: 'death', start: null, loop: null, once: true, min: 15, max: 15, transition: 'cut' },
  { name: 'Sub', file: 'sub', start: null, loop: null, once: true, min: 16, max: 16, transition: 'fade' },
  { name: 'Drums', file: 'drums', start: 'intro', loop: 'loop', once: false, min: 17, max: 17, transition: 'cut' },
];

export const TANK_1 = 0, TANK_2 = 1, TANK_3 = 2, JEEP_1 = 4, MSV_1 = 6, HELI_1 = 8, HELI_2 = 9;
export const FLAG_DISCOVERY = 11, FLAG_PICKUP = 12, WIN = 13, BUNKER = 14, DEATH = 15, SUB = 16, DRUMS = 17;
export const STOP = -1;

export type VehicleKind = 'tank' | 'jeep' | 'asv' | 'heli';

/** Each vehicle's piece and priority (vehicle definition +0x2bc, +0x2bd), and its death piece (0x4466e4). */
export const VEHICLE_PIECE: Record<VehicleKind, number> = { tank: TANK_1, jeep: JEEP_1, asv: MSV_1, heli: HELI_1 };
export const VEHICLE_PRIORITY = 0x80;
export const DEATH_PIECE: Record<VehicleKind, number> = { tank: 3, jeep: 5, asv: 7, heli: 10 };

/** What the director asks of the player. */
export interface MusicOut {
  /** Starts a piece: from its loop section when looping round, on the beat, at once, or after a fade. */
  play(piece: Piece, fromLoop: boolean, how: 'start' | 'beat' | 'cut'): void;
  fadeOut(): void;
  stop(): void;
  readonly fading: boolean;
  /** Whether music can play at all (the original's CD-audio-ready flag, 0x48c534). */
  readonly ready: boolean;
}

/** The facts the director weighs each tick, gathered by music.ts from the match. */
export interface Situation {
  /** A flag was uncovered this tick (any base's). */
  flagRevealed: boolean;
  /** A flag was picked up by a jeep of another side this tick. */
  flagTaken: boolean;
  /** The submarine is out. */
  sub: boolean;
  /** A player on this machine is driving (sub_40b980 runs for each vehicle each tick). */
  driving: boolean;
  /** How many of this machine's players are in their bunker, and how many players this machine has. */
  inBunker: number;
  humans: number;
}

/** What the director needs to pick a vehicle's theme (sub_40f2f0). */
export interface Scored<V> {
  vehicle: V;
  kind: VehicleKind;
  /** The driver's own flag is out and being carried off. */
  ownFlagCarried: boolean;
  /** An enemy flag lies uncovered within 128 px. */
  enemyFlagNear: boolean;
  /** How many more of this kind its player has in the bunker while this one is out (255 when unlimited). */
  left: number;
}

const FADE = 0, BEAT = 1, CUT = 2, PREVIOUS = 3;
const TRANSITION_FN: Record<Transition, number> = { fade: FADE, beat: BEAT, cut: CUT, previous: PREVIOUS };

export class Director<V extends object = object> {
  requested: number | null = null;
  current: number | null = null;
  previous: number | null = null;
  priority = 0;
  private floor = 0;
  /** The object the last request watched, and the one being watched. */
  private watchAsked: V | null = null;
  private watching: V | null = null;
  /** The transition under way, how many ticks it has run, whether a new piece is due to start, and how. */
  private step: number | null = null;
  private stepTicks = 0;
  private changed = false;
  private how: 'start' | 'beat' | 'cut' = 'start';
  /** Set by a looping piece's end: the next start is from its loop section (0x4462f8). */
  private fromLoop = false;
  /** Music switched off (0x48c548). */
  off = false;
  /** The situation number (0x48c73c), the vehicle being scored (0x48c794) and the last one launched (0x48c748). */
  state = 0;
  private scored: V | null = null;
  private launched: V | null = null;
  private pendingDeath: { vehicle: V; kind: VehicleKind } | null = null;

  constructor(
    private readonly out: MusicOut,
    /** Whether a watched or launched vehicle is still in play. */
    private readonly alive: (v: V) => boolean,
    /** Whether player 1 or 2 (on this machine) is driving, for handing back after a piece that plays once. */
    private readonly driving: (local: number) => boolean,
    private readonly humans: () => number,
    private readonly random: (n: number) => number = (n) => Math.floor(Math.random() * n),
  ) {}

  /** Asks for a piece, or STOP, at a priority (sub_40f1c0). Returns 0 if taken, -1 if refused, -10 if no such piece. */
  request(id: number, priority: number, watch: V | null = null): number {
    if (id >= PIECES.length) return -10;
    const piece = id >= 0 ? id : null;
    this.watchAsked = watch;
    if (piece === this.requested) return 0;
    if (this.priority > priority) return -1;
    if (this.priority === priority && piece !== null && (PIECES[piece]!.min > id || PIECES[piece]!.max < id)) return -1;
    if (piece === null) {
      this.priority = 0;
      this.floor = 0;
      this.requested = null;
      return 0;
    }
    this.priority = priority;
    this.floor = priority - 40;
    this.requested = piece;
    return 0;
  }

  /** One tick (sub_40efe0): priority decays, a watched object that has gone stops the music, pieces change. */
  update(): void {
    if (this.priority > 0 && this.priority > this.floor) this.priority--;
    if (this.watching && !this.alive(this.watching)) {
      this.watching = null;
      this.request(STOP, 0x7fffffff);
    }
    for (;;) {
      if (this.step !== null) {
        if (!this.runStep(this.step)) return;
        this.step = null;
        this.stepTicks++;
      }
      if (this.requested === this.current) break;
      this.changed = true;
      let fn = FADE;
      if (this.requested !== null) {
        const next = PIECES[this.requested]!;
        fn = TRANSITION_FN[next.transition];
        const special = this.current !== null ? next.after?.[this.current] : undefined;
        if (special) fn = TRANSITION_FN[special];
      } else this.priority = 0;
      this.previous = this.current;
      this.current = this.requested;
      this.stepTicks = 0;
      this.step = fn;
    }
    if (this.watchAsked !== this.watching) this.watching = this.watchAsked;
    if (this.watching && !this.alive(this.watching)) {
      this.watching = null;
      this.requested = null;
    }
    if (this.current === null) return;
    if (this.changed) {
      this.changed = false;
      if (this.out.ready) {
        // With the music off the piece counts as playing, silently (the CD thread's play does nothing then).
        if (!this.off) this.out.play(PIECES[this.current]!, this.fromLoop, this.how);
        this.fromLoop = false;
      } else this.requested = null;
    }
    if (!this.out.ready) this.requested = null;
  }

  /** The transitions (0x4466d0): each returns whether it is done. */
  private runStep(fn: number): boolean {
    switch (fn) {
      case FADE:
        if (this.out.ready) {
          if (this.stepTicks === 0) this.out.fadeOut();
          if (this.out.fading) return false;
          this.out.stop();
        }
        this.how = 'start';
        return true;
      case BEAT:
        this.how = 'beat';
        return true;
      case CUT:
        this.how = 'cut';
        return true;
      default:
        this.stepTicks = 0;
        this.requested = this.current = this.previous;
        return true;
    }
  }

  /** The playing piece has reached its end (sub_40f600, called by the CD thread when a track finished). */
  ended(): void {
    if (this.off || this.current === null) return;
    const piece = PIECES[this.current]!;
    if (piece.once) {
      if (this.current === WIN) return;
      this.priority = 0;
      const prev = this.previous;
      const back = this.driving(0) || (this.humans() === 2 && this.driving(1));
      this.state = 0;
      if (back && prev !== null) {
        this.request(prev, 100);
        this.previous = prev;
      } else this.request(BUNKER, 0x40);
      return;
    }
    if (this.current === WIN) {
      this.off = true;
      return;
    }
    const id = this.current;
    this.fromLoop = true;
    this.current = null;
    this.requested = null;
    this.state = 0;
    this.request(id, 0x80);
  }

  /** A vehicle came out of the bunker (sub_40b980's first tick): its theme, watching it. */
  launch(vehicle: V, kind: VehicleKind): void {
    this.launched = vehicle;
    this.request(VEHICLE_PIECE[kind], VEHICLE_PRIORITY, vehicle);
  }

  /** A vehicle was destroyed (sub_40c7e0). */
  destroyed(vehicle: V, kind: VehicleKind): void {
    this.pendingDeath = { vehicle, kind };
  }

  /** The theme for a vehicle, as sub_40f2f0 picks it. */
  pick(s: Scored<V>): number {
    if (s.kind === 'tank') {
      if (s.ownFlagCarried || s.enemyFlagNear) return TANK_3;
      // With exactly two more of the kind left in the bunker (the player's count, record +0xb8 + kind, which
      // launching takes one off) it is the first theme outright: the first tank or helicopter of the default three.
      if (s.left === 2) return TANK_1;
      return this.random(8) < 4 ? TANK_1 : TANK_2;
    }
    if (s.kind === 'heli') return s.left === 2 ? HELI_1 : this.random(8) < 4 ? HELI_1 : HELI_2;
    return VEHICLE_PIECE[s.kind];
  }

  /** Weighs the situation, once a tick after update() (sub_40f3c0). scoring describes the last launched vehicle. */
  situation(s: Situation, scoring: (v: V) => Scored<V> | null): void {
    if (this.current === null && this.state > 1) this.state = 1;
    const death = this.pendingDeath;
    if (death) {
      this.pendingDeath = null;
      let piece = DEATH_PIECE[death.kind];
      if (this.scored === death.vehicle) this.scored = null;
      if (this.state < 9) {
        if (this.state !== 4) {
          this.scored = null;
          piece = DEATH;
        }
        if (!this.scored) {
          this.request(piece, 0x80);
          this.state = 9;
          return;
        }
      }
    }
    if (s.flagRevealed && this.state < 8) {
      this.request(FLAG_DISCOVERY, 0xfe);
      this.state = 7;
      return;
    }
    if (s.sub) {
      if (this.state < 6) {
        this.request(SUB, 0x8a);
        this.state = 6;
      }
    } else if (this.state === 6) this.state = 1;
    if (s.flagTaken) {
      this.request(FLAG_PICKUP, 0x8a);
      this.state = 5;
      return;
    }
    if (this.state === 5) this.state = 1;
    if (s.driving) {
      if (this.state < 4 && this.launched && this.alive(this.launched)) {
        const sc = scoring(this.launched);
        if (sc) {
          this.request(this.pick(sc), 0x80);
          this.state = 4;
          this.scored = this.launched;
          return;
        }
      }
    } else if (this.state === 4) this.state = 2;
    if (s.humans <= s.inBunker && this.state < 3) {
      this.request(BUNKER, 0x68);
      this.state = 3;
    }
    if (this.state === 1) {
      this.request(STOP, 100);
      this.state = 0;
    }
  }

  /** A match starts with every player in the bunker (sub_420b10). */
  matchStart(): void {
    this.state = 0;
    this.scored = this.launched = null;
    this.pendingDeath = null;
    this.request(BUNKER, 0x80);
  }

  /** The win sequence (sub_4056a0): the Win piece over everything. */
  win(): void {
    this.request(WIN, 0xff);
  }

  /** The front end's main state (sub_421fe0): Drums, from no priority. */
  menus(): void {
    this.priority = 0;
    this.request(DRUMS, 0x32);
  }

  /** Starts the current piece again from the top, after something else used the player (the splash fanfare) or the soundtrack changed. */
  replay(): void {
    if (this.current === null) return;
    this.changed = true;
    this.how = 'cut';
  }

  /** Music off (sub_405660) and back on (sub_405680, which carries on as if the piece had ended). */
  setOff(off: boolean): void {
    if (off) {
      this.off = true;
      this.request(STOP, 0x100);
    } else {
      this.off = false;
      this.ended();
    }
  }
}
