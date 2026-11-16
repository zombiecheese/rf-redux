import { describe, expect, it } from 'vitest';
import { GATE_GRACE, createMatch, gateLeft, hashMatch, launch, restoreMatch, snapshotMatch, staticsOf, stepMatch, type Match } from '../src/index.js';
import { arenaMap, arenaWorld } from './arena.js';

/** Three seats on the four-base arena; gate lists the humans. */
function match(gate?: number[]): Match {
  const map = arenaMap(4);
  return createMatch(arenaWorld(map), map, [0, 1, 2].map((i) => ({ base: map.bases[i]!.id, team: i })), 3, { gate });
}

/** Ticks until every bunker screen has faded in, so a launch is allowed. */
function fadeIn(m: Match): void {
  for (let t = 0; t < 30; t++) stepMatch(m, []);
}

describe('the start gate', () => {
  it('is not there for one human, who launches at once as before', () => {
    const m = match([0]);
    expect(m.gate).toBeNull();
    fadeIn(m);
    expect(launch(m, 0, 'tank')).toBe(true);
    expect(m.players[0]!.state).toBe('launching');
  });

  it('holds the picks until the last human has picked, then launches them on the same tick', () => {
    const m = match([0, 1]);
    fadeIn(m);
    expect(launch(m, 0, 'tank')).toBe(true);
    // Changed their mind: the last pick counts.
    expect(launch(m, 0, 'heli')).toBe(true);
    // A seat the gate does not wait for (a bot's) cannot go before it opens.
    expect(launch(m, 2, 'jeep')).toBe(false);
    stepMatch(m, []);
    expect(m.players.map((p) => p.state)).toEqual(['bunker', 'bunker', 'bunker']);
    expect(gateLeft(m)).toBe(GATE_GRACE - 1);
    const lives = m.players[0]!.lives.heli;
    expect(launch(m, 1, 'jeep')).toBe(true);
    stepMatch(m, []);
    expect(m.gate).toBeNull();
    expect(m.startTick).toBe(m.tick);
    expect(m.events).toContainEqual({ type: 'go' });
    expect(m.players.map((p) => p.state)).toEqual(['launching', 'launching', 'bunker']);
    expect(m.players[0]!.elevator?.kind).toBe('heli');
    expect(m.players[0]!.lives.heli).toBe(lives - 1);
  });

  it('opens GATE_GRACE after the first pick even if someone has not picked', () => {
    const m = match([0, 1]);
    fadeIn(m);
    launch(m, 1, 'asv');
    for (let t = 0; t < GATE_GRACE - 1; t++) stepMatch(m, []);
    expect(m.gate).not.toBeNull();
    stepMatch(m, []);
    expect(m.gate).toBeNull();
    expect(m.players.map((p) => p.state)).toEqual(['bunker', 'launching', 'bunker']);
    // After it, launching is as it always was.
    expect(launch(m, 0, 'tank')).toBe(true);
  });

  it('survives a snapshot, for a player who reconnects while it waits', () => {
    const m = match([0, 1]);
    fadeIn(m);
    launch(m, 0, 'tank');
    stepMatch(m, []);
    const statics = staticsOf(m);
    const b = restoreMatch(snapshotMatch(m), statics);
    expect(hashMatch(b)).toBe(hashMatch(m));
    expect(b.gate).toEqual(m.gate);
    for (const x of [m, b]) {
      launch(x, 1, 'jeep');
      stepMatch(x, []);
    }
    expect(hashMatch(b)).toBe(hashMatch(m));
    expect(b.players[1]!.state).toBe('launching');
  });
});
