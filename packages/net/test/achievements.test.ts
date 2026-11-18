import { describe, expect, it } from 'vitest';
import { DEATH_MISSILE, createMatch, type Match, type MatchEvent } from '@rfw/sim';
import {
  ACHIEVEMENTS, GROUPS, MatchTracker, award, cleanProgress, cleanTally, emptyProgress, progressAsTally, progressOf, type TrackOptions,
} from '../src/index.js';
import { arenaMap, arenaWorld } from '../../sim/test/arena.js';

const opts = (o: Partial<TrackOptions> = {}): TrackOptions => ({
  mode: 'training', mapId: 'rfmap101', custom: false, night: false, difficulty: 5, humans: [0], bots: [1], ...o,
});

function duel(bases = 2): Match {
  const map = arenaMap(bases);
  return createMatch(arenaWorld(map), map, Array.from({ length: bases }, (_, b) => ({ base: b, team: b })), 3);
}

/** Plays one made-up tick: the events given, nothing else. */
function events(m: Match, t: MatchTracker, ...es: MatchEvent[]): void {
  m.events = es;
  t.tick(m);
}

const kill = (player: number, kind: 'tank' | 'jeep' | 'asv' | 'heli', by?: number, more: Partial<MatchEvent> = {}): MatchEvent =>
  ({ type: 'destroyed', player, kind, x: 0, y: 0, z: 0, heading: 0, ...(by !== undefined ? { by } : {}), ...more }) as MatchEvent;

describe('the achievement list', () => {
  it('has fifty, each with a unique id, a known group and a goal where it counts', () => {
    expect(ACHIEVEMENTS).toHaveLength(50);
    expect(new Set(ACHIEVEMENTS.map((x) => x.id)).size).toBe(50);
    // At least a fifth are kept secret until unlocked.
    expect(ACHIEVEMENTS.filter((x) => x.hidden).length).toBeGreaterThanOrEqual(10);
    for (const x of ACHIEVEMENTS) if (x.hidden) expect(x.clue, x.id).toBeTruthy();
    const groups = new Set(GROUPS.map((g) => g.id));
    for (const x of ACHIEVEMENTS) {
      expect(groups.has(x.group)).toBe(true);
      if (x.counter || x.set) expect(x.goal).toBeGreaterThan(0);
    }
  });
});

describe('MatchTracker', () => {
  it('counts kills, sorties and kills made from each vehicle', () => {
    const m = duel();
    const t = new MatchTracker(m, [0], opts());
    m.players[0]!.state = 'driving';
    m.players[0]!.vehicle = { kind: 'jeep' } as never;
    events(m, t, kill(1, 'tank', 0), kill(1, 'jeep', 0));
    events(m, t, kill(1, 'heli', 0, { shot: 3 }));
    const tally = t.finish(m, 0).get(0)!;
    expect(tally.counters.kills).toBe(3);
    expect(tally.counters['kills.tank']).toBe(1);
    expect(tally.sets.killedFrom).toEqual(['jeep']);
    expect(tally.earned).toEqual(expect.arrayContaining(['first-blood', 'jeep-vs-tank', 'hat-trick', 'first-match', 'first-win', 'flawless', 'blitz']));
    expect(tally.earned).not.toContain('rampage');
  });

  it('does not count a kill nobody made, or one on a teammate', () => {
    const map = arenaMap(3);
    const m = createMatch(arenaWorld(map), map, [{ base: 0, team: 0 }, { base: 1, team: 0 }, { base: 2, team: 1 }], 3);
    const t = new MatchTracker(m, [0], opts({ humans: [0], bots: [1, 2] }));
    events(m, t, kill(1, 'tank', 0), kill(2, 'tank'));
    expect(t.finish(m, null).get(0)!.counters.kills).toBeUndefined();
  });

  it('knows its own losses: drowned, the sub, and a match won after losing one is not flawless', () => {
    const m = duel();
    const t = new MatchTracker(m, [0], opts());
    events(m, t, kill(0, 'asv', undefined, { drowned: true }), kill(0, 'heli', undefined, { shot: DEATH_MISSILE }));
    const tally = t.finish(m, 0).get(0)!;
    expect(tally.earned).toEqual(expect.arrayContaining(['drowned', 'sub', 'first-win']));
    expect(tally.earned).not.toContain('flawless');
  });

  it('follows flags: taken, captured, returned and the carrier stopped', () => {
    const m = duel();
    const t = new MatchTracker(m, [0], opts());
    events(m, t, { type: 'flagTaken', base: 1, player: 0 }, { type: 'captured', base: 1, player: 0, left: 0 });
    events(m, t, { type: 'flagTaken', base: 0, player: 1 }, kill(1, 'jeep', 0), { type: 'flagDropped', base: 0 });
    events(m, t, { type: 'flagReturned', base: 0, player: 0, revealed: false });
    const tally = t.finish(m, 0).get(0)!;
    expect(tally.counters.captures).toBe(1);
    expect(tally.earned).toEqual(expect.arrayContaining(['flag-take', 'flag-capture', 'interception', 'flag-return']));
  });

  it('counts buildings, gun towers and flattened scenery, not its own side\'s', () => {
    const m = duel();
    const t = new MatchTracker(m, [0], opts());
    const tile = 10 * 64 + 10;
    m.world.owner[tile] = -1;
    events(m, t, { type: 'buildingDestroyed', tile, building: 49, by: 0 }, { type: 'buildingDestroyed', tile, building: 1, crushed: true, by: 0 });
    events(m, t, { type: 'buildingDestroyed', tile, building: 74, by: 0 });
    m.world.owner[tile] = 0;
    events(m, t, { type: 'buildingDestroyed', tile, building: 49, by: 0 });
    const tally = t.finish(m, null).get(0)!;
    expect(tally.counters).toMatchObject({ buildings: 2, towers: 1, crushed: 1 });
    expect(tally.earned).toEqual(expect.arrayContaining(['tower-down', 'bridge']));
  });

  it('gives no win against nobody, and nothing for an aborted match', () => {
    const m = duel();
    expect(new MatchTracker(m, [0], opts({ bots: [] })).finish(m, 0).get(0)!.earned).not.toContain('first-win');
    expect(new MatchTracker(m, [0], opts()).finish(m, 0, { aborted: true }).size).toBe(0);
  });

  it('awards the online ones only in online matches, against or alongside people', () => {
    const map = arenaMap(4);
    const m = createMatch(arenaWorld(map), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }, { base: 2, team: 0 }, { base: 3, team: 1 }], 3);
    const t = new MatchTracker(m, [0, 1, 2], opts({ mode: 'online', humans: [0, 1, 2], bots: [3] }));
    const tallies = t.finish(m, 0, { quit: [1] });
    expect(tallies.get(0)!.earned).toEqual(expect.arrayContaining(['online-first', 'online-win', 'team-win']));
    expect(tallies.get(0)!.counters['online.wins']).toBe(1);
    expect(tallies.get(1)!.earned).toEqual([]);
  });
});

