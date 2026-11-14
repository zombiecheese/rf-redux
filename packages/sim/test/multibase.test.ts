import { describe, expect, it } from 'vitest';
import {
  GRID, TILE_SIZE, TURRET_RANGE, UNLIMITED, botThink, headingTo, createBot, createMatch, dock, launch, launchNow, prisonersOf, rivalOf, capturesNeeded, startingLives, stepMatch,
  type Match, type SlotSetup, type VehicleInput,
} from '../src/index.js';
import { arenaMap, arenaWorld } from './arena.js';

function play(slots: SlotSetup[], ticks: number, seed = 3): { m: Match; kills: number; events: Set<string>; taken: { base: number; player: number }[] } {
  const map = arenaMap(4);
  const m = createMatch(arenaWorld(map), map, slots, seed, { difficulty: 9 });
  const bots = m.players.map(() => createBot());
  let kills = 0;
  const events = new Set<string>();
  const taken: { base: number; player: number }[] = [];
  for (let t = 0; t < ticks && m.winner === null; t++) {
    const inputs: (VehicleInput | undefined)[] = bots.map((b, p) => {
      const move = botThink(m, p, b);
      if (move.launch) launch(m, p, move.launch);
      if (move.dock) dock(m, p);
      return move.input;
    });
    stepMatch(m, inputs);
    for (const e of m.events) {
      events.add(e.type);
      if (e.type === 'destroyed') kills++;
      if (e.type === 'flagTaken') taken.push({ base: e.base, player: e.player });
    }
  }
  return { m, kills, events, taken };
}

describe('three and four bases', () => {
  it('free for all: four bots on four bases fight it out', () => {
    const { kills, events } = play([0, 1, 2, 3].map((b) => ({ base: b, team: b })), 12000);
    expect(kills).toBeGreaterThan(3);
    expect(events.has('flagTaken')).toBe(true);
  }, 30000);

  it('2v2: bots only take enemy flags', () => {
    const slots = [{ base: 0, team: 0 }, { base: 1, team: 1 }, { base: 2, team: 1 }, { base: 3, team: 0 }];
    const { taken } = play(slots, 60000, 3);
    expect(taken.length).toBeGreaterThan(0);
    // A jeep may fetch its own base's exposed flag to hide it again, but never a teammate's.
    for (const t of taken) if (t.base !== slots[t.player]!.base) expect(slots[t.base]!.team).not.toBe(slots[t.player]!.team);
  }, 60000);

  it('2v1 on three bases: a base with no player is out from the start', () => {
    const map = arenaMap(4);
    const m = createMatch(arenaWorld(map), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }, { base: 2, team: 1 }], 1);
    expect(m.eliminated).toEqual([false, false, false, true]);
    expect(m.flags).toHaveLength(4);
  });

  it('the last team standing wins once the others are out', () => {
    const map = arenaMap(4);
    const m = createMatch(arenaWorld(map), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }, { base: 2, team: 2 }, { base: 3, team: 1 }], 1);
    for (const p of m.players) if (p.team !== 1) p.lives = { tank: 0, jeep: 0, asv: 0, heli: 0 };
    stepMatch(m, []);
    expect(m.eliminated).toEqual([true, false, true, false]);
    expect(m.winner).toBe(1);
  });
});

