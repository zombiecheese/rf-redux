import { describe, expect, it } from 'vitest';
import { createMatch, hashMatch } from '@rfw/sim';
import {
  DOCK, applyFrame, commandCode, decodeClientBinary, decodeFrames, encodeCommand, encodeFrames, encodeHash, encodeInput, layoutsFor, packInput,
  teamsForLayout, unpackInput, type Frame,
} from '../src/index.js';
import { arenaMap, arenaWorld } from '../../sim/test/arena.js';

describe('inputs', () => {
  it('pack every combination of controls into 9 bits and back', () => {
    for (let n = 0; n < 512; n++) {
      if ((n & 3) === 3 || ((n >> 2) & 3) === 3) continue;
      expect(packInput(unpackInput(n))).toBe(n);
    }
    expect(packInput({ throttle: -1, turn: 1, fire: true })).toBe(2 | (1 << 2) | 16);
    expect(packInput(undefined)).toBe(0);
  });
});

describe('frames', () => {
  it('round-trip through the binary format', () => {
    const frames: Frame[] = [
      { tick: 70000, inputs: [1, 511, 0], commands: [] },
      { tick: 70001, inputs: [0, 2, 16], commands: [[0, commandCode({ launch: 'heli' })], [2, DOCK]] },
    ];
    expect(decodeFrames(encodeFrames(frames))).toEqual(frames);
  });

  it('decode client messages and reject malformed ones', () => {
    expect(decodeClientBinary(encodeInput({ throttle: 1, turn: 0, fire2: true }))).toEqual({ type: 'input', input: 1 | 32 });
    expect(decodeClientBinary(encodeCommand({ launch: 'jeep' }))).toEqual({ type: 'command', code: 1 });
    expect(decodeClientBinary(encodeHash(5, 0xdeadbeef))).toEqual({ type: 'hash', tick: 5, hash: 0xdeadbeef });
    expect(decodeClientBinary(Uint8Array.of(3, 9))).toBeNull();
    expect(decodeClientBinary(Uint8Array.of(2, 0))).toBeNull();
    expect(decodeClientBinary(Uint8Array.of(77))).toBeNull();
  });

  it('play the same match on two machines given the same frames', () => {
    const map = arenaMap(2);
    const a = createMatch(arenaWorld(map), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 5);
    const b = createMatch(arenaWorld(map), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 5);
    for (let t = 1; t <= 600; t++) {
      const f: Frame = {
        tick: t, inputs: [packInput({ throttle: 1, turn: t % 90 < 30 ? 1 : 0, fire: t % 7 === 0 }), packInput({ throttle: 1, turn: -1 })],
        commands: t === 20 ? [[0, commandCode({ launch: 'tank' })], [1, commandCode({ launch: 'jeep' })]] : [],
      };
      const [wire] = decodeFrames(encodeFrames([f]));
      applyFrame(a, f);
      applyFrame(b, wire!);
    }
    expect(a.players[0]!.vehicle).not.toBeNull();
    expect(hashMatch(a)).toBe(hashMatch(b));
    expect(() => applyFrame(a, { tick: 5, inputs: [], commands: [] })).toThrow();
  });
});

describe('team layouts', () => {
  it('lists the splits a map\'s bases allow', () => {
    expect(layoutsFor(2).map((l) => l.name)).toEqual(['1v1']);
    expect(layoutsFor(3).map((l) => l.name)).toEqual(['Free for all (3)', '2v1', '1v1']);
    expect(layoutsFor(4).map((l) => l.name)).toEqual(['Free for all (4)', '2v1v1', '3v1', '2v2', 'Free for all (3)', '2v1', '1v1']);
  });

  it('deals bases to teams in turn', () => {
    expect(teamsForLayout([2, 2])).toEqual([0, 1, 0, 1]);
    expect(teamsForLayout([2, 1])).toEqual([0, 1, 0]);
    expect(teamsForLayout([1, 1, 1, 1])).toEqual([0, 1, 2, 3]);
    expect(teamsForLayout([3, 1])).toEqual([0, 1, 0, 0]);
  });
});

