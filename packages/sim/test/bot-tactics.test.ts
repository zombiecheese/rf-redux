import { describe, expect, it } from 'vitest';
import {
  GRID, START_GRACE, botThink, createBot, createMatch, decodeTerrain, dock, encodeTerrain, launch, launchNow, stepMatch,
  type Match, type RfwMap, type SlotSetup, type VehicleInput,
} from '../src/index.js';
import { arenaMap, arenaWorld } from './arena.js';

const SIZE = 48;

/** The two-base arena made point-symmetric, so neither side starts with an easier way to the other. */
function mirrored(): RfwMap {
  const map = arenaMap(2);
  const neutral = map.objects.filter((o) => o.base === null);
  for (const o of neutral) map.objects.push({ ...o, x: SIZE - 1 - o.x, y: SIZE - 1 - o.y });
  const seen = new Set<string>();
  map.objects = map.objects.filter((o) => !seen.has(`${o.x},${o.y}`) && !!seen.add(`${o.x},${o.y}`));
  return map;
}

/** The arena with deep water across its middle and no bridge: only a helicopter or a floating jeep gets over. */
function river(): RfwMap {
  const map = arenaMap(2);
  const terrain = decodeTerrain(map.terrain);
  for (let y = 20; y < 28; y++) for (let x = 0; x < SIZE; x++) terrain[y * SIZE + x] = 2;
  map.terrain = encodeTerrain(terrain);
  map.objects = map.objects.filter((o) => o.y < 20 || o.y >= 28);
  return map;
}

/** Plays bots (null for a seat that sits in its bunker) until a side wins or the ticks run out. */
function play(m: Match, levels: (number | null)[], ticks: number): { captures: number } {
  const bots = levels.map((d) => (d === null ? null : createBot(d)));
  let captures = 0;
  for (let t = 0; t < ticks && m.winner === null; t++) {
    const inputs: (VehicleInput | undefined)[] = bots.map((b, p) => {
      if (!b) return undefined;
      const move = botThink(m, p, b);
      if (move.launch) launch(m, p, move.launch);
      if (move.dock) dock(m, p);
      return move.input;
    });
    stepMatch(m, inputs);
    captures += m.events.filter((e) => e.type === 'captured').length;
  }
  return { captures };
}

/** The vehicle a bot in its bunker picks: it takes it a moment (up to a few seconds at low skill). */
function picks(m: Match, p: number, bot: ReturnType<typeof createBot>): string | undefined {
  for (let t = 0; t < 300; t++) {
    const move = botThink(m, p, bot);
    if (move.launch) return move.launch;
    stepMatch(m, []);
  }
  return undefined;
}

const TWO: SlotSetup[] = [{ base: 0, team: 0 }, { base: 1, team: 1 }];

describe('bot tactics', () => {
  it('floats a jeep across deep water to fetch a flag and bring it home', () => {
    const map = river();
    const m = createMatch(arenaWorld(map), map, TWO, 1);
    m.players[0]!.lives = { tank: 0, jeep: 8, asv: 0, heli: 0 };
    // Base 1's flag lies in the open where its flag building stood.
    const flag = m.flags[1]!;
    m.world.building[flag.site] = 0;
    m.world.hp[flag.site] = 0;
    flag.revealed = true;
    const { captures } = play(m, [5, null], 20000);
    expect(captures).toBe(1);
    expect(m.winner).toBe(0);
    expect(m.players[0]!.lives.jeep).toBe(7);
  }, 30000);

  it('sends a helicopter when the target can only be reached by air', () => {
    const map = river();
    const m = createMatch(arenaWorld(map), map, TWO, 1);
    expect(picks(m, 0, createBot(5))).toBe('heli');
  });

  it('lets an ASV fire raised at a helicopter overhead', () => {
    const map = arenaMap(2);
    const m = createMatch(arenaWorld(map), map, TWO, 1);
    launchNow(m, 0, 'asv');
    launchNow(m, 1, 'heli');
    const asv = m.players[0]!.vehicle!;
    const heli = m.players[1]!.vehicle!;
    heli.x = asv.x;
    heli.y = asv.y - (3 << 21);
    heli.z = 30 << 16;
    asv.heading = 0;
    const bot = createBot(9);
    const move = botThink(m, 0, bot);
    expect(move.input?.fire2).toBe(true);
    expect(move.input?.fire).toBeFalsy();
  });

  it('is out once it has lost its last jeep, whatever else it has', () => {
    const map = arenaMap(2);
    const m = createMatch(arenaWorld(map), map, TWO, 1);
    m.players[1]!.lives = { tank: 3, jeep: 0, asv: 3, heli: 3 };
    stepMatch(m, []);
    expect(m.eliminated[1]).toBe(true);
  });

  it('plays a fair game: neither side of a mirrored map is favoured', () => {
    const wins = [0, 0];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const m = createMatch(arenaWorld(mirrored()), mirrored(), TWO, seed);
      play(m, [5, 5], 60000);
      if (m.winner !== null) wins[m.winner]!++;
    }
    expect(wins[0]! + wins[1]!).toBe(8);
    expect(Math.min(wins[0]!, wins[1]!)).toBeGreaterThanOrEqual(3);
  }, 180000);

  it('two strong bots do not trade shots for ever: each stops backing off to repair when nothing is destroyed', () => {
    for (const level of [8, 9]) {
      const m = createMatch(arenaWorld(mirrored()), mirrored(), TWO, 1, { difficulty: level });
      play(m, [level, level], 110000);
      expect(m.winner).not.toBeNull();
    }
  }, 120000);

  it('does not play the same duel out every game: the seeds give different matches', () => {
    const lengths = new Set<number>();
    for (const seed of [1, 2, 3, 4]) {
      const m = createMatch(arenaWorld(mirrored()), mirrored(), TWO, seed);
      play(m, [5, 5], 60000);
      lengths.add(m.tick);
    }
    expect(lengths.size).toBe(4);
  }, 120000);

  it('wins more often at a higher difficulty', () => {
    let strong = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const flip of [false, true]) {
        const m = createMatch(arenaWorld(mirrored()), mirrored(), TWO, seed);
        play(m, flip ? [3, 8] : [8, 3], 60000);
        if (m.winner === (flip ? 1 : 0)) strong++;
      }
    }
    expect(strong).toBeGreaterThanOrEqual(10);
  }, 240000);

  it('plays the same game every time', () => {
    const run = () => {
      const m = createMatch(arenaWorld(mirrored()), mirrored(), TWO, 9);
      play(m, [6, 4], 6000);
      return JSON.stringify({ players: m.players, hp: [...m.world.hp].slice(0, GRID * 4) });
    };
    expect(run()).toBe(run());
  }, 60000);
});

