import { describe, expect, it } from 'vitest';
import {
  HASH_EVERY, Rng, botThink, createBot, createMatch, dock, hashMatch, launch, launchNow, restoreMatch, snapshotMatch, staticsOf, stepMatch,
  type BotState, type Match, type VehicleInput,
} from '../src/index.js';
import { arenaMap, arenaWorld } from './arena.js';

function newMatch(bases = 2, seed = 11): Match {
  const map = arenaMap(bases);
  const slots = map.bases.map((b) => ({ base: b.id, team: b.id }));
  return createMatch(arenaWorld(map), map, slots, seed, { difficulty: 9 });
}

/** Bots play every seat; returns the moves so a second copy can be fed the same ones. */
function botTick(m: Match, bots: BotState[]): { inputs: (VehicleInput | undefined)[]; actions: [number, string][] } {
  const actions: [number, string][] = [];
  const inputs = bots.map((b, p) => {
    const move = botThink(m, p, b);
    if (move.launch) actions.push([p, move.launch]);
    if (move.dock) actions.push([p, 'dock']);
    return move.input;
  });
  return { inputs, actions };
}

function apply(m: Match, t: { inputs: (VehicleInput | undefined)[]; actions: [number, string][] }): void {
  for (const [p, a] of t.actions) {
    if (a === 'dock') dock(m, p);
    else launch(m, p, a as never);
  }
  stepMatch(m, t.inputs);
}

describe('snapshots', () => {
  it('restore a match that then plays on exactly like the original', () => {
    const a = newMatch();
    const bots = a.players.map(() => createBot());
    for (let i = 0; i < 1500; i++) apply(a, botTick(a, bots));
    // Vehicles in play, or on their way up or down on a lift.
    expect(a.players.some((p) => p.vehicle) || a.lifts.length > 0).toBe(true);
    const snap = JSON.parse(JSON.stringify(snapshotMatch(a))) as ReturnType<typeof snapshotMatch>;
    const b = restoreMatch(snap, staticsOf(a));
    expect(b).not.toBe(a);
    expect(b.tick).toBe(a.tick);
    expect(b.rng).toBeInstanceOf(Rng);
    expect(b.world.defs).toBe(a.world.defs);
    expect(hashMatch(b)).toBe(hashMatch(a));
    for (let i = 0; i < 1000; i++) {
      const t = botTick(a, bots);
      apply(a, t);
      apply(b, t);
      if (i % HASH_EVERY === 0) expect(hashMatch(b), `tick ${a.tick}`).toBe(hashMatch(a));
    }
    expect(hashMatch(b)).toBe(hashMatch(a));
    expect(JSON.stringify(snapshotMatch(b))).toBe(JSON.stringify(snapshotMatch(a)));
  });

  it('keep objects that are shared shared', () => {
    const a = newMatch();
    launchNow(a, 0, 'tank');
    const shared = { tag: 1 };
    (a as unknown as { extra: unknown[] }).extra = [shared, shared, a.players[0]!.vehicle];
    const b = restoreMatch(snapshotMatch(a), staticsOf(a)) as unknown as { extra: unknown[]; players: Match['players'] };
    expect(b.extra[0]).toBe(b.extra[1]);
    expect(b.extra[2]).toBe(b.players[0]!.vehicle);
  });

  it('keep -0, undefined fields and typed arrays', () => {
    const a = newMatch();
    (a as unknown as { odd: unknown }).odd = { z: -0, u: undefined, t: new Int16Array([1, -2, 3]) };
    const b = restoreMatch(JSON.parse(JSON.stringify(snapshotMatch(a))), staticsOf(a)) as unknown as { odd: { z: number; u: unknown; t: Int16Array } };
    expect(Object.is(b.odd.z, -0)).toBe(true);
    expect('u' in b.odd).toBe(true);
    expect(b.odd.t).toEqual(new Int16Array([1, -2, 3]));
  });
});

describe('state hash', () => {
  it('is the same for two matches set up alike and changes with any difference', () => {
    const a = newMatch();
    const b = newMatch();
    expect(hashMatch(a)).toBe(hashMatch(b));
    b.world.terrain[1000] = b.world.terrain[1000]! ^ 1;
    expect(hashMatch(a)).not.toBe(hashMatch(b));
    const c = newMatch();
    c.rng.next();
    expect(hashMatch(a)).not.toBe(hashMatch(c));
    const d = newMatch(2, 12);
    expect(hashMatch(a)).not.toBe(hashMatch(d));
  });

  it('ignores the last tick\'s events', () => {
    const a = newMatch();
    const h = hashMatch(a);
    a.events.push({ type: 'won', team: 0 });
    expect(hashMatch(a)).toBe(h);
  });
});
