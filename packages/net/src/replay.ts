// Match replays. The sim is deterministic, so a replay is only how the match started plus every tick's inputs and
// bunker commands: playing them through the sim again rebuilds the whole match, as the lockstep server and clients
// already do. Every match this browser plays (Training, two players, online, as a player or watching) is recorded;
// the client keeps the last few and can save or open them as .rfwreplay.json files.
//
// Inputs are kept as runs of ticks where nobody's controls changed. Online, the server can put this browser's
// match back in step with a snapshot (a desync repair, or a rejoin); the replay keeps those too, at the frame they
// came in, so it plays back what was seen. Hashes every CHECK_EVERY frames tell a replay recorded on an older build
// (whose sim no longer matches) from a good one.

import {
  buildWorld, createMatch, dock, hashMatch, launch, restoreMatch, snapshotMatch, stepMatch,
  type BuildingDef, type Match, type RfwMap, type ShoreTable, type Snapshot,
} from '@rfw/sim';
import { commandFromCode, unpackInput } from './frames.js';

/** 2: the sim's rules changed (empty bases, prisons, drones by dead towers), so older recordings no longer play back. */
export const REPLAY_VERSION = 2;
/** Frames between the hashes kept to check playback against. */
export const CHECK_EVERY = 600;
/** Frames between the states the player keeps for seeking back (20 s). */
export const KEYFRAME_EVERY = 1250;

export interface ReplaySeat {
  base: number;
  team: number;
  name: string;
}

export interface Replay {
  v: typeof REPLAY_VERSION;
  /** When the match was played (ms since 1970). */
  at: number;
  mode: 'training' | 'tournament' | 'online' | 'test';
  mapId: string;
  mapName: string;
  map: RfwMap;
  seed: number;
  difficulty: number;
  /** Extra vehicles for the smaller side (sim startingLives). */
  handicap?: boolean;
  /** How the match was seen when it started (the recording player's view, or the host's pick), to play it back so. */
  look?: { visuals: 'retro' | 'modern'; lighting: 'day' | 'night' };
  /** One per player id. */
  seats: ReplaySeat[];
  /** Online, joined part way: the match as it stood; frames follow from its tick + 1. */
  snapshot?: Snapshot;
  /** [frames, then one packed input per player], flattened. */
  runs: number[];
  /** [frame index, player, command code], in the order they were applied before that frame's tick. */
  commands: [number, number, number][];
  /** The server's state put in place before the frame at that index. */
  repairs: { frame: number; snapshot: Snapshot }[];
  /** [frame index, state hash after it]. */
  checks: [number, number][];
  frames: number;
  /** The winning team, or null for a draw or a match left before the end. */
  winner: number | null;
}

export type ReplayHeader = Omit<Replay, 'v' | 'runs' | 'commands' | 'repairs' | 'checks' | 'frames' | 'winner'>;

export class ReplayRecorder {
  private readonly runs: number[] = [];
  private readonly commands: [number, number, number][] = [];
  private readonly repairs: { frame: number; snapshot: Snapshot }[] = [];
  private readonly checks: [number, number][] = [];
  private last: number[] | null = null;
  private count = 0;
  private frames = 0;
  private closed = false;

  constructor(private readonly header: ReplayHeader) {}

  /** One tick as it was played: its commands ([player, code], in order) and every player's packed input. */
  frame(m: Match, inputs: readonly number[], commands: readonly (readonly [number, number])[]): void {
    if (this.closed) return;
    const players = this.header.seats.length;
    const row = Array.from({ length: players }, (_, p) => inputs[p] ?? 0);
    for (const [p, code] of commands) this.commands.push([this.frames, p, code]);
    if (this.last && row.every((n, p) => n === this.last![p])) this.count++;
    else {
      this.flush();
      this.last = row;
      this.count = 1;
    }
    this.frames++;
    if (this.frames % CHECK_EVERY === 0) this.checks.push([this.frames - 1, hashMatch(m) >>> 0]);
  }

  /** The server replaced the match with this state before the next frame. */
  repair(snapshot: Snapshot): void {
    if (!this.closed) this.repairs.push({ frame: this.frames, snapshot });
  }

  /** Stops recording (the match is over); later frames are not kept. */
  close(): void {
    this.closed = true;
  }

  get length(): number {
    return this.frames;
  }

  private flush(): void {
    if (this.last && this.count) this.runs.push(this.count, ...this.last);
  }

  finish(winner: number | null): Replay {
    const runs = [...this.runs];
    if (this.last && this.count) runs.push(this.count, ...this.last);
    return {
      v: REPLAY_VERSION, ...this.header, runs, commands: [...this.commands], repairs: [...this.repairs], checks: [...this.checks],
      frames: this.frames, winner,
    };
  }
}