describe('waiting for the players', () => {
  it('stays in the bunker until a human launches, then plays on even after they dock', () => {
    const map = arenaMap(2);
    const m = createMatch(arenaWorld(map), map, TWO, 1);
    const bot = createBot(5, [0]);
    for (let t = 0; t < 600; t++) {
      expect(botThink(m, 1, bot)).toEqual({});
      stepMatch(m, []);
    }
    expect(m.players[1]!.state).toBe('bunker');
    launchNow(m, 0, 'jeep');
    expect(picks(m, 1, bot)).toBeDefined();
    dock(m, 0);
    for (let t = 0; t < 600 && m.players[0]!.state !== 'bunker'; t++) stepMatch(m, []);
    expect(m.players[0]!.state).toBe('bunker');
    expect(picks(m, 1, bot)).toBeDefined();
  });

  it('waits for every human, not just the first to launch, then gives the slow one START_GRACE', () => {
    const map = arenaMap(4);
    const m = createMatch(arenaWorld(map), map, map.bases.slice(0, 3).map((b, i) => ({ base: b.id, team: i + 1 })), 1);
    const bot = createBot(5, [0, 1]);
    launchNow(m, 0, 'tank');
    for (let t = 0; t < START_GRACE - 1; t++) {
      expect(botThink(m, 2, bot)).toEqual({});
      stepMatch(m, []);
    }
    expect(m.players[1]!.state).toBe('bunker');
    stepMatch(m, []);
    expect(picks(m, 2, bot)).toBeDefined();

    // Both launched: it plays straight away.
    const n = createMatch(arenaWorld(map), map, map.bases.slice(0, 3).map((b, i) => ({ base: b.id, team: i + 1 })), 1);
    const quick = createBot(5, [0, 1]);
    launchNow(n, 0, 'tank');
    expect(botThink(n, 2, quick)).toEqual({});
    launchNow(n, 1, 'jeep');
    expect(picks(n, 2, quick)).toBeDefined();
  });

  it('plays at once with nobody to wait for', () => {
    const map = arenaMap(2);
    const m = createMatch(arenaWorld(map), map, TWO, 1);
    expect(picks(m, 1, createBot(5))).toBeDefined();
  });
  it('takes an enemy flag to the nearest base on its team', () => {
    // Bases 0 (top left) and 2 (top right) against 1 (bottom right) and 3 (bottom left).
    const map = arenaMap(4);
    const m = createMatch(arenaWorld(map), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }, { base: 2, team: 0 }, { base: 3, team: 1 }], 1);
    const bot = createBot(5);
    launchNow(m, 0, 'jeep');
    const v = m.players[0]!.vehicle!;
    // The jeep has base 1's flag and stands a few tiles from its team mate's lift, far from its own.
    const mate = m.world.bases[2]!.start;
    v.x = ((mate.tx - 4) << 21) + (1 << 20);
    v.y = ((mate.ty + 3) << 21) + (1 << 20);
    const flag = m.flags[1]!;
    flag.revealed = true;
    flag.carrier = 0;
    let captured = -1;
    for (let t = 0; t < 2000 && captured < 0; t++) {
      const move = botThink(m, 0, bot);
      stepMatch(m, [move.input]);
      if (t === 0) expect(bot.flagHome).toBe(mate.ty * GRID + mate.tx);
      if (m.events.some((e) => e.type === 'captured')) captured = t;
    }
    expect(captured).toBeGreaterThan(0);
    expect(m.eliminated[1]).toBe(true);
    // Its own lift is some 30 tiles away; the team mate's took a fraction of that drive.
    expect(captured).toBeLessThan(600);
    botThink(m, 0, bot);
    expect(bot.flagHome).toBeUndefined();
  });
});
