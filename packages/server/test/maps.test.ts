import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { MAP_PLANS, mapErrors } from '@rfw/sim';
import { Maps } from '../src/maps.js';
import { createGameServer, extras } from '../src/server.js';
import { ARENA_RECORDS, madeUpOriginal } from '../../sim/test/arena.js';

// An assets folder as the converter writes it, with one made-up original map.
const dir = mkdtempSync(join(tmpdir(), 'rfw-assets-'));
mkdirSync(join(dir, 'maps'));
writeFileSync(join(dir, 'buildings.json'), JSON.stringify(ARENA_RECORDS));
writeFileSync(join(dir, 'maps', 'rfmap999.json'), JSON.stringify(madeUpOriginal()));
writeFileSync(join(dir, 'maps', 'index.json'), JSON.stringify([{ id: 'rfmap999', name: 'Made Up', level: 3, players: { min: 2, max: 2 } }]));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('built-in maps', () => {
  it('lists the 3- and 4-base maps made from the originals after them, and serves them from memory', () => {
    const maps = new Maps(dir);
    const list = maps.list();
    expect(list[0]).toMatchObject({ id: 'rfmap999', bases: 2, source: 'original' });
    expect(list.slice(1).map((m) => m.id)).toEqual(MAP_PLANS.map((p) => p.id));
    expect(list.find((m) => m.id === 'quad01')).toMatchObject({ name: 'Four Corners', bases: 4, source: 'generated', players: { min: 2, max: 4 } });
    expect(maps.get('tri01')?.bases).toHaveLength(3);
    expect(maps.get('rfmap999')?.name).toBe('Made Up');
    expect(maps.indexFile().map((m) => m.id)).toEqual(list.map((m) => m.id));
    expect(maps.generatedMap('rfmap999')).toBeNull();
  });

  it('serves the map list and the made maps under /generated/maps/', async () => {
    const game = createGameServer({
      clientDir: '/nonexistent', assetsDir: dir, dataDir: null, trustProxy: false, secureCookies: false, backupHours: 0, backupKeep: 1,
    });
    await new Promise<void>((r) => game.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(game.server.address() as AddressInfo).port}`;
    try {
      const index = (await (await fetch(`${base}/generated/maps/index.json`)).json()) as { id: string }[];
      expect(index.map((m) => m.id)).toContain('quad08');
      const map = (await (await fetch(`${base}/generated/maps/quad08.json`)).json()) as { bases: unknown[] };
      expect(map.bases).toHaveLength(4);
      // The originals are still files.
      expect(((await (await fetch(`${base}/generated/maps/rfmap999.json`)).json()) as { name: string }).name).toBe('Made Up');
      expect((await fetch(`${base}/generated/maps/nothing.json`)).status).toBe(404);
      const lobby = (await (await fetch(`${base}/api/lobby-maps`)).json()) as { maps: { id: string; source: string }[] };
      expect(lobby.maps.find((m) => m.id === 'tri08')?.source).toBe('generated');
    } finally {
      await game.close();
    }
  });

  it('runs on the art pack alone: its tables, its two-player maps and the maps made from them', () => {
    const pack = fileURLToPath(new URL('../../../assets/art/pack', import.meta.url));
    const maps = new Maps('/nonexistent', pack);
    expect(maps.ready).toBe(true);
    const list = maps.list();
    expect(list.filter((m) => m.source === 'original')).toHaveLength(104);
    expect(list.filter((m) => m.source === 'generated').map((m) => m.id)).toEqual(MAP_PLANS.map((p) => p.id));
    for (const m of list) {
      const map = maps.get(m.id);
      expect(map?.bases, m.id).toHaveLength(m.bases);
      expect(mapErrors(map!, maps.defs, maps.shore).map((p) => p.code), m.id).toEqual([]);
    }
    // The pack's file wins over an asset pack's of the same name.
    const both = new Maps(dir, pack);
    expect(both.get('rfmap101')?.name).toBe(maps.get('rfmap101')?.name);
    expect(both.builtIn('rfmap999')).toBe(false);
    // It makes the 16 maps twice and checks all 120, which takes a slow machine more than the usual five seconds.
  }, 60_000);
  it('lists the optional extras that are there, so the client asks for no others', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rfw-extras-'));
    try {
      expect(extras(dir)).toEqual([]);
      mkdirSync(join(dir, 'music'));
      for (const f of ['soundfont.sf2', 'tank.mid', 'notes.txt']) writeFileSync(join(dir, 'music', f), 'x');
      expect(extras(dir)).toEqual(['music/soundfont.sf2', 'music/tank.mid']);
      const game = createGameServer({ clientDir: '/nonexistent', assetsDir: dir, dataDir: null, trustProxy: false, secureCookies: false, backupHours: 0, backupKeep: 1 });
      await new Promise<void>((r) => game.server.listen(0, '127.0.0.1', r));
      try {
        const res = await fetch(`http://127.0.0.1:${(game.server.address() as AddressInfo).port}/generated/extras.json`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ files: ['music/soundfont.sf2', 'music/tank.mid'] });
      } finally {
        await game.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
