import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  botThink, buildWorld, buildingDefs, createBot, createMatch, dock, launch, stepMatch,
  type BuildingRecord, type ShoreTable, type Match, type RfwMap, type VehicleInput,
} from '../src/index.js';

// Plays bots against each other on a converted original map (private generated assets, see docs/assets.md).
const DIR = fileURLToPath(new URL('../../../assets/art/pack', import.meta.url));
const MAP = join(DIR, 'maps', 'rfmap101.json');
const present = existsSync(MAP) && existsSync(join(DIR, 'buildings.json')) && existsSync(join(DIR, 'shore.json'));

function play(ticks: number): { m: Match; destroyed: number } {
  const defs = buildingDefs(JSON.parse(readFileSync(join(DIR, 'buildings.json'), 'utf8')) as BuildingRecord[]);
  const map = JSON.parse(readFileSync(MAP, 'utf8')) as RfwMap;
  const shore = JSON.parse(readFileSync(join(DIR, 'shore.json'), 'utf8')) as ShoreTable;
  const m = createMatch(buildWorld(map, defs, shore), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 7);
  const bots = [createBot(), createBot()];
  let destroyed = 0;
  for (let t = 0; t < ticks && m.winner === null; t++) {
    const inputs: (VehicleInput | undefined)[] = bots.map((b, p) => {
      const move = botThink(m, p, b);
      if (move.launch) launch(m, p, move.launch);
      if (move.dock) dock(m, p);
      return move.input;
    });
    stepMatch(m, inputs);
    destroyed += m.events.filter((e) => e.type === 'buildingDestroyed' || e.type === 'destroyed').length;
  }
  return { m, destroyed };
}

describe.skipIf(!present)('bots', () => {
  it('launch, drive out and fight', () => {
    const { m, destroyed } = play(20000);
    expect(destroyed).toBeGreaterThan(0);
    expect(m.players.some((p) => p.state !== 'bunker')).toBe(true);
  });

  it('play the same game every time', () => {
    const a = play(5000).m;
    const b = play(5000).m;
    expect(JSON.stringify(a.players)).toBe(JSON.stringify(b.players));
    expect(a.world.hp).toEqual(b.world.hp);
  });
});