describe('rules with three and four bases', () => {
  /** Parks player 1's tank beside base 1's gun tower and says whether the tower woke. */
  function wakes(slots: SlotSetup[]): boolean {
    const map = arenaMap(4);
    const w = arenaWorld(map);
    const m = createMatch(w, map, slots, 1);
    launchNow(m, 1, 'tank');
    const v = m.players[1]!.vehicle!;
    const b = w.bases[1]!.start;
    v.x = (b.tx - 3) * TILE_SIZE;
    v.y = (b.ty - 3) * TILE_SIZE;
    let woke = false;
    for (let t = 0; t < 400; t++) {
      stepMatch(m, []);
      woke ||= m.turrets.length > 0;
    }
    return woke;
  }

  it('an empty base is on nobody\'s side, whatever the teams are called', () => {
    // Base 1 is left empty. Its tower must treat a player on team 1 as it treats one on team 2.
    expect(wakes([{ base: 0, team: 0 }, { base: 2, team: 1 }, { base: 3, team: 3 }])).toBe(true);
    expect(wakes([{ base: 0, team: 0 }, { base: 2, team: 2 }, { base: 3, team: 3 }])).toBe(true);
  });

  it('ends in a draw when the last bases go out on the same tick', () => {
    const map = arenaMap(2);
    const m = createMatch(arenaWorld(map), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
    for (const p of m.players) p.lives.jeep = 0;
    stepMatch(m, []);
    expect(m.winner).toBeNull();
    expect(m.draw).toBe(true);
    expect(m.events.some((e) => e.type === 'draw')).toBe(true);
    const tick = m.tick;
    stepMatch(m, []);
    expect(m.tick).toBe(tick);
  });

  it('a gun tower wakes when an enemy has it on screen, tracks that vehicle, and fires only inside a round range', () => {
    const map = arenaMap(2);
    const w = arenaWorld(map);
    const near = (dx: number, dy: number, ticks = 700) => {
      const m = createMatch(w, map, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
      launchNow(m, 0, 'tank');
      const v = m.players[0]!.vehicle!;
      const tower = m.world.buildings.find((b) => m.world.building[b.ty * GRID + b.tx] === 49 && m.world.owner[b.ty * GRID + b.tx] === 1)!;
      const tile = tower.ty * GRID + tower.tx;
      v.x = tower.tx * TILE_SIZE + TILE_SIZE / 2 + dx;
      v.y = tower.ty * TILE_SIZE + TILE_SIZE / 2 + dy;
      let shells = 0;
      for (let t = 0; t < ticks; t++) {
        v.health = 0x160000;
        stepMatch(m, []);
        shells += m.events.filter((e) => e.type === 'fired' && e.shot === 4).length;
      }
      const gun = m.turrets.find((t) => t.tile === tile);
      return { shells, gun, aim: headingTo(v.x - (tower.tx * TILE_SIZE + TILE_SIZE / 2), v.y - (tower.ty * TILE_SIZE + TILE_SIZE / 2)), m, v };
    };
    const d = Math.round(TURRET_RANGE * 0.8);
    expect(near(-d, 0).shells).toBeGreaterThan(0);
    expect(near(0, d).shells).toBeGreaterThan(0);
    // 0.8 of the range along both axes is 1.13 of it away: on screen, so the tower wakes and turns its gun on the
    // tank, but outside the circle, so it holds its fire.
    const far = near(-d, d);
    expect(far.shells).toBe(0);
    expect(far.gun?.target).toBe(0);
    expect(far.gun?.heading).toBe(far.aim);
    // Out of everyone's sight for 300 ticks, it is a building again.
    far.v.x += 600 * 0x10000;
    for (let t = 0; t < 320; t++) stepMatch(far.m, []);
    expect(far.m.turrets).toHaveLength(0);
  });

  it('a prison holds the men of the next base round that is an enemy', () => {
    const map = arenaMap(4);
    const w = arenaWorld(map);
    const two = createMatch(arenaWorld(arenaMap(2)), arenaMap(2), [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
    expect([prisonersOf(two, 0), prisonersOf(two, 1)]).toEqual([1, 0]);
    // Bases 0 and 1 are allies; base 3 is empty.
    const m = createMatch(w, map, [{ base: 0, team: 0 }, { base: 1, team: 0 }, { base: 2, team: 1 }], 1);
    expect([prisonersOf(m, 0), prisonersOf(m, 1), prisonersOf(m, 2)]).toEqual([2, 2, 0]);
    // The same base's colours go on the drones sent at a player and on their skull's helmet.
    expect([rivalOf(two, 0), rivalOf(two, 1), rivalOf(m, 0), rivalOf(m, 2)]).toEqual([1, 0, 2, 0]);
  });

  it('says the flag was dropped when its base goes out under the jeep carrying it', () => {
    const map = arenaMap(4);
    const m = createMatch(arenaWorld(map), map, [0, 1, 2].map((b) => ({ base: b, team: b })), 1);
    m.flags[1]!.revealed = true;
    m.flags[1]!.carrier = 0;
    m.players[1]!.lives.jeep = 0;
    stepMatch(m, []);
    expect(m.eliminated[1]).toBe(true);
    expect(m.events).toContainEqual({ type: 'flagDropped', base: 1 });
    expect(m.flags[1]!.carrier).toBe(-1);
  });

  it('captures a flag brought to a living teammate\'s base, but not to an enemy\'s', () => {
    const map = arenaMap(4);
    const slots = [{ base: 0, team: 0 }, { base: 1, team: 0 }, { base: 2, team: 1 }, { base: 3, team: 2 }];
    const centre = (t: number) => t * TILE_SIZE + TILE_SIZE / 2;
    const carryTo = (base: number): Match => {
      const m = createMatch(arenaWorld(map), map, slots, 1);
      expect(launchNow(m, 0, 'jeep')).toBe(true);
      m.flags[2]!.revealed = true;
      m.flags[2]!.carrier = 0;
      const at = m.world.bases[base]!.start;
      m.players[0]!.vehicle!.x = centre(at.tx);
      m.players[0]!.vehicle!.y = centre(at.ty);
      stepMatch(m, []);
      return m;
    };
    const mate = carryTo(1);
    expect(mate.eliminated[2]).toBe(true);
    expect(mate.events).toContainEqual({ type: 'captured', base: 2, player: 0, left: 0 });
    expect(carryTo(3).eliminated[2]).toBe(false);
    // A teammate's base that has gone out is no longer home.
    const m = createMatch(arenaWorld(map), map, slots, 1);
    launchNow(m, 0, 'jeep');
    m.players[1]!.lives.jeep = 0;
    stepMatch(m, []);
    expect(m.eliminated[1]).toBe(true);
    m.flags[2]!.revealed = true;
    m.flags[2]!.carrier = 0;
    const at = m.world.bases[1]!.start;
    m.players[0]!.vehicle!.x = centre(at.tx);
    m.players[0]!.vehicle!.y = centre(at.ty);
    stepMatch(m, []);
    expect(m.eliminated[2]).toBe(false);
  });

  it('gives the smaller side extra vehicles when the handicap is on', () => {
    const map = arenaMap(4);
    map.settings.vehicles = { tank: 3, jeep: 4, asv: UNLIMITED, heli: 1 };
    const slots = [{ base: 0, team: 0 }, { base: 1, team: 0 }, { base: 2, team: 0 }, { base: 3, team: 1 }];
    const off = createMatch(arenaWorld(map), map, slots, 1);
    expect(off.players[3]!.lives).toEqual({ tank: 3, jeep: 4, asv: UNLIMITED, heli: 1 });
    const on = createMatch(arenaWorld(map), map, slots, 1, { handicap: true });
    expect(on.players[0]!.lives).toEqual({ tank: 3, jeep: 4, asv: UNLIMITED, heli: 1 });
    expect(on.players[3]!.lives).toEqual({ tank: 9, jeep: 12, asv: UNLIMITED, heli: 3 });
    // Two against one against one: each single base gets double.
    const mixed = [{ base: 0, team: 0 }, { base: 1, team: 0 }, { base: 2, team: 1 }, { base: 3, team: 2 }];
    expect(startingLives(map, mixed, 2, true).jeep).toBe(8);
    // Even teams are left alone.
    const even = [{ base: 0, team: 0 }, { base: 1, team: 0 }, { base: 2, team: 1 }, { base: 3, team: 1 }];
    expect(startingLives(map, even, 2, true).jeep).toBe(4);
  });

  it('makes the smaller side\'s flag take three captures when the handicap is on', () => {
    const map = arenaMap(4);
    const slots = [{ base: 0, team: 0 }, { base: 1, team: 0 }, { base: 2, team: 1 }];
    expect(createMatch(arenaWorld(map), map, slots, 1).captures.slice(0, 3)).toEqual([1, 1, 1]);
    const m = createMatch(arenaWorld(map), map, slots, 1, { handicap: true });
    expect(m.captures.slice(0, 3)).toEqual([1, 1, 3]);
    expect(launchNow(m, 0, 'jeep')).toBe(true);
    const home = m.world.bases[0]!.start;
    const centre = (t: number) => t * TILE_SIZE + TILE_SIZE / 2;
    for (const left of [2, 1, 0]) {
      m.flags[2]!.revealed = true;
      m.flags[2]!.carrier = 0;
      m.players[0]!.vehicle!.x = centre(home.tx);
      m.players[0]!.vehicle!.y = centre(home.ty);
      stepMatch(m, []);
      expect(m.events).toContainEqual({ type: 'captured', base: 2, player: 0, left });
      expect(m.eliminated[2]).toBe(left === 0);
      // With captures to spare the flag goes back to its base, hidden in a flag building.
      if (left) expect(m.flags[2]).toMatchObject({ carrier: -1, revealed: false });
    }
    expect(m.winner).toBe(0);
    // Three against one takes five; even teams one.
    expect(capturesNeeded([0, 0, 0, 1].map((team, base) => ({ base, team })), 3, true)).toBe(5);
    expect(capturesNeeded([0, 0, 1, 1].map((team, base) => ({ base, team })), 3, true)).toBe(1);
  });

  it('never runs out of mines with unlimited ASVs', () => {
    const map = arenaMap(2);
    map.settings.vehicles.asv = UNLIMITED;
    const m = createMatch(arenaWorld(map), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
    m.players[0]!.mines = 0;
    launchNow(m, 0, 'asv');
    expect(m.players[0]!.vehicle!.ammo[1]).toBeGreaterThan(0);
  });
});

describe('bots with three and four sides', () => {
  /** Plays bots to the end and says which team won (or null) and which base went out first. */
  function game(bases: number, slots: SlotSetup[], seed: number, difficulty: number): { winner: number | null; first: number; ticks: number } {
    const map = arenaMap(bases);
    const m = createMatch(arenaWorld(map), map, slots, seed, { difficulty });
    const bots = m.players.map(() => createBot(difficulty));
    let first = -1;
    for (let t = 0; t < 150000 && m.winner === null && !m.draw; t++) {
      const inputs = bots.map((b, p) => {
        const move = botThink(m, p, b);
        if (move.launch) launch(m, p, move.launch);
        if (move.dock) dock(m, p);
        return move.input;
      });
      stepMatch(m, inputs);
      if (first < 0) for (const e of m.events) if (e.type === 'eliminated') first = e.base;
    }
    return { winner: m.winner, first, ticks: m.tick };
  }

  it('do not both fall on the base between them in a three-way game', () => {
    // Bases 0 and 1 sit in opposite corners; base 2 is next to both.
    const wins = [0, 0, 0];
    let middleFirst = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = game(3, [0, 1, 2].map((b) => ({ base: b, team: b })), seed, 5);
      expect(r.winner).not.toBeNull();
      wins[r.winner!]!++;
      if (r.first === 2) middleFirst++;
    }
    expect(wins[2]).toBeGreaterThanOrEqual(2);
    expect(middleFirst).toBeLessThan(8);
  }, 240000);

  it('give every corner a win in a four-way game', () => {
    const wins = [0, 0, 0, 0];
    for (let seed = 1; seed <= 12; seed++) wins[game(4, [0, 1, 2, 3].map((b) => ({ base: b, team: b })), seed, 5).winner!]!++;
    expect(Math.min(...wins)).toBeGreaterThanOrEqual(1);
  }, 360000);
});