describe('award', () => {
  it('adds counters, unlocks goals once and never online ones from a browser', () => {
    const p = emptyProgress();
    expect(award(p, { counters: { kills: 49 }, sets: {}, earned: ['first-blood'] }, 1)).toEqual(['first-blood']);
    expect(award(p, { counters: { kills: 1, 'online.wins': 3 }, sets: {}, earned: ['online-win', 'first-blood'] }, 2)).toEqual(['kills-50']);
    expect(p.counters['online.wins']).toBeUndefined();
    expect(p.unlocked['online-win']).toBeUndefined();
    expect(award(p, { counters: {}, sets: {}, earned: ['online-win'] }, 3, true)).toEqual(['online-win']);
    expect(progressOf(p, ACHIEVEMENTS.find((x) => x.id === 'kills-250')!)).toEqual([50, 250]);
  });

  it('counts distinct maps for Tour of Duty', () => {
    const p = emptyProgress();
    for (let i = 0; i < 9; i++) award(p, { counters: {}, sets: { maps: [`m${i % 5}`] }, earned: [] });
    expect(p.sets.maps).toHaveLength(5);
    expect(award(p, { counters: {}, sets: { maps: ['m5', 'm6', 'm7', 'm8', 'm9'] }, earned: [] })).toEqual(['tour']);
  });

  it('hands a guest\'s progress to an account, keeping what the account had', () => {
    const guest = emptyProgress();
    award(guest, { counters: { kills: 30 }, sets: { maps: ['a'] }, earned: ['replay'] });
    const account = emptyProgress();
    award(account, { counters: { kills: 25 }, sets: { maps: ['b'] }, earned: [] });
    const fresh = award(account, cleanTally(progressAsTally(guest)));
    expect(fresh).toEqual(expect.arrayContaining(['kills-50', 'replay']));
    expect(account.counters.kills).toBe(55);
    expect(account.sets.maps!.sort()).toEqual(['a', 'b']);
  });

  it('cleans what it reads', () => {
    expect(cleanProgress({ unlocked: { 'first-win': 5, nope: 1 }, counters: { kills: -3, wins: 2.7 }, sets: { maps: ['a', 'a', 4] } }))
      .toEqual({ unlocked: { 'first-win': 5 }, counters: { wins: 2 }, sets: { maps: ['a'] } });
    expect(cleanTally({ counters: { kills: 1e9, 'online.games': 5 }, earned: ['ladder', 'replay', 'x'] }))
      .toEqual({ counters: { kills: 5000 }, sets: {}, earned: ['replay'] });
  });
});