/** Throws unless the value looks like a replay this build can play (a file someone opened). */
export function checkReplay(r: unknown): Replay {
  const x = r as Partial<Replay> | null;
  if (!x || typeof x !== 'object' || x.v !== REPLAY_VERSION) throw new Error('Not a replay this version can play');
  if (!Array.isArray(x.seats) || !x.seats.length || x.seats.length > 4 || !x.map || typeof x.map !== 'object') throw new Error('The replay has no match');
  if (!Array.isArray(x.runs) || !Array.isArray(x.commands) || !Array.isArray(x.repairs) || !Array.isArray(x.checks)) throw new Error('The replay is damaged');
  if (!Number.isInteger(x.frames) || x.frames! < 0 || !Number.isInteger(x.seed)) throw new Error('The replay is damaged');
  // An older replay, or a look this build does not know, plays the player's own way.
  const look = x.look;
  if (look && !((look.visuals === 'retro' || look.visuals === 'modern') && (look.lighting === 'day' || look.lighting === 'night'))) delete x.look;
  return x as Replay;
}

/**
 * Plays a replay through the sim, one frame at a time, and jumps to any frame: back from the nearest kept state,
 * forward by playing on.
 */
export class ReplayPlayer {
  match: Match;
  /** Frames played so far: the next frame's index. */
  frame = 0;
  /** A hash did not match: the replay was recorded on another build, and what plays is not what happened. */
  outOfStep = false;
  private readonly inputs: Uint16Array;
  private readonly commandsAt = new Map<number, [number, number][]>();
  private readonly repairsAt = new Map<number, Snapshot>();
  private readonly checksAt = new Map<number, number>();
  private readonly keyframes = new Map<number, Snapshot>();
  private readonly statics: { defs: readonly BuildingDef[]; shore: ShoreTable | null };

  constructor(readonly replay: Replay, defs: readonly BuildingDef[], shore: ShoreTable | null) {
    this.statics = { defs, shore };
    const players = replay.seats.length;
    this.inputs = new Uint16Array(replay.frames * players);
    let f = 0;
    for (let i = 0; i < replay.runs.length && f < replay.frames; i += players + 1) {
      const n = replay.runs[i]!;
      for (let k = 0; k < n && f < replay.frames; k++, f++) {
        for (let p = 0; p < players; p++) this.inputs[f * players + p] = replay.runs[i + 1 + p]! & 0xffff;
      }
    }
    for (const [at, p, code] of replay.commands) this.commandsAt.set(at, [...(this.commandsAt.get(at) ?? []), [p, code]]);
    for (const r of replay.repairs) this.repairsAt.set(r.frame, r.snapshot);
    for (const [at, hash] of replay.checks) this.checksAt.set(at, hash);
    this.match = this.first();
    this.keyframes.set(0, snapshotMatch(this.match));
  }

  private first(): Match {
    const r = this.replay;
    if (r.snapshot) return restoreMatch(r.snapshot, this.statics);
    const world = buildWorld(r.map, this.statics.defs, this.statics.shore);
    return createMatch(world, r.map, r.seats.map((s) => ({ base: s.base, team: s.team })), r.seed, { difficulty: r.difficulty, handicap: r.handicap === true });
  }

  get frames(): number {
    return this.replay.frames;
  }

  get ended(): boolean {
    return this.frame >= this.replay.frames;
  }

  /** Plays the next frame; false at the end. */
  step(): boolean {
    if (this.ended) return false;
    const i = this.frame;
    const repair = this.repairsAt.get(i);
    if (repair) this.match = restoreMatch(repair, this.statics);
    const m = this.match;
    for (const [p, code] of this.commandsAt.get(i) ?? []) {
      const c = commandFromCode(code);
      if (!c || !m.players[p]) continue;
      if ('dock' in c) dock(m, p);
      else launch(m, p, c.launch);
    }
    const players = this.replay.seats.length;
    stepMatch(m, Array.from({ length: players }, (_, p) => (m.players[p] ? unpackInput(this.inputs[i * players + p]!) : undefined)));
    this.frame++;
    const check = this.checksAt.get(i);
    if (check !== undefined && check !== hashMatch(m) >>> 0) this.outOfStep = true;
    if (this.frame % KEYFRAME_EVERY === 0 && !this.keyframes.has(this.frame)) this.keyframes.set(this.frame, snapshotMatch(m));
    return true;
  }

  /** Jumps to a frame: from the nearest kept state at or before it, then plays on without drawing. */
  seek(target: number): void {
    target = Math.max(0, Math.min(this.replay.frames, Math.round(target)));
    if (target < this.frame || target - this.frame > KEYFRAME_EVERY) {
      let from = 0;
      for (const k of this.keyframes.keys()) if (k <= target && k > from) from = k;
      if (from > this.frame || target < this.frame) {
        this.match = restoreMatch(this.keyframes.get(from)!, this.statics);
        this.frame = from;
      }
    }
    while (this.frame < target) this.step();
  }
}