describe('solo runs', () => {
  it.each([2, 3, 4])('replay a recorded game exactly on a map with %i bases', async (bases) => {
    const { SoloRecorder, replaySolo, packInput: pack, commandCode: code } = await import('../src/index.js');
    const { botThink, createBot, launch, dock, stepMatch, hashMatch: hash } = await import('@rfw/sim');
    const { ARENA_DEFS } = await import('../../sim/test/arena.js');
    const map = arenaMap(bases);
    const m = createMatch(arenaWorld(map), map, map.bases.map((b) => ({ base: b.id, team: b.id })), 77, { difficulty: 3 });
    const rec = new SoloRecorder('arena', 77, 3);
    // As in the Training game, every other base is a bot that waits for player 0 to launch.
    const bots = m.players.slice(1).map((p) => ({ id: p.id, bot: createBot(null, [0]) }));
    for (let t = 1; t <= 3000 && m.winner === null; t++) {
      if (t === 20 || t === 1500) {
        rec.command(code({ launch: 'tank' }));
        launch(m, 0, 'tank');
      }
      const input = { throttle: 1 as const, turn: (t % 200 < 50 ? 1 : 0) as 0 | 1, fire: t % 9 === 0 };
      rec.input(pack(input));
      const inputs: (typeof input | ReturnType<typeof botThink>['input'])[] = [input];
      for (const { id, bot } of bots) {
        const move = botThink(m, id, bot);
        if (move.launch) launch(m, id, move.launch);
        if (move.dock) dock(m, id);
        inputs.push(move.input);
      }
      stepMatch(m, inputs);
    }
    const log = JSON.parse(JSON.stringify(rec.log()));
    expect(log.runs.length).toBeLessThan(2 * 3000 / 4);
    const again = replaySolo(log, map, ARENA_DEFS, null);
    expect(again.players.length).toBe(bases);
    expect(again.tick).toBe(m.tick);
    expect(hash(again)).toBe(hash(m));
  });
});

describe('replays', () => {
  it('play a recorded match back exactly, and seek both ways', async () => {
    const { ReplayRecorder, ReplayPlayer, checkReplay, packInput: pack, commandCode: code, CHECK_EVERY } = await import('../src/index.js');
    const { botThink, createBot, launch, dock, stepMatch, snapshotMatch, restoreMatch, hashMatch: hash } = await import('@rfw/sim');
    const { ARENA_DEFS } = await import('../../sim/test/arena.js');
    const map = arenaMap(4);
    const seats = [0, 1, 2, 3].map((b) => ({ base: b, team: b, name: `P${b + 1}` }));
    const m = createMatch(arenaWorld(map), map, seats, 99, { difficulty: 6 });
    const rec = new ReplayRecorder({ at: 0, mode: 'training', mapId: 'arena4', mapName: 'Arena', map, seed: 99, difficulty: 6, seats });
    const bots = [1, 2, 3].map(() => createBot());
    const hashes: number[] = [];
    let live = m;
    for (let t = 1; t <= 4000; t++) {
      const commands: [number, number][] = [];
      if (t === 20 || t === 2500) {
        commands.push([0, code({ launch: 'tank' })]);
        launch(live, 0, 'tank');
      }
      if (t === 2000) {
        commands.push([0, code({ dock: true })]);
        dock(live, 0);
      }
      const inputs = [{ throttle: 1 as const, turn: (t % 300 < 60 ? -1 : 0) as -1 | 0, fire: t % 11 === 0 }, undefined, undefined, undefined];
      bots.forEach((bot, i) => {
        const move = botThink(live, i + 1, bot);
        if (move.launch) {
          commands.push([i + 1, code({ launch: move.launch })]);
          launch(live, i + 1, move.launch);
        }
        if (move.dock) {
          commands.push([i + 1, code({ dock: true })]);
          dock(live, i + 1);
        }
        inputs[i + 1] = move.input as never;
      });
      stepMatch(live, inputs);
      rec.frame(live, inputs.map((x) => pack(x)), commands);
      // A repair from the server, as online: the state is replaced by a copy of itself.
      if (t === 3000) {
        const s = snapshotMatch(live);
        live = restoreMatch(s, { defs: ARENA_DEFS, shore: null });
        rec.repair(s);
      }
      hashes.push(hash(live));
    }
    const replay = checkReplay(JSON.parse(JSON.stringify(rec.finish(null))));
    expect(replay.frames).toBe(4000);
    expect(replay.checks.length).toBe(Math.floor(4000 / CHECK_EVERY));
    const player = new ReplayPlayer(replay, ARENA_DEFS, null);
    while (player.step());
    expect(player.outOfStep).toBe(false);
    expect(hash(player.match)).toBe(hash(live));
    player.seek(1700);
    expect(hash(player.match)).toBe(hashes[1699]);
    player.seek(3500);
    expect(hash(player.match)).toBe(hashes[3499]);
    player.seek(10);
    expect(hash(player.match)).toBe(hashes[9]);
    expect(() => checkReplay({ v: 0 })).toThrow();
  });
});
