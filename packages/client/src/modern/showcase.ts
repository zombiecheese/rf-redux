// Stand-in matches for getting the modern view ready while a match loads (ModernRenderer.prepare). Each holds one of
// everything the 3D view can be asked to show: every kind of vehicle in every side's colours (a round of the four for
// each player, as each player has one vehicle at a time), their shots, mines and grenades, wrecks, soldiers walking
// and swimming, drones and the flags. Drawn once each with the loading screen up, their models are built and their
// shaders made then, not the first time one comes on screen mid-match.
//
// The vehicles are launched and made to fire in a throwaway match on a copy of the map, so the real match (and its
// random numbers, which online play must keep in step) is never touched. The stand-ins share the real match's
// world, so the renderer does not build the map again for them.

import {
  Rng, VEHICLE_KINDS, buildWorld, createMatch, launchNow, makeDrone, makeSoldier, makeWreck, stepMatch,
  type BuildingDef, type Match, type RfwMap, type ShoreTable, type VehicleInput,
} from '@rfw/sim';

/** Ticks each round of vehicles runs for: long enough for every gun to have fired and a helicopter to be up. */
const ROUND_TICKS = 48;

export function showcase(real: Match, map: RfwMap, defs: readonly BuildingDef[], shore: ShoreTable | null): Match[] {
  const out: Match[] = [];
  const slots = real.players.map((p) => ({ base: p.base, team: p.team }));
  for (let round = 0; round < VEHICLE_KINDS.length; round++) {
    let t: Match;
    try {
      t = createMatch(buildWorld(map, defs, shore), map, slots, 1 + round, { difficulty: 1 });
    } catch {
      return out;
    }
    for (const p of t.players) {
      const kind = VEHICLE_KINDS[(p.id + round) % VEHICLE_KINDS.length]!;
      // A map may give a side none of a kind; the stand-in has one anyway.
      if (p.lives[kind] === 0) p.lives[kind] = 1;
      launchNow(t, p.id, kind);
    }
    for (let n = 0; n < ROUND_TICKS; n++) {
      const input: VehicleInput = { throttle: n < 24 ? 1 : 0, turn: 0, fire: n % 8 < 4, fire2: n % 8 >= 4, fire3: n === 20 };
      stepMatch(t, t.players.map(() => input));
    }
    const rng = new Rng(7 + round);
    const vehicles = t.players.flatMap((p) => (p.vehicle ? [p.vehicle] : []));
    out.push({
      ...real,
      // The real match's map, not the copy: the renderer keeps its world built.
      world: real.world,
      players: t.players,
      projectiles: t.projectiles,
      grenades: t.grenades,
      mines: t.mines,
      blasts: [],
      lifts: [],
      events: [],
      eliminated: real.eliminated.map(() => false),
      flags: real.flags.map((f) => ({ ...f, revealed: true, carrier: -1 })),
      wrecks: vehicles.flatMap((v, i) => [
        makeWreck(i * 2, v.kind, v.base, v.team, v.x + 40 * 65536, v.y, 0, v.heading, 0, t.tick, false, 0),
        makeWreck(i * 2 + 1, v.kind, v.base, v.team, v.x - 40 * 65536, v.y, 0, v.heading, 0, t.tick, true, 0),
      ]),
      soldiers: round === 0 ? vehicles.flatMap((v) => [0, 1, 2, 3].flatMap((step) => {
        const s = makeSoldier(v.base, v.team, v.x + 20 * 65536, v.y + step * 4 * 65536, t.tick, rng);
        return [{ ...s, frame: step << 16, water: false }, { ...s, frame: step << 16, water: true }];
      })) : [],
      drones: round === 0 ? vehicles.map((v, i) => makeDrone(i, v.base, v, v.x, v.y - 30 * 65536, t.tick)) : [],
      sub: null,
      rng,
    });
  }
  return out;
}
