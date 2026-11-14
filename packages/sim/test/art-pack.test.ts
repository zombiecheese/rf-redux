// The art pack builder (tools/build-art.mjs): hand-drawn PNGs and sets drawn in code come out as an atlas the client
// can cut its sprites from, and the pack committed under assets/art/pack is what the sources build.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildingDefs, type BuildingRecord } from '../src/buildings.js';
import type { ExplosionScript } from '../src/explosions.js';

const tool = (name: string) => fileURLToPath(new URL(`../../../tools/${name}`, import.meta.url));
// The Docker build runs the tests with only packages/ copied in: no tools, nothing to check there.
const here = existsSync(tool('build-art.mjs'));
interface Img { w: number; h: number; px: Uint32Array }
interface Png { encodePng(img: Img): Buffer; decodePng(buf: Buffer): Img; image(w: number, h: number, fill?: number): Img; rgb(r: number, g: number, b: number, a?: number): number }
let png: Png;
let dir = '';
const run = (...args: string[]) => spawnSync(process.execPath, [tool('build-art.mjs'), ...args], { encoding: 'utf8' });

beforeAll(async () => {
  if (!here) return;
  png = (await import(pathToFileURL(tool('art/png.mjs')).href)) as Png;
  dir = mkdtempSync(join(tmpdir(), 'rfw-art-'));
});
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!here)('the art pack', () => {
  it('packs sprites drawn in code and by hand, the hand-drawn one winning', () => {
    const sets = join(dir, 'sets');
    const cels = join(dir, 'cels');
    mkdirSync(sets);
    mkdirSync(cels);
    writeFileSync(join(sets, 'demo.mjs'), `
      import { image, rgb } from ${JSON.stringify(pathToFileURL(tool('art/png.mjs')).href)};
      export function draw(put) {
        put(5, image(4, 3, rgb(10, 20, 30)));
        put(7, image(8, 8, rgb(1, 2, 3)), { mode: 0x1234 });
      }`);
    const hand = png.image(6, 2, png.rgb(200, 100, 50));
    hand.px[0] = png.rgb(0, 0, 0, 0);
    hand.px[1] = png.rgb(9, 9, 9, 40);
    writeFileSync(join(cels, '7.png'), png.encodePng(hand));
    const made = run('--out', join(dir, 'pack'), '--sets', sets, '--cels', cels);
    expect(made.status, made.stderr).toBe(0);
    const frames = JSON.parse(readFileSync(join(dir, 'pack/sprites/frames.json'), 'utf8')) as { cel: number; atlas: number; x: number; y: number; w: number; h: number; packed?: number }[];
    expect(frames.map((f) => [f.cel, f.w, f.h, f.packed])).toEqual([[5, 4, 3, undefined], [7, 6, 2, undefined]]);
    const atlas = png.decodePng(readFileSync(join(dir, 'pack/sprites/atlas-0.png')));
    const at = (cel: number, x: number, y: number) => {
      const f = frames.find((q) => q.cel === cel)!;
      return atlas.px[(f.y + y) * atlas.w + f.x + x];
    };
    expect(at(5, 3, 2)).toBe(png.rgb(10, 20, 30));
    expect(at(7, 5, 1)).toBe(png.rgb(200, 100, 50));
    // See-through pixels, whatever their colour, are the one transparent colour.
    expect([at(7, 0, 0), at(7, 1, 0)]).toEqual([0, 0]);
    expect(JSON.parse(readFileSync(join(dir, 'pack/art.json'), 'utf8'))).toMatchObject({ format: 'rfw-art', sprites: 2, atlases: 1 });
    // The same sources check as up to date; a changed drawing does not.
    expect(run('--check', '--out', join(dir, 'pack'), '--sets', sets, '--cels', cels).status).toBe(0);
    writeFileSync(join(cels, '9.png'), png.encodePng(png.image(2, 2, png.rgb(1, 1, 1))));
    expect(run('--check', '--out', join(dir, 'pack'), '--sets', sets, '--cels', cels).status).toBe(1);
  });

  it('is committed as its sources build it', () => {
    const checked = run('--check');
    expect(checked.status, checked.stderr).toBe(0);
  });

  it('carries the model and number tables, and a sprite for every face of every model', () => {
    const pack = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../assets/art/pack/${name}`, import.meta.url)), 'utf8')) as unknown;
    interface Face { cel: number; flags: number; v: number[] }
    interface M { verts: number[][]; faces: Face[]; sectors?: number[][] }
    const records = pack('buildings.json') as (BuildingRecord & { id: number; parts: { model: M | null }[]; stubs?: (M | null)[] })[];
    const effects = pack('effects.json') as { defs: Record<string, ExplosionScript> };
    const defs = buildingDefs(records, effects.defs);
    expect(defs.length).toBe(91);
    expect(records.every((r, i) => r.id === i)).toBe(true);
    // Whatever a building names exists: the explosion that brings it down and the building it turns into.
    for (const r of records) for (const key of [r.explosion, r.crushExplosion]) if (key) expect(effects.defs[key], `${r.name} ${key}`).toBeDefined();
    for (const d of defs) expect(d.becomes).toBeLessThan(91);
    expect(defs.filter((d) => d.hp > 0).length).toBeGreaterThan(30);
    expect(Object.keys((pack('shore.json') as { polygons: object }).polygons).length).toBe(20);
    const cels = new Set((pack('sprites/frames.json') as { cel: number }[]).map((f) => f.cel));
    const models: [string, M][] = [];
    for (const r of records) {
      r.parts.forEach((p, i) => p.model && models.push([`${r.name} part ${i}`, p.model]));
      (r.stubs ?? []).forEach((m, i) => m && models.push([`${r.name} stub ${i}`, m]));
    }
    const walk = (o: unknown, name: string): void => {
      if (o && typeof o === 'object' && 'faces' in o && 'verts' in o) models.push([name, o as M]);
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${name} ${k}`);
    };
    walk(pack('vehicles.json'), 'vehicle');
    expect(models.length).toBeGreaterThan(150);
    for (const [name, m] of models) {
      for (const f of m.faces) {
        expect(f.v.every((k) => m.verts[k]?.length === 3), name).toBe(true);
        expect(cels.has(f.cel), `${name}: no sprite ${f.cel}`).toBe(true);
        // A face in its side's colour (flag 8) has Green's sprite next to Brown's.
        if (f.flags & 8) expect(cels.has(f.cel + 1), `${name}: no sprite ${f.cel + 1}`).toBe(true);
      }
      for (const order of m.sectors ?? []) expect(order.every((i) => i < m.faces.length), name).toBe(true);
    }
  });

  it('gives every shadow, rotor blur and radar grid its draw mode, with no other pack to take one from', () => {
    // These are drawn onto what is under them (1 and 2 darken, 3 blends); with no mode they would be drawn solid.
    const modes = new Map((JSON.parse(readFileSync(fileURLToPath(new URL('../../../assets/art/pack/sprites/frames.json', import.meta.url)), 'utf8')) as { cel: number; packed?: number }[]).map((f) => [f.cel, f.packed ?? 0]));
    for (const cel of [217, 274, 327, 412, 462, 579]) expect([cel, modes.get(cel)]).toEqual([cel, 1]);
    for (const cel of [582, 583, 586, 587, 1963]) expect([cel, modes.get(cel)]).toEqual([cel, 3]);
    expect(modes.get(626)).toBe(2);
  });

  it('carries the 35 sound effects as 8-bit WAV files', () => {
    const dir = fileURLToPath(new URL('../../../assets/art/pack/sound/', import.meta.url));
    const names = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(names.length).toBe(35);
    for (const name of names) {
      const data = readFileSync(join(dir, name));
      expect(data.toString('latin1', 0, 4) + data.toString('latin1', 8, 12), name).toBe('RIFFWAVE');
      expect([data.readUInt32LE(24), data.readUInt16LE(34), data.readUInt32LE(40)], name).toEqual([11025, 8, data.length - 44]);
      // Not silence: the samples swing well away from the middle.
      expect(Math.max(...data.subarray(44)) - Math.min(...data.subarray(44)), name).toBeGreaterThan(100);
    }
  });

  it('carries the cockpit panels and the split screen post at the sizes the game draws them', () => {
    const dir = fileURLToPath(new URL('../../../assets/art/pack/screens/', import.meta.url));
    const size = (name: string) => {
      const data = readFileSync(join(dir, `${name}.png`));
      return [data.readUInt32BE(16), data.readUInt32BE(20)];
    };
    expect(readdirSync(dir).sort()).toEqual(['1pbscrl.png', '2pbscrl.png', '2pmscr.png']);
    expect([size('1pbscrl'), size('2pbscrl'), size('2pmscr')]).toEqual([[320, 88], [320, 92], [16, 304]]);
  });
});
