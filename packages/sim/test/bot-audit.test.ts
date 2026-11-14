// Bot balance audit: bot-only matches on the test arena, counting who wins and who goes out first. It only runs when
// asked for, as it plays hundreds of matches:
//   AUDIT=ffa3,ffa4,2v2,2v1v1 SEEDS=60 npx vitest run packages/sim/test/bot-audit.test.ts
// Results are appended to AUDIT_OUT (bot-audit.txt in the temp folder by default), because vitest hides console
// output. Other switches: SEED0 (first seed), DIFF (difficulty), HANDICAP=1, NOSCENERY=1 (a bare, mirror-true arena),
// TAG (a label for the lines). The dNM layouts are duels between two bases of the four-base arena.
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { botThink, createBot, createMatch, dock, launch, stepMatch, type SlotSetup, type VehicleInput } from '../src/index.js';
import { arenaMap, arenaWorld } from './arena.js';

const OUT = process.env.AUDIT_OUT ?? join(tmpdir(), 'bot-audit.txt');
const LAYOUTS: Record<string, SlotSetup[]> = {
  ffa3: [0, 1, 2].map((b) => ({ base: b, team: b })),
  ffa4: [0, 1, 2, 3].map((b) => ({ base: b, team: b })),
  ffa4r: [3, 2, 1, 0].map((b) => ({ base: b, team: b })),
  d01: [{ base: 0, team: 0 }, { base: 1, team: 1 }], d23: [{ base: 2, team: 2 }, { base: 3, team: 3 }],
  d02: [{ base: 0, team: 0 }, { base: 2, team: 2 }], d13: [{ base: 1, team: 1 }, { base: 3, team: 3 }],
  d03: [{ base: 0, team: 0 }, { base: 3, team: 3 }], d12: [{ base: 1, team: 1 }, { base: 2, team: 2 }],
  '2v1': [{ base: 0, team: 0 }, { base: 1, team: 1 }, { base: 2, team: 0 }],
  '2v2': [{ base: 0, team: 0 }, { base: 1, team: 1 }, { base: 2, team: 0 }, { base: 3, team: 1 }],
  '2v1v1': [{ base: 0, team: 0 }, { base: 1, team: 1 }, { base: 2, team: 0 }, { base: 3, team: 2 }],
};
const names = (process.env.AUDIT ?? '').split(',').filter((n) => n in LAYOUTS);
const seeds = Number(process.env.SEEDS ?? 12);
const first0 = Number(process.env.SEED0 ?? 1);
const handicap = process.env.HANDICAP === '1';

it.skipIf(names.length > 0)('is skipped unless AUDIT names layouts', () => {});

for (const name of names) {
  it(`audit ${name}`, () => {
    const slots = LAYOUTS[name]!;
    const wins: Record<string, number> = {};
    const firstOut: Record<string, number> = {};
    let ticks = 0;
    let caps = 0;
    let outs = 0;
    for (let seed = first0; seed < first0 + seeds; seed++) {
      const map = arenaMap(4);
      if (process.env.NOSCENERY) map.objects = map.objects.filter((o) => o.base !== null);
      const m = createMatch(arenaWorld(map), map, slots, seed, { difficulty: Number(process.env.DIFF ?? 5), handicap });
      const bots = m.players.map(() => createBot());
      let first = -1;
      for (let t = 0; t < 90000 && m.winner === null && !m.draw; t++) {
        const inputs: (VehicleInput | undefined)[] = bots.map((b, p) => {
          const move = botThink(m, p, b);
          if (move.launch) launch(m, p, move.launch);
          if (move.dock) dock(m, p);
          return move.input;
        });
        stepMatch(m, inputs);
        for (const e of m.events) {
          if (e.type === 'eliminated') { outs++; if (first < 0) first = e.base; }
          if (e.type === 'captured') caps++;
        }
      }
      ticks += m.tick;
      const w = m.winner === null ? (m.draw ? 'draw' : 'none') : `t${m.winner}`;
      wins[w] = (wins[w] ?? 0) + 1;
      firstOut[`b${first}`] = (firstOut[`b${first}`] ?? 0) + 1;
    }
    appendFileSync(OUT, `${process.env.TAG ?? ''} ${name}${handicap ? '+h' : ''} seeds ${first0}-${first0 + seeds - 1}: wins ${JSON.stringify(wins)} firstOut ${JSON.stringify(firstOut)} caps ${caps}/${outs} avgTicks ${Math.round(ticks / seeds)}\n`);
  }, 3_600_000);
}
