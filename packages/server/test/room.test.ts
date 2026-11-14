import { describe, expect, it } from 'vitest';
import { START_GRACE, buildWorld, createMatch } from '@rfw/sim';
import { commandCode, type MatchSeat } from '@rfw/net';
import { Room, timeLimitWinner, type Peer } from '../src/room.js';
import { ARENA_DEFS, arenaMap } from '../../sim/test/arena.js';

const peer = (id: string): Peer => ({ id, userId: id, name: id, send() {}, sendBinary() {} });

/** Two humans (A and B) and a bot on the four-base arena, both humans connected. */
function room() {
  const map = arenaMap(4);
  const seats: MatchSeat[] = [
    { player: 0, base: map.bases[0]!.id, team: 1, name: 'A', userId: 'a', bot: false },
    { player: 1, base: map.bases[1]!.id, team: 2, name: 'B', userId: 'b', bot: false },
    { player: 2, base: map.bases[2]!.id, team: 3, name: 'Bot', userId: null, bot: true, difficulty: 9 },
  ];
  const r = new Room({ id: 'g', mapId: 'arena4', map, defs: ARENA_DEFS, shore: null, seats, seed: 7, difficulty: 5, pauseOnDrop: false, desyncDir: null, onEnd() {} });
  const a = peer('a');
  const b = peer('b');
  r.connect(a);
  r.connect(b);
  return { r, a, b, m: r.match };
}

describe('bots in an online match', () => {
  it('leave a player who is still picking a vehicle alone, and never play a connected seat', () => {
    const { r, a, b, m } = room();
    for (let t = 0; t < 300; t++) r.tick();
    r.command(a, commandCode({ launch: 'tank' }));
    // B sits on the lift screen: the bot waits for them instead of going for their flag.
    for (let t = 0; t < START_GRACE - 60; t++) r.tick();
    expect(m.players[1]!.state).toBe('bunker');
    expect(m.players[2]!.state).toBe('bunker');
    expect(m.eliminated[m.players[1]!.base]).toBe(false);
    expect(r.seatStatus().filter((s) => s.player < 2).map((s) => [s.connected, s.botTakeover])).toEqual([[true, false], [true, false]]);
    r.command(b, commandCode({ launch: 'jeep' }));
    // A bot takes up to a couple of seconds to pick its vehicle.
    for (let t = 0; t < 130; t++) r.tick();
    expect(m.players[1]!.state).not.toBe('bunker');
    expect(m.players[2]!.state).not.toBe('bunker');
  });

  it('stop waiting START_GRACE after the first launch, so one idle player cannot hold them back', () => {
    const { r, a, m } = room();
    for (let t = 0; t < 300; t++) r.tick();
    r.command(a, commandCode({ launch: 'tank' }));
    for (let t = 0; t < START_GRACE - 60; t++) r.tick();
    expect(m.players[2]!.state).toBe('bunker');
    for (let t = 0; t < 190; t++) r.tick();
    expect(m.players[1]!.state).toBe('bunker');
    expect(m.players[2]!.state).not.toBe('bunker');
  });

  it('take over a seat only when its player leaves, and that bot waits with the others', () => {
    const { r, a, b, m } = room();
    r.disconnect(b, true);
    expect(r.seatStatus()[1]).toMatchObject({ connected: false, botTakeover: true });
    expect(r.seatStatus()[0]).toMatchObject({ connected: true, botTakeover: false });
    for (let t = 0; t < 300; t++) r.tick();
    expect(m.players.map((p) => p.state)).toEqual(['bunker', 'bunker', 'bunker']);
    r.command(a, commandCode({ launch: 'tank' }));
    // A bot takes up to a couple of seconds to pick its vehicle.
    for (let t = 0; t < 130; t++) r.tick();
    expect(m.players[1]!.state).not.toBe('bunker');
    expect(m.players[2]!.state).not.toBe('bunker');
  });
});

describe('the time limit', () => {
  it('goes to the team with the most jeeps left, or is a draw when they are level', () => {
    const map = arenaMap(4);
    const m = createMatch(buildWorld(map, ARENA_DEFS, null), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }, { base: 2, team: 1 }], 1);
    // One base with 8 jeeps against two with 8 each.
    expect(timeLimitWinner(m)).toBe(1);
    m.players[1]!.lives.jeep = 3;
    m.players[2]!.lives.jeep = 5;
    expect(timeLimitWinner(m)).toBeNull();
    m.players[0]!.lives.jeep = 9;
    expect(timeLimitWinner(m)).toBe(0);
  });
});
