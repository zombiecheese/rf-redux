// Solo runs for the leaderboards. A Training game in the browser records the player's controls and bunker commands
// tick by tick; the server plays the run again in the sim, with the same bot, and accepts the time only if the
// player really won. The recording is small: runs of unchanged input, plus the ticks that had commands.

import { buildWorld, botThink, createBot, createMatch, dock, launch, stepMatch, type BuildingDef, type Match, type RfwMap, type ShoreTable, type VehicleInput } from '@rfw/sim';
import { commandFromCode, unpackInput } from './frames.js';

export interface SoloLog {
  mapId: string;
  seed: number;
  difficulty: number;
  /** [ticks, packed input] pairs, flattened, covering the whole run. */
  runs: number[];
  /** [tick, command code] for player 0's bunker commands, applied before that tick's bot move. */
  commands: [number, number][];
}

/** Longest run accepted (30 minutes of game time). */
export const SOLO_MAX_TICKS = 112_500;

export class SoloRecorder {
  private readonly runs: number[] = [];
  private readonly commands: [number, number][] = [];
  private last = -1;
  private count = 0;
  private tick = 0;

  constructor(readonly mapId: string, readonly seed: number, readonly difficulty: number) {}

  /** A command for the coming tick (call before tick()). */
  command(code: number): void {
    this.commands.push([this.tick + 1, code]);
  }

  /** The input played on the coming tick. */
  input(packed: number): void {
    this.tick++;
    if (packed === this.last) this.count++;
    else {
      if (this.count) this.runs.push(this.count, this.last);
      this.last = packed;
      this.count = 1;
    }
  }

  log(): SoloLog {
    const runs = this.count ? [...this.runs, this.count, this.last] : [...this.runs];
    return { mapId: this.mapId, seed: this.seed, difficulty: this.difficulty, runs, commands: [...this.commands] };
  }
}

/**
 * Plays a recorded run as the Training game does: player 0 on base 0 against a bot on every other base, each base
 * its own team (the one layout the leaderboards keep times for).
 */
export function replaySolo(log: SoloLog, map: RfwMap, defs: readonly BuildingDef[], shore: ShoreTable | null): Match {
  const m = createMatch(buildWorld(map, defs, shore), map, map.bases.map((b) => ({ base: b.id, team: b.id })), log.seed, { difficulty: log.difficulty });
  // As in the Training game, the bots wait until the player launches.
  const bots = m.players.slice(1).map((p) => ({ id: p.id, bot: createBot(null, [0]) }));
  const commands = new Map<number, number[]>();
  for (const [t, c] of log.commands) commands.set(t, [...(commands.get(t) ?? []), c]);
  let tick = 0;
  for (let i = 0; i + 1 < log.runs.length && m.winner === null; i += 2) {
    const input = unpackInput(log.runs[i + 1]!);
    for (let n = 0; n < log.runs[i]! && m.winner === null; n++) {
      tick++;
      if (tick > SOLO_MAX_TICKS) return m;
      for (const code of commands.get(tick) ?? []) {
        const c = commandFromCode(code);
        if (c && 'dock' in c) dock(m, 0);
        else if (c) launch(m, 0, c.launch);
      }
      const inputs: (VehicleInput | undefined)[] = [input];
      for (const { id, bot } of bots) {
        const move = botThink(m, id, bot);
        if (move.launch) launch(m, id, move.launch);
        if (move.dock) dock(m, id);
        inputs.push(move.input);
      }
      stepMatch(m, inputs);
    }
  }
  return m;
}
