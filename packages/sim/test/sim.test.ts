import { describe, expect, it } from 'vitest';
import {
  ANGLE_MASK, BUILDING, GRID, ONE, TURRET_SWING, Rng, TILE_SIZE, VEHICLES, buildWorld, buildingDefs, cos, createMatch, damageBuilding, decodeTerrain,
  dock, encodeTerrain, headingTo, launch as launchUp, launchNow, makeVehicle, mul, sin, stepMatch, stepVehicle, tileCentre, validateMap,
  MINE_ARMED, SHALLOW as SHALLOW_GROUND, DEEP, LAND as LAND_GROUND, WATER_FACTOR, groundAt, sunk, type ShoreTable, botSkill, clampDifficulty, distance, div, layMine, mineArmed, mineBlastReach, sqrt, stepGrenade, throwGrenade,
  HELI_HEIGHT, busy, WRECK_TICKS, WRECK_TOUGHNESS, fireProjectile, GATE_OPEN, GATE_SETTLE, MsvcRand, sceneryOffsets, sceneryVariety, sceneryEntry, touch, hitBuilding, makeSoldier, soldiersFrom, SOLDIER_UNSEEN,
  CAMP_TICKS, DRONE_HEIGHT, DRONE_SPAWN, DRONE_UNSEEN, dronePool,
  BARREL_UP, FINE_TURN, PROJECTILES, fineAtan2, fineCos, fineSin, stepProjectile, DEATH_MISSILE,
  DOCK_DOORS, LIFT_DEPTH, LIFT_HOLE, LIFT_SPEED, elevatorTicks, liftOf, skipLift, SCALE_FULL, SKULL_END, SKULL_FADE, SKULL_HOLD, SKULL_LAUGH, skullLook,
  type BuildingRecord, type Shape, type Match, type RfwMap, type Vehicle, type VehicleInput, type VehicleKind,
} from '../src/index.js';

/**
 * Launches with the vehicle straight out, skipping the lift, and facing north as most of these tests were written
 * for (it comes up facing south).
 */
function launch(m: Match, player: number, kind: VehicleKind): boolean {
  if (!launchNow(m, player, kind)) return false;
  m.players[player]!.vehicle!.heading = 0;
  return true;
}

const LAND = 0;
const WATER = 2;
const SHALLOW = 24;
const ROAD = 80;

// A stand-in for the original building table (which is never committed), with the records these tests use.
// Shapes are made up for the tests: a box of half-size h px, and a pad of the given kind.
const PX = 0x10000;
const box = (h: number, flags = [0, 0, 1, 255], high = 16): Shape =>
  ({ type: 2, flags, z: [0, high * PX], offset: [0, 0], bounds: [-h * PX, -h * PX, h * PX, h * PX] });
const pad = (kind: number, h = 20) => box(h, [2, kind, 1, 2]);

function fakeTable(): BuildingRecord[] {
  const raw = (r2: number, r10 = 0) => [0, 0, r2, 0, 0, 0, 0, 0, 0, 0, r10, 0, 0];
  const t: BuildingRecord[] = Array.from({ length: 91 }, (_, i) => ({ name: `B${i}`, raw: raw(0) }));
  const set = (i: number, name: string, r2: number, r10 = 0, shapes?: Shape[]) => (t[i] = { name, raw: raw(r2, r10), shapes });
  set(0, 'NOTHING', 0);
  set(1, 'BUSH_1S', 0x1ff, 0x5700);
  set(14, 'AMMO', 0x268, 0x4100);
  set(22, 'FLAG', 0x66d, 0x3e00);
  set(31, 'BNKR_N', 0x500, 0x3300);
  set(39, 'FUEL_N', 0x100, 0x4d00, [box(8), pad(1)]);
  set(7, 'ROCK_1S', 0xff, 0, [box(6, [0, 0, 1, 255], 5)]);
  set(43, 'GATE_H', 0x558, 0x4200, [box(16), { ...box(32, [2, 3, 32, 34], 24) }]);
  set(47, 'TENT_V', 0x1ff, 0x4000, [box(10)]);
  set(49, 'TOWER', 0x5ff, 0x3d00);
  set(51, 'STD_DEST', 0x10000);
  set(62, 'DMG_FLAG', 0x66e, 0x3f00);
  set(63, 'DEST_FLAG', 0x6f, 0, [box(6)]);
  set(74, 'BRIGE_H', 0x5ff);
  set(75, 'BRIGE_V', 0x5ff);
  // Buildings with men: barracks let out 2 + rand(2), a prison 4 + rand(4) of the other side's.
  t[23] = { name: 'BLDG_N', raw: [0, 0x310000, 0x500, 0, 0, 0, 0, 0, 0, 0, 0x3300, 0, 0], shapes: [box(10)] };
  t[15] = { name: 'PRISON_S', raw: [0, 0x848001, 0x500, 0, 0, 0, 0, 0, 0, 0, 0x3300, 0, 0], shapes: [box(10)] };
  return t;
}
const DEFS = buildingDefs(fakeTable());

function map(fill: (x: number, y: number) => number, extra: Partial<RfwMap> = {}): RfwMap {
  const terrain = new Uint8Array(128 * 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) terrain[y * 128 + x] = fill(x, y);
  return {
    format: 'rfw-map', version: 1, name: 'test', author: 'test', source: null, width: 128, height: 128,
    players: { min: 1, max: 1 }, terrain: encodeTerrain(terrain),
    bases: [{ id: 0, start: { x: 5, y: 6 }, flagSites: [{ x: 9, y: 9 }] }],
    objects: [],
    settings: { vehicles: { tank: null, jeep: null, asv: null, heli: null }, randomMines: null, aiPool: null },
    ...extra,
  };
}

const TWO_BASES: Partial<RfwMap> = {
  players: { min: 2, max: 2 },
  bases: [
    { id: 0, start: { x: 10, y: 10 }, flagSites: [{ x: 12, y: 10 }] },
    { id: 1, start: { x: 40, y: 10 }, flagSites: [{ x: 42, y: 10 }] },
  ],
};

function vehicleAt(tx: number, ty: number, kind: Vehicle['kind'] = 'jeep'): Vehicle {
  return makeVehicle(kind, 0, 0, 0, tileCentre(tx), tileCentre(ty));
}

const GO: VehicleInput = { throttle: 1, turn: 0 };

describe('fixed point', () => {
  it('has a quarter-turn sine table', () => {
    expect(sin(0)).toBe(0);
    expect(cos(0)).toBe(ONE);
    expect(sin(16 * ONE)).toBe(ONE);
    // Truncated, as the original's _ftol leaves them: sin(pi / 32) * 65536 is 6423.8.
    expect(sin(ONE)).toBe(6423);
    expect(sin(33 * ONE)).toBe(-6423);
    expect(TILE_SIZE).toBe(32 * ONE);
  });

  it('multiplies like the original 64-bit imul and shift', () => {
    expect(mul(0x10ccc, 0x13333)).toBe(Number((0x10cccn * 0x13333n) >> 16n));
    expect(mul(-0x6666, 0x13333)).toBe(Number((-0x6666n * 0x13333n) >> 16n));
    expect(mul(0x7fffffff, 0x7fffffff)).toBe(Number(BigInt.asIntN(32, (0x7fffffffn * 0x7fffffffn) >> 16n)));
    expect(mul(-3, 1)).toBe(-1);
  });
});

describe('building table', () => {
  it('reads hit points, placement terrain and what each building becomes', () => {
    expect(DEFS[22]).toMatchObject({ name: 'FLAG', hp: 6, becomes: 62, placeTerrain: 0x6d, solid: true });
    expect(DEFS[31]).toMatchObject({ hp: 5, becomes: 51, placeTerrain: 0 });
    expect(DEFS[1]).toMatchObject({ hp: 1, placeTerrain: null, solid: false });
    expect(DEFS[51]).toMatchObject({ hp: 0, placeTerrain: 0 });
  });
});

describe('map format', () => {
  it('round-trips terrain through base64 for any length', () => {
    for (const n of [1, 2, 3, 4, 100, 16384]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
      expect(decodeTerrain(encodeTerrain(bytes))).toEqual(bytes);
    }
  });

  it('places bases, flag sites and objects on the grid', () => {
    const w = buildWorld(map(() => LAND, { objects: [{ type: 'BNKR_N', x: 7, y: 7, base: 0 }] }), DEFS);
    expect(w.bases).toEqual([{ id: 0, start: { tx: 5, ty: 6 }, flagSites: [{ tx: 9, ty: 9 }] }]);
    expect(w.buildings).toEqual([
      { building: 31, base: 0, tx: 7, ty: 7 },
      { building: BUILDING.FLAG, base: 0, tx: 9, ty: 9 },
    ]);
    expect(w.hp[7 * GRID + 7]).toBe(5);
    expect(w.owner[7 * GRID + 7]).toBe(0);
  });

  it('centres a small map in open water', () => {
    const small = { ...map(() => LAND), width: 2, height: 2, terrain: encodeTerrain(new Uint8Array(4)), bases: [{ id: 0, start: { x: 0, y: 0 }, flagSites: [] }] };
    const w = buildWorld(small, DEFS);
    expect(w.terrain[63 * 128 + 63]).toBe(LAND);
    expect(w.terrain[0]).toBe(WATER);
    expect(w.bases[0]!.start).toEqual({ tx: 63, ty: 63 });
  });

  it('builds bridges between bridge-end terrain, as the original loader does', () => {
    const w = buildWorld(map((x, y) => (y === 20 && x === 10 ? 84 : y === 20 && x === 14 ? 85 : x === 30 && y === 5 ? 86 : x === 30 && y === 8 ? 87 : LAND)), DEFS);
    expect([10, 11, 12, 13, 14].map((x) => w.building[20 * GRID + x])).toEqual([0, 74, 74, 74, 0]);
    expect([5, 6, 7, 8].map((y) => w.building[y * GRID + 30])).toEqual([0, 75, 75, 0]);
    expect(w.hp[20 * GRID + 11]).toBe(5);
  });

  it('rejects player counts the start points cannot hold', () => {
    expect(() => validateMap(map(() => LAND, { players: { min: 2, max: 4 } }))).toThrow(/bases/);
  });

  it('rejects unknown building types', () => {
    expect(() => buildWorld(map(() => LAND, { objects: [{ type: 'MOON_BASE', x: 1, y: 1, base: null }] }), DEFS)).toThrow(/MOON_BASE/);
  });
});

describe('building damage', () => {
  it('takes one hit point per whole unit of damage, at least one, and turns into rubble', () => {
    const w = buildWorld(map(() => LAND, { objects: [{ type: 'BNKR_N', x: 7, y: 7, base: 0 }] }), DEFS);
    const i = 7 * GRID + 7;
    const rng = new Rng(1);
    expect(damageBuilding(w, i, 0x18000, rng)).toBe(false);
    expect(w.hp[i]).toBe(4);
    expect(damageBuilding(w, i, 0x8000, rng)).toBe(false);
    expect(w.hp[i]).toBe(3);
    expect(damageBuilding(w, i, 0x30000, rng)).toBe(true);
    expect(w.building[i]).toBe(51);
    expect(w.hp[i]).toBe(0);
  });
});

describe('stepVehicle', () => {
  it('accelerates to the original top speed and no further', () => {
    const w = buildWorld(map(() => LAND), DEFS);
    const v = vehicleAt(64, 64, 'tank');
    for (let i = 0; i < 100; i++) stepVehicle(v, GO, w);
    expect(v.speed).toBe(VEHICLES.tank.maxForward);
  });

  it('is 1.2 times faster on roads', () => {
    const w = buildWorld(map(() => ROAD), DEFS);
    const v = vehicleAt(64, 64, 'tank');
    for (let i = 0; i < 100; i++) stepVehicle(v, GO, w);
    expect(v.speed).toBe(mul(VEHICLES.tank.maxForward, 0x13333));
  });

  it('drives north with heading 0 and brakes to a stop without throttle', () => {
    const w = buildWorld(map(() => LAND), DEFS);
    const v = vehicleAt(64, 64);
    const y0 = v.y;
    for (let i = 0; i < 60; i++) stepVehicle(v, GO, w);
    expect(v.y).toBeLessThan(y0);
    expect(v.x).toBe(tileCentre(64));
    for (let i = 0; i < 1000 && v.speed; i++) stepVehicle(v, { throttle: 0, turn: 0 }, w);
    expect(v.speed).toBe(0);
  });

  it('swings the tank turret 0x4CCC a tick, and both turret keys bring it back to centre', () => {
    const w = buildWorld(map(() => LAND), DEFS);
    const v = vehicleAt(64, 64, 'tank');
    for (let i = 0; i < 10; i++) stepVehicle(v, { throttle: 0, turn: 0, turretRight: true }, w);
    expect(v.turret).toBe(10 * TURRET_SWING);
    expect(v.heading).toBe(0);
    for (let i = 0; i < 3; i++) stepVehicle(v, { throttle: 0, turn: 0, turretLeft: true, turretRight: true }, w);
    for (let i = 0; i < 10; i++) stepVehicle(v, { throttle: 0, turn: 0 }, w);
    expect(v.turret).toBe(0);
    stepVehicle(v, { throttle: 0, turn: 0, turretLeft: true }, w);
    expect(v.turret).toBe(ANGLE_MASK + 1 - TURRET_SWING);
  });

  it('turns a full circle in 64 / turn rate ticks', () => {
    const w = buildWorld(map(() => LAND), DEFS);
    const v = vehicleAt(64, 64, 'tank');
    for (let i = 0; i < 256; i++) stepVehicle(v, { throttle: 0, turn: 1 }, w);
    expect(v.heading).toBe(0);
  });

  it('wades into water, sinks in deep water and is lost; the helicopter flies over', () => {
    const m = map((_, y) => (y < 58 ? WATER : y < 60 ? SHALLOW : LAND), TWO_BASES);
    const match = createMatch(buildWorld(m, DEFS), m, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
    launch(match, 0, 'tank');
    launch(match, 1, 'heli');
    const tank = match.players[0]!.vehicle!;
    const heli = match.players[1]!.vehicle!;
    tank.x = heli.x = tileCentre(64);
    tank.y = heli.y = tileCentre(61);
    heli.heli!.phase = 'fly';
    heli.z = HELI_HEIGHT;
    let slowest = Infinity;
    for (let i = 0; i < 400 && match.players[0]!.state === 'driving'; i++) {
      stepMatch(match, [GO, GO]);
      if (tank.ground === SHALLOW_GROUND) slowest = Math.min(slowest, tank.speed);
    }
    expect(match.players[0]!.state).toBe('lost');
    expect(match.events.some((e) => e.type === 'destroyed' && e.drowned)).toBe(true);
    // Wading is at most 0.75 of top speed.
    expect(slowest).toBeLessThanOrEqual(mul(VEHICLES.tank.maxForward, WATER_FACTOR));
    expect(heli.y >> 21).toBeLessThan(58);
  });

  it('sinks 0x6666 a tick to its sink depth, and comes back up in shallow water', () => {
    const w = buildWorld(map((x) => (x < 64 ? WATER : SHALLOW)), DEFS);
    const jeep = vehicleAt(63, 64);
    const still: VehicleInput = { throttle: 0, turn: 0 };
    let ticks = 0;
    while (!sunk(jeep)) {
      stepVehicle(jeep, still, w);
      ticks++;
    }
    // The depth is compared in whole pixels, rounding down: -31 * 0x6666 is just past -13 px.
    expect(ticks).toBe(31);
    jeep.x = tileCentre(65);
    for (let i = 0; i < 40; i++) stepVehicle(jeep, still, w);
    expect(jeep.z).toBe(0);
  });

  it('floats a jeep on its tyres in deep water, and lets them down out of it', () => {
    const m = map((_, y) => (y < 60 ? WATER : LAND), TWO_BASES);
    const match = createMatch(buildWorld(m, DEFS), m, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
    launch(match, 0, 'jeep');
    const jeep = match.players[0]!.vehicle!;
    jeep.x = tileCentre(64);
    jeep.y = tileCentre(59);
    stepMatch(match, [{ throttle: 0, turn: 0 }]);
    // On land the button does nothing.
    stepMatch(match, [{ throttle: 0, turn: 0, fire2: true }]);
    expect(jeep.tyres).toBe(true);
    expect(match.events).toContainEqual(expect.objectContaining({ type: 'tyres', out: true }));
    // Held down, it does not toggle again; in deep water it cannot be let down.
    for (let i = 0; i < 200; i++) stepMatch(match, [{ throttle: 0, turn: 0, fire2: i % 2 === 0 }]);
    expect(jeep.tyres).toBe(true);
    expect(match.players[0]!.state).toBe('driving');
    expect(jeep.z).toBe(0);
  });

  it('is deterministic for the same inputs', () => {
    const w = buildWorld(map(() => LAND), DEFS);
    const run = () => {
      const v = vehicleAt(64, 64, 'tank');
      for (let i = 0; i < 300; i++) stepVehicle(v, { throttle: 1, turn: i % 50 < 25 ? 1 : -1 }, w);
      return [v.x, v.y, v.heading, v.speed, v.fuel];
    };
    expect(run()).toEqual(run());
  });
});

function twoPlayerMatch(objects: RfwMap['objects'] = []): Match {
  const m = map(() => LAND, { ...TWO_BASES, objects });
  return createMatch(buildWorld(m, DEFS), m, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 42);
}

function drive(m: Match, ticks: number, input: VehicleInput, player = 0): void {
  for (let i = 0; i < ticks; i++) stepMatch(m, player === 0 ? [input] : [undefined, input]);
}

describe('match', () => {
  it('uses a life on launch and gives it back on docking', () => {
    const m = twoPlayerMatch();
    expect(launch(m, 0, 'tank')).toBe(true);
    expect(m.players[0]!.lives.tank).toBe(2);
    expect(dock(m, 0)).toBe(true);
    expect(m.players[0]!.lives.tank).toBe(3);
    expect(m.players[0]!.state).toBe('docking');
    skipLift(m, 0);
    expect(m.players[0]!.state).toBe('bunker');
  });

  it('fires tank shells along the turret, not the hull', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    const tank = m.players[0]!.vehicle!;
    tank.turret = tank.turretTarget = 16 << 16; // a quarter turn right: east
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    const shell = m.projectiles[0]!;
    expect(shell.vx).toBeGreaterThan(0);
    expect(Math.abs(shell.vy)).toBe(0);
  });

  it('loses a jeep to one tank shell and sends the player back after the delay', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    launch(m, 1, 'jeep');
    const tank = m.players[0]!.vehicle!;
    const jeep = m.players[1]!.vehicle!;
    jeep.x = tank.x;
    jeep.y = tank.y - 4 * TILE_SIZE;
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    for (let i = 0; i < 60 && m.players[1]!.state === 'driving'; i++) stepMatch(m, []);
    expect(m.players[1]!.state).toBe('lost');
    expect(m.players[1]!.lives.jeep).toBe(7);
    // The view watches it blow up, then the skull laughs, then the bunker fades in.
    for (let i = 0; i < VEHICLES.jeep.respawnDelay; i++) stepMatch(m, []);
    expect(m.players[1]!.state).toBe('skull');
    let laughs = 0;
    for (let i = 0; i < SKULL_END && m.players[1]!.state === 'skull'; i++) {
      stepMatch(m, []);
      laughs += m.events.filter((e) => e.type === 'laugh' && e.player === 1).length;
    }
    expect(laughs).toBe(1);
    expect(m.players[1]!.state).toBe('bunker');
    expect(m.players[1]!.death).toBeNull();
  });

  it('fades a tank out of fuel straight to the bunker, without the skull', () => {
    const m = twoPlayerMatch();
    launch(m, 1, 'tank');
    m.players[1]!.vehicle!.fuel = 0;
    stepMatch(m, []);
    expect(m.players[1]!.death).toMatchObject({ kind: 'tank', skull: false });
    for (let i = 0; i < VEHICLES.tank.respawnDelay + 1; i++) stepMatch(m, []);
    expect(m.players[1]!.state).toBe('lost');
    expect(m.players[1]!.fade).toBeLessThan(ONE);
    for (let i = 0; i < 20 && m.players[1]!.state === 'lost'; i++) stepMatch(m, []);
    expect(m.players[1]!.state).toBe('bunker');
  });

  it('grows and spins the skull in, upright before the laugh, and fades the map out under it', () => {
    const first = skullLook(0);
    expect(first.scale).toBeLessThan(ONE / 10);
    expect(first.map).toBe(ONE);
    expect(skullLook(SKULL_HOLD).map).toBeLessThan(ONE);
    const laughing = skullLook(SKULL_LAUGH + 1);
    expect(laughing).toMatchObject({ map: null, scale: SCALE_FULL, angle: 0, light: ONE });
    expect(laughing.lives).toBeGreaterThan(0);
    const faces = new Set(Array.from({ length: SKULL_FADE - SKULL_LAUGH }, (_, t) => skullLook(SKULL_LAUGH + t).face));
    expect([...faces].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(skullLook(SKULL_END - 1).light).toBeLessThanOrEqual(0);
  });

  it('reveals a flag when shells destroy its building, and eliminates the base when an enemy jeep brings it home', () => {
    const m = twoPlayerMatch();
    const flag = m.flags[1]!;
    launch(m, 0, 'tank');
    const tank = m.players[0]!.vehicle!;
    tank.x = flag.x;
    tank.y = flag.y + 3 * TILE_SIZE;
    // FLAG and DMG_FLAG have 6 hit points each; a shell does 1.
    for (let i = 0; i < 400 && !flag.revealed; i++) stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    expect(flag.revealed).toBe(true);
    expect(m.world.building[flag.site]).toBe(BUILDING.DEST_FLAG);
    expect(dock(m, 0)).toBe(false);
    m.players[0]!.vehicle = null;
    m.players[0]!.state = 'bunker';
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    // The opened flag building stops the jeep; touching it hands over the flag.
    jeep.x = flag.x;
    jeep.y = flag.y + 24 * PX;
    for (let i = 0; i < 60 && flag.carrier < 0; i++) stepMatch(m, [GO]);
    expect(flag.carrier).toBe(0);
    expect(jeep.y).toBeGreaterThan(flag.y);
    const home = m.world.bases[0]!.start;
    jeep.x = tileCentre(home.tx);
    jeep.y = tileCentre(home.ty);
    stepMatch(m, [{ throttle: 0, turn: 0 }]);
    expect(m.eliminated[1]).toBe(true);
    expect(m.winner).toBe(0);
  });

  it('puts down and picks up a flag with the jeep\'s third button', () => {
    const m = twoPlayerMatch();
    const flag = m.flags[1]!;
    flag.revealed = true;
    m.world.building[flag.site] = BUILDING.DEST_FLAG;
    flag.x = tileCentre(20);
    flag.y = tileCentre(10);
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    jeep.x = flag.x;
    jeep.y = flag.y;
    stepMatch(m, [{ throttle: 0, turn: 0 }]);
    expect(flag.carrier).toBe(0);
    // Put down, it stays down while the jeep sits on it.
    stepMatch(m, [{ throttle: 0, turn: 0, fire3: true }]);
    expect(flag.carrier).toBe(-1);
    expect(flag.dropper).toBe(0);
    for (let i = 0; i < 5; i++) stepMatch(m, [{ throttle: 0, turn: 0 }]);
    expect(flag.carrier).toBe(-1);
    // A second press picks it up again.
    stepMatch(m, [{ throttle: 0, turn: 0, fire3: true }]);
    expect(flag.carrier).toBe(0);
  });

  it('hides a side\'s own flag again when its jeep docks with it', () => {
    const m = twoPlayerMatch();
    const flag = m.flags[0]!;
    flag.revealed = true;
    const site = flag.site;
    flag.x = tileCentre(20);
    flag.y = tileCentre(10);
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    jeep.x = flag.x;
    jeep.y = flag.y;
    stepMatch(m, [{ throttle: 0, turn: 0 }]);
    expect(flag.carrier).toBe(0);
    const home = m.world.bases[0]!.start;
    jeep.x = tileCentre(home.tx);
    jeep.y = tileCentre(home.ty);
    stepMatch(m, [{ throttle: 0, turn: 0 }]);
    // Carrying its own flag home captures nothing.
    expect(m.eliminated[0]).toBe(false);
    expect(dock(m, 0)).toBe(true);
    expect(flag.carrier).toBe(-1);
    expect(flag.revealed).toBe(false);
    expect(flag.site).toBe(site);
    expect(m.events.some((e) => e.type === 'flagReturned')).toBe(true);
  });

  it('eliminates a base that has no vehicles left', () => {
    const m = twoPlayerMatch();
    m.players[1]!.lives = { tank: 0, jeep: 0, asv: 0, heli: 0 };
    stepMatch(m, []);
    expect(m.eliminated[1]).toBe(true);
    expect(m.winner).toBe(0);
  });

  it('eliminates a base with no jeeps left, whatever else it has', () => {
    const m = twoPlayerMatch();
    m.players[1]!.lives = { tank: 3, jeep: 0, asv: 3, heli: 3 };
    stepMatch(m, []);
    expect(m.eliminated[1]).toBe(true);
    expect(m.winner).toBe(0);
  });

  it('keeps a base in while its last jeep is out, and puts it out when that jeep is lost', () => {
    const m = twoPlayerMatch();
    m.players[1]!.lives = { tank: 0, jeep: 1, asv: 0, heli: 0 };
    expect(launch(m, 1, 'jeep')).toBe(true);
    stepMatch(m, []);
    expect(m.eliminated[1]).toBe(false);
    m.players[1]!.vehicle!.fuel = 0;
    stepMatch(m, []);
    expect(m.eliminated[1]).toBe(true);
    expect(m.winner).toBe(0);
  });

  it('keeps a base in when its last jeep docks', () => {
    const m = twoPlayerMatch();
    m.players[1]!.lives = { tank: 0, jeep: 1, asv: 0, heli: 0 };
    launch(m, 1, 'jeep');
    expect(dock(m, 1)).toBe(true);
    stepMatch(m, []);
    expect(m.players[1]!.lives.jeep).toBe(1);
    expect(m.eliminated[1]).toBe(false);
  });

  it('refuels on any side\'s fuel pad, only while standing still', () => {
    const m = twoPlayerMatch([{ type: 'FUEL_N', x: 10, y: 12, base: 1 }]);
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    jeep.heading = 32 << 16;
    jeep.fuel = 100 * ONE;
    // Drive south onto the pad (it reaches 20 px round the depot's centre; the depot itself is 8 px).
    for (let i = 0; i < 100 && !jeep.pad; i++) stepMatch(m, [GO]);
    expect(jeep.pad).not.toBeNull();
    const fuel = jeep.fuel;
    stepMatch(m, [GO]);
    expect(jeep.fuel).toBeLessThanOrEqual(fuel);
    for (let i = 0; i < 60 && jeep.speed !== 0; i++) stepMatch(m, [{ throttle: 0, turn: 0 }]);
    const before = jeep.fuel;
    stepMatch(m, [{ throttle: 0, turn: 0 }]);
    expect(jeep.fuel).toBe(before + 0x8000);
  });

  it('wakes an enemy gun tower, which turns to the jeep and destroys it', () => {
    const m = twoPlayerMatch([{ type: 'TOWER', x: 10, y: 20, base: 1 }]);
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    jeep.x = tileCentre(13);
    jeep.y = tileCentre(20);
    stepMatch(m, []);
    expect(m.turrets).toHaveLength(1);
    // Up to 300 ticks to wake, then a quarter turn at 0x3333 a tick. The first shell goes over (the gun has not
    // tilted yet), the next comes down on the jeep.
    for (let i = 0; i < 700 && m.players[0]!.state === 'driving'; i++) stepMatch(m, []);
    expect(m.players[0]!.state).toBe('lost');
    expect(m.turrets[0]!.heading).toBe(headingTo(1, 0));
    // The tower never hits its own tile.
    expect(m.world.building[20 * GRID + 10]).toBe(49);
  });

  it('leaves its own side alone', () => {
    const m = twoPlayerMatch([{ type: 'TOWER', x: 10, y: 20, base: 0 }]);
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    jeep.y = tileCentre(18);
    for (let i = 0; i < 100; i++) stepMatch(m, []);
    expect(m.turrets).toHaveLength(0);
  });

  it('points headings with the sine table: 0 north, 16 east, 32 south, 48 west', () => {
    expect([headingTo(0, -5), headingTo(5, 0), headingTo(0, 5), headingTo(-5, 0)]).toEqual([0, 16 << 16, 32 << 16, 48 << 16]);
  });

  it('runs identically from the same seed and inputs', () => {
    const run = () => {
      const m = twoPlayerMatch([{ type: 'BNKR_N', x: 20, y: 10, base: 1 }, { type: 'TOWER', x: 25, y: 14, base: 1 }]);
      launch(m, 0, 'tank');
      launch(m, 1, 'heli');
      for (let i = 0; i < 600; i++) {
        stepMatch(m, [{ throttle: 1, turn: i % 90 < 45 ? 1 : 0, fire: i % 7 === 0 }, { throttle: 1, turn: -1, fire: true, fire2: true }]);
      }
      return JSON.stringify([m.players.map((p) => p.vehicle), m.flags, m.turrets, Array.from(m.world.hp)]);
    };
    expect(run()).toBe(run());
  });
});

describe('bunker lift', () => {
  const up = Math.ceil(LIFT_DEPTH / LIFT_SPEED);

  it('runs each elevator script for as long as the original', () => {
    expect([elevatorTicks('tank'), elevatorTicks('jeep'), elevatorTicks('asv'), elevatorTicks('heli')]).toEqual([184, 146, 148, 186]);
  });

  it('launches only once the bunker has faded in', () => {
    const m = twoPlayerMatch();
    expect(launchUp(m, 0, 'jeep')).toBe(false);
    for (let i = 0; i < 15; i++) stepMatch(m, []);
    expect(launchUp(m, 0, 'jeep')).toBe(true);
    expect(m.players[0]!.lives.jeep).toBe(7);
    expect(m.players[0]!.state).toBe('launching');
  });

  it('takes a vehicle up the elevator, then brings it up on the lift through the open tile', () => {
    const m = twoPlayerMatch();
    for (let i = 0; i < 15; i++) stepMatch(m, []);
    const start = m.world.bases[0]!.start;
    const tile = start.ty * GRID + start.tx;
    const pad = m.world.terrain[tile]!;
    launchUp(m, 0, 'jeep');
    const p = m.players[0]!;
    const lift = liftOf(m, 0)!;
    for (let i = 0; i < elevatorTicks('jeep'); i++) stepMatch(m, []);
    // The bunker has faded out; the lift is still under the closed tile.
    expect(p.elevator).toBeNull();
    expect(p.fade).toBe(0);
    expect(lift.phase).toBe('wait');
    stepMatch(m, []);
    expect(lift.phase).toBe('rise');
    expect(m.world.terrain[tile]! & 127).toBe(LIFT_HOLE);
    const heights: number[] = [];
    for (let i = 0; i < up + 1; i++) {
      stepMatch(m, []);
      heights.push(lift.z);
    }
    expect(heights.every((z, i) => i === 0 || z >= heights[i - 1]!)).toBe(true);
    expect(lift.z).toBe(0);
    expect(p.fade).toBe(ONE);
    expect(p.vehicle).toBeNull();
    stepMatch(m, []);
    // Out the tick after it reaches the top, where it stood on the lift, facing south.
    expect(p.state).toBe('driving');
    expect(p.vehicle).toBe(lift.vehicle);
    expect([p.vehicle!.x, p.vehicle!.y, p.vehicle!.heading]).toEqual([tileCentre(start.tx), tileCentre(start.ty), 32 << 16]);
    expect(m.lifts).toHaveLength(0);
    expect(m.world.terrain[tile]).toBe(pad);
  });

  it('takes a docked vehicle down where it stood, and fades to the bunker on the way', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    const p = m.players[0]!;
    const tank = p.vehicle!;
    const start = m.world.bases[0]!.start;
    const tile = start.ty * GRID + start.tx;
    const pad = m.world.terrain[tile]!;
    tank.x = tileCentre(start.tx) + 5 * PX;
    tank.y = tileCentre(start.ty) - 3 * PX;
    tank.heading = 10 << 16;
    expect(dock(m, 0)).toBe(true);
    expect(p.vehicle).toBeNull();
    expect(p.lives.tank).toBe(3);
    const lift = liftOf(m, 0)!;
    expect(lift.vehicle).toBe(tank);
    expect([tank.x, tank.y, tank.heading]).toEqual([tileCentre(start.tx) + 5 * PX, tileCentre(start.ty) - 3 * PX, 10 << 16]);
    expect(m.world.terrain[tile]! & 127).toBe(LIFT_HOLE);
    let ticks = 0;
    while (p.state === 'docking') {
      stepMatch(m, []);
      ticks++;
      // The screen stays lit until the lift is 16 px down.
      if (lift.z >= -16 * PX) expect(p.fade).toBe(ONE);
    }
    expect(p.state).toBe('bunker');
    expect(ticks).toBe(54 + 15);
    // No launching until the bunker has faded in; meanwhile the lift goes on down and the doors shut.
    expect(launchUp(m, 0, 'tank')).toBe(false);
    while (m.lifts.length) stepMatch(m, []);
    expect(lift.z).toBe(-LIFT_DEPTH);
    expect(lift.doors).toBe(0);
    expect(m.tick).toBeGreaterThanOrEqual(DOCK_DOORS);
    expect(m.world.terrain[tile]).toBe(pad);
    expect(launchUp(m, 0, 'tank')).toBe(true);
  });

  it('clears mines lying on the lift', () => {
    const m = twoPlayerMatch();
    const start = m.world.bases[0]!.start;
    m.mines.push(layMine(tileCentre(start.tx) + 10 * PX, tileCentre(start.ty), 1), layMine(tileCentre(start.tx) + 25 * PX, tileCentre(start.ty), 1));
    for (let i = 0; i < 15; i++) stepMatch(m, []);
    launchUp(m, 0, 'jeep');
    stepMatch(m, []);
    expect(m.mines).toHaveLength(1);
  });
});

describe('grenades and mines', () => {
  it('fires the ASV\'s missiles raised with its second button and lays mines with its third', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'asv');
    const v = m.players[0]!.vehicle!;
    for (let i = 0; i < 400 && busy(v); i++) stepMatch(m, []);
    for (let i = 0; i < 60 && !m.projectiles.length; i++) stepMatch(m, [{ throttle: 0, turn: 0, fire2: true }]);
    expect(m.projectiles.at(-1)).toMatchObject({ kind: 9 });
    expect(m.mines).toHaveLength(0);
    stepMatch(m, [{ throttle: 0, turn: 0, fire3: true }]);
    expect(m.mines).toHaveLength(1);
  });

  it('divides, square-roots and measures distance like the original helpers', () => {
    expect(div(3 * ONE, 2 * ONE)).toBe(0x18000);
    expect(div(-1, 3)).toBe(-21845);
    expect(sqrt(4 * ONE)).toBe(2 * ONE);
    expect(sqrt(2 * ONE)).toBe(92681);
    expect(distance(3 * ONE + 0xffff, 4 * ONE)).toBe(5 * ONE);
  });

  it('throws on an arc that comes down at the target distance', () => {
    for (const px of [20, 48, 61]) {
      const g = throwGrenade(0, 0, 0, 0, 0, 16 * ONE, px);
      let peak = 0;
      while (g.z >= 0) {
        stepGrenade(g);
        peak = Math.max(peak, g.z);
      }
      expect(Math.abs(g.x / ONE - px)).toBeLessThan(3);
      expect(g.y).toBe(0);
      expect(peak).toBeGreaterThan(8 * ONE);
    }
  });

  it('lobs a grenade at an enemy vehicle in range and damages it', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'jeep');
    launch(m, 1, 'tank');
    const jeep = m.players[0]!.vehicle!;
    const tank = m.players[1]!.vehicle!;
    tank.x = jeep.x + 40 * ONE;
    tank.y = jeep.y;
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    expect(m.grenades).toHaveLength(1);
    expect(m.grenades[0]!.heading).toBe(16 * ONE);
    for (let i = 0; i < 80 && m.grenades.length; i++) stepMatch(m, []);
    expect(tank.health).toBe(VEHICLES.tank.health - (0x18000 - VEHICLES.tank.armour));
  });

  it('with nothing in range lands 48 to 62 px ahead without doing damage', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    let landed: { x: number; y: number } | undefined;
    for (let i = 0; i < 100 && !landed; i++) {
      stepMatch(m, []);
      const e = m.events.find((x) => x.type === 'hit');
      if (e && e.type === 'hit') landed = e;
    }
    const d = distance(landed!.x - jeep.x, landed!.y - jeep.y) / ONE;
    expect(d).toBeGreaterThanOrEqual(45);
    expect(d).toBeLessThanOrEqual(65);
  });

  it('throws at the building the jeep last bumped into, and at no other', () => {
    const thrown = (bump: boolean) => {
      const m = twoPlayerMatch();
      launch(m, 0, 'jeep');
      const jeep = m.players[0]!.vehicle!;
      // A standing building one tile to the jeep's right, well inside grenade range but off its heading.
      const tile = ((jeep.y >> 21) * GRID) + (jeep.x >> 21) + 1;
      m.world.building[tile] = 23;
      m.world.hp[tile] = 5;
      if (bump) jeep.bumped = tile;
      stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
      const g = m.grenades[0]!;
      return { g, aim: headingTo(tileCentre(tile % GRID) - jeep.x, tileCentre((tile / GRID) | 0) - jeep.y), ahead: jeep.heading };
    };
    const at = thrown(true);
    expect(at.g.heading).toBe(at.aim);
    const past = thrown(false);
    const off = Math.abs(((((past.g.heading - past.ahead) >> 16) + 32) & 63) - 32);
    expect(off).toBeLessThanOrEqual(4);
  });

  it('arms a mine over 158 ticks, then any ground vehicle sets it off', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    const mine = layMine(jeep.x, jeep.y - 3 * TILE_SIZE, 0);
    m.mines.push(mine);
    for (let i = 0; i < 157; i++) stepMatch(m, []);
    expect(mineArmed(mine)).toBe(false);
    stepMatch(m, []);
    expect(mineArmed(mine)).toBe(true);
    // Its own side's jeep drives onto it all the same.
    for (let i = 0; i < 200 && m.players[0]!.state === 'driving'; i++) stepMatch(m, [GO]);
    expect(m.mines).toHaveLength(0);
    expect(m.players[0]!.state).toBe('lost');
  });

  it('blasts for 144 ticks in a box that starts at 4 px, flashes to 25 and settles at 20, as the mine explosion script sizes it', () => {
    expect([0, 17, 18, 19, 41, 42, 65, 66, 143].map((age) => mineBlastReach(age) / ONE)).toEqual([4, 4, 25, 12, 12, 16, 16, 20, 20]);
    const blast = (stay: boolean) => {
      const m = twoPlayerMatch();
      launch(m, 0, 'tank');
      const tank = m.players[0]!.vehicle!;
      m.mines.push({ ...layMine(tank.x, tank.y, 1), arm: MINE_ARMED });
      const full = tank.health;
      stepMatch(m, []);
      expect(m.blasts).toHaveLength(1);
      // A tank that sits in the blast is destroyed; one that is 60 px away after the first tick only takes that tick.
      if (!stay) tank.y -= 60 * ONE;
      for (let i = 0; i < 143; i++) stepMatch(m, []);
      expect(m.blasts).toHaveLength(0);
      return { state: m.players[0]!.state, lost: full - (m.players[0]!.vehicle?.health ?? 0) };
    };
    expect(blast(true).state).not.toBe('driving');
    const left = blast(false);
    expect(left.state).toBe('driving');
    expect(left.lost).toBeLessThan(2 * ONE);
  });

  it('is set off by a hit stronger than 0x18000 but not by a tank shell', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    const tank = m.players[0]!.vehicle!;
    m.mines.push({ ...layMine(tank.x, tank.y - 3 * TILE_SIZE, 1), arm: MINE_ARMED });
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    for (let i = 0; i < 60; i++) stepMatch(m, []);
    expect(m.mines).toHaveLength(1);
  });

  it('scatters random mines on open ground away from the bases', () => {
    const m = map((x, y) => (y === 30 ? ROAD : LAND), { ...TWO_BASES, settings: { vehicles: { tank: null, jeep: null, asv: null, heli: null }, randomMines: 12, aiPool: null } });
    const match = createMatch(buildWorld(m, DEFS), m, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 7);
    expect(match.mines).toHaveLength(12);
    for (const mine of match.mines) {
      expect(mineArmed(mine)).toBe(true);
      // Beside or on the road first.
      expect(Math.abs((mine.y >> 21) - 30)).toBeLessThanOrEqual(1);
    }
  });

  it('adds four random mines per level above level 6 when the map leaves it to the game', () => {
    const m = map(() => LAND, TWO_BASES);
    const at = (difficulty: number) => createMatch(buildWorld(m, DEFS), m, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 7, { difficulty }).mines.length;
    expect([at(1), at(6), at(7), at(9)]).toEqual([0, 0, 24, 32]);
  });
});

describe('difficulty', () => {
  it('clamps to levels 1 to 9 and defaults to 5', () => {
    expect([clampDifficulty(undefined), clampDifficulty(0), clampDifficulty(12), clampDifficulty(3.7), clampDifficulty(NaN)]).toEqual([5, 1, 9, 3, 5]);
  });

  it('makes bots engage further, react faster and aim straighter as it rises', () => {
    const [easy, mid, hard] = [botSkill(1), botSkill(5), botSkill(9)];
    expect(easy.engageRange).toBeLessThan(mid.engageRange);
    expect(mid.engageRange).toBeLessThan(hard.engageRange);
    expect([easy.reaction, mid.reaction, hard.reaction]).toEqual([80, 40, 0]);
    expect([easy.aimError, mid.aimError, hard.aimError]).toEqual([4, 0, 0]);
  });
});

describe('ground classifier', () => {
  // Made-up shapes for the tests (the real ones come from the game data): terrain 4 is land in a 16 x 32 strip on
  // the tile's west half before rotation, turned a quarter; terrain 40 has shallow water in its north half.
  const shore: ShoreTable = {
    polygons: {
      4: {
        insideIsLand: true, rotation: 16, offset: [0, 0], bounds: [-16 * ONE, -16 * ONE, 15 * ONE, 15 * ONE],
        verts: [[-16 * ONE, -16 * ONE], [2 * ONE, -16 * ONE], [2 * ONE, 15 * ONE], [-16 * ONE, 15 * ONE]], edges: [0, 1, 2, 3],
      },
    },
    boxes: { 40: [-16 * ONE, -16 * ONE, 16 * ONE, 0] },
  };
  const w = buildWorld(map((x) => [0, 1, 2, 24, 4, 40][x] ?? LAND), DEFS, shore);
  const ox = (128 - 128) >> 1;
  const at = (tx: number, px: number, py: number, z = 0) => groundAt(w, ((ox + tx) * 32 + 16 + px) * ONE, (64 * 32 + 16 + py) * ONE, z);

  it('reads land, shallow and deep water by terrain', () => {
    expect([at(0, 0, 0), at(1, 0, 0), at(2, 0, 0), at(3, 0, 0)]).toEqual([LAND_GROUND, SHALLOW_GROUND, DEEP, SHALLOW_GROUND]);
    // Anything more than a pixel up is in the air.
    expect(at(2, 0, 0, 2 * ONE)).toBe(LAND_GROUND);
  });

  it('turns shore polygons clockwise by their rotation', () => {
    // The west strip turned a quarter clockwise lies along the north edge.
    expect(at(4, 0, -12)).toBe(LAND_GROUND);
    expect(at(4, 0, 12)).toBe(SHALLOW_GROUND);
    expect(at(4, -12, 6)).toBe(SHALLOW_GROUND);
  });

  it('has shallow water inside a shore box and deep water outside it', () => {
    expect(at(5, 0, -8)).toBe(SHALLOW_GROUND);
    expect(at(5, 0, 8)).toBe(DEEP);
  });
});

describe('collision', () => {
  const at = (x: number, y: number, heading = 0) => ({ x: x * PX, y: y * PX, z: 0, heading });

  it('touches boxes that overlap and not ones that are apart', () => {
    expect(touch(at(0, 0), [box(4)], at(8, 0), [box(4)])).not.toBeNull();
    expect(touch(at(0, 0), [box(4)], at(9, 0), [box(4)])).toBeNull();
    // Layers must agree: a planter top (mask 4) never meets a vehicle's layer 2.
    expect(touch(at(0, 0), [box(4, [0, 0, 1, 4])], at(0, 0), VEHICLES.tank.shapes)).toBeNull();
  });

  it('turns a vehicle\'s polygon with its heading', () => {
    // The tank is 15 px wide and 22.5 px long: end on, its nose reaches a box 13 px ahead; side on, it does not.
    const wall = [box(2)];
    expect(touch(at(0, 0), VEHICLES.tank.shapes, at(0, -13), wall)).not.toBeNull();
    expect(touch(at(0, 0, 16 << 16), VEHICLES.tank.shapes, at(0, -13), wall)).toBeNull();
    expect(touch(at(0, 0, 16 << 16), VEHICLES.tank.shapes, at(13, 0), wall)).not.toBeNull();
  });

  it('bounces a vehicle off a building at a quarter of its speed, backwards', () => {
    const m = twoPlayerMatch([{ type: 'BNKR_N', x: 10, y: 8, base: null }]);
    launch(m, 0, 'tank');
    const tank = m.players[0]!.vehicle!;
    let bounced = false;
    for (let i = 0; i < 80 && !bounced; i++) {
      const speed = tank.speed;
      const y = tank.y;
      stepMatch(m, [GO]);
      if (tank.y === y && speed > 0) {
        expect(tank.speed).toBe(-Math.min(speed + VEHICLES.tank.accel, VEHICLES.tank.maxForward) >> 2);
        expect(tank.bumped).toBe(8 * GRID + 10);
        bounced = true;
      }
    }
    expect(bounced).toBe(true);
  });

  it('lets a tank over rocks but stops a jeep', () => {
    for (const [kind, through] of [['tank', true], ['jeep', false]] as const) {
      const m = twoPlayerMatch([{ type: 'ROCK_1S', x: 10, y: 8, base: null }]);
      launch(m, 0, kind);
      const v = m.players[0]!.vehicle!;
      drive(m, 120, GO);
      expect(v.y < tileCentre(8)).toBe(through);
    }
  });

  it('crushes a tent when going faster than half a pixel a tick', () => {
    const m = twoPlayerMatch([{ type: 'TENT_V', x: 10, y: 7, base: null }]);
    launch(m, 0, 'tank');
    const crushed: number[] = [];
    for (let i = 0; i < 120; i++) {
      stepMatch(m, [GO]);
      for (const e of m.events) if (e.type === 'buildingDestroyed' && e.crushed) crushed.push(e.tile);
    }
    expect(crushed).toEqual([7 * GRID + 10]);
  });

  it('stops vehicles running into each other', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    launch(m, 1, 'tank');
    const a = m.players[0]!.vehicle!;
    const b = m.players[1]!.vehicle!;
    b.x = a.x;
    b.y = a.y - 40 * PX;
    b.heading = 32 << 16;
    for (let i = 0; i < 100; i++) stepMatch(m, [GO, GO]);
    expect(a.y - b.y).toBeGreaterThanOrEqual(22 * PX);
  });

  it('opens a gate for its own side, shuts it behind them and turns it back into a building', () => {
    const m = twoPlayerMatch([{ type: 'GATE_H', x: 10, y: 5, base: 0 }]);
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    const tile = 5 * GRID + 10;
    for (let i = 0; i < 150 && !m.gates.length; i++) stepMatch(m, [GO]);
    expect(m.gates).toHaveLength(1);
    expect(m.world.building[tile]).toBe(0);
    // It slides open, the jeep drives through, and once the jeep is clear of the zone it slides shut and then
    // becomes the building again.
    let opened = false;
    for (let i = 0; i < 400 && m.gates.length; i++) {
      opened ||= m.gates[0]!.opening === GATE_OPEN;
      stepMatch(m, [GO]);
    }
    expect(jeep.y).toBeLessThan(tileCentre(3));
    expect(opened).toBe(true);
    expect(m.gates).toHaveLength(0);
    expect(m.world.building[tile]).toBe(43);
    expect(GATE_SETTLE).toBe(60);
  });

  it('takes shots on an open gate\'s halves and brings it down as a building', () => {
    const m = twoPlayerMatch([{ type: 'GATE_H', x: 10, y: 5, base: 0 }]);
    launch(m, 0, 'jeep');
    const tile = 5 * GRID + 10;
    for (let i = 0; i < 150 && !m.gates.length; i++) stepMatch(m, [GO]);
    const g = m.gates[0]!;
    m.players[0]!.vehicle!.y = tileCentre(4) - 8 * PX;
    const hp = m.world.hp[tile]!;
    expect(hp).toBeGreaterThan(1);
    // Tank shells from the west, level with the gate, into its western half.
    const shoot = () => m.projectiles.push(fireProjectile(0, 1, 1, [tileCentre(7), tileCentre(5), 4 * PX], [0, 0, 0], headingTo(1, 0), 0));
    shoot();
    for (let i = 0; i < 40 && m.projectiles.length; i++) stepMatch(m, []);
    expect(m.world.hp[tile]).toBe(hp - 1);
    expect(m.gates).toContain(g);
    let lost = false;
    for (let n = 1; n < hp && m.gates.length; n++) {
      shoot();
      for (let i = 0; i < 40 && m.projectiles.length; i++) {
        stepMatch(m, []);
        lost ||= m.events.some((e) => e.type === 'buildingDestroyed' && e.tile === tile && e.building === 43);
      }
    }
    // The last hit ends the gate, and the gate building put back on its tile is destroyed (these test defs have no
    // explosion, so it turns straight into what it becomes).
    expect(m.gates).toHaveLength(0);
    expect(lost).toBe(true);
    expect(m.world.building[tile]).toBe(m.world.defs[43]!.becomes);
  });

  it('keeps a gate shut against the other side', () => {
    const m = twoPlayerMatch([{ type: 'GATE_H', x: 40, y: 5, base: 0 }]);
    launch(m, 1, 'jeep');
    drive(m, 120, GO, 1);
    expect(m.gates).toHaveLength(0);
    expect(m.players[1]!.vehicle!.y).toBeGreaterThan(tileCentre(5));
  });
});

describe('soldiers', () => {
  const tile = (x: number, y: number) => y * GRID + x;

  it('lets men out of a building hit down to its last hit point, but not one destroyed outright', () => {
    const m = twoPlayerMatch([{ type: 'BLDG_N', x: 20, y: 20, base: 1 }, { type: 'BLDG_N', x: 30, y: 20, base: 1 }]);
    hitBuilding(m, tile(20, 20), 3 * ONE);
    expect(m.soldiers).toHaveLength(0);
    hitBuilding(m, tile(20, 20), ONE);
    expect(m.world.hp[tile(20, 20)]).toBe(1);
    expect(m.soldiers.length).toBeGreaterThanOrEqual(2);
    expect(m.soldiers.length).toBeLessThanOrEqual(3);
    expect(m.soldiers.every((s) => s.base === 1 && s.team === 1 && s.ammo >= 0 && s.ammo <= 4)).toBe(true);
    const before = m.soldiers.length;
    hitBuilding(m, tile(30, 20), 10 * ONE);
    expect(m.soldiers).toHaveLength(before);
  });

  it('lets the other side\'s men out of a prison', () => {
    const m = twoPlayerMatch([{ type: 'PRISON_S', x: 20, y: 20, base: 0 }]);
    const out = soldiersFrom(m.world, tile(20, 20), m.rng)!;
    expect(out.base).toBe(1);
    expect(out.at.length).toBeGreaterThanOrEqual(4);
    expect(out.at.length).toBeLessThanOrEqual(7);
  });

  it('walks new men out of the building, then runs from a vehicle nearby', () => {
    const m = twoPlayerMatch([{ type: 'BLDG_N', x: 10, y: 14, base: 1 }]);
    launch(m, 0, 'tank');
    hitBuilding(m, tile(10, 14), 4 * ONE);
    expect(m.soldiers.length).toBeGreaterThan(0);
    stepMatch(m, []);
    const body = { x: tileCentre(10), y: tileCentre(14) };
    for (const s of m.soldiers) expect(Math.abs(s.x - body.x) > 10 * PX || Math.abs(s.y - body.y) > 10 * PX).toBe(true);
    const tank = m.players[0]!.vehicle!;
    const far = () => Math.min(...m.soldiers.map((s) => distance(s.x - tank.x, s.y - tank.y)));
    const start = far();
    for (let i = 0; i < 60; i++) stepMatch(m, []);
    expect(far()).toBeGreaterThan(start);
    expect(m.soldiers.every((s) => s.state === 'run' || s.state === 'throw' || s.state === 'wait')).toBe(true);
  });

  it('is run over by any vehicle that touches him, his own side\'s too', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    m.soldiers.push({ ...makeSoldier(0, 0, jeep.x, jeep.y - 30 * PX, 0, m.rng), state: 'idle', timer: 1000 });
    let killed = false;
    for (let i = 0; i < 60 && !killed; i++) {
      stepMatch(m, [GO]);
      killed = m.events.some((e) => e.type === 'soldierKilled');
    }
    expect(killed).toBe(true);
    expect(m.soldiers).toHaveLength(0);
  });

  it('is too small for a level tank shell, but killed by a shot coming down', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    const tank = m.players[0]!.vehicle!;
    m.soldiers.push({ ...makeSoldier(1, 1, tank.x, tank.y - 60 * PX, 0, m.rng), state: 'idle', timer: 1000 });
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    for (let i = 0; i < 40; i++) stepMatch(m, []);
    expect(m.soldiers).toHaveLength(1);
    const s = m.soldiers[0]!;
    // 40 degrees down from 10 px, 3 px a tick: it comes to the ground about 10 px on.
    m.projectiles.push(fireProjectile(7, 0, 0, [s.x, s.y + 8.5 * PX, 10 * PX], [0, 0, 0], 0, 0x71c71));
    for (let i = 0; i < 10 && m.soldiers.length; i++) stepMatch(m, []);
    expect(m.soldiers).toHaveLength(0);
  });

  it('throws a grenade at an enemy vehicle once he has wound up', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    const tank = m.players[0]!.vehicle!;
    const s = { ...makeSoldier(1, 1, tank.x, tank.y + 80 * PX, 0, m.rng), state: 'throw' as const, target: tank, ammo: 1, frame: 0x60000 };
    m.soldiers.push(s);
    stepMatch(m, []);
    expect(m.events).toContainEqual({ type: 'fired', shot: 'grenade', x: s.x, y: s.y });
    expect(m.grenades).toHaveLength(1);
    expect(m.grenades[0]!.team).toBe(1);
    expect(m.soldiers[0]!.ammo).toBe(0);
    expect(m.soldiers[0]!.state).toBe('wait');
  });

  it('stops a closing gate, which opens again', () => {
    const m = twoPlayerMatch([{ type: 'GATE_H', x: 10, y: 5, base: 0 }]);
    launch(m, 0, 'jeep');
    for (let i = 0; i < 150 && !m.gates.length; i++) stepMatch(m, [GO]);
    const g = m.gates[0]!;
    m.players[0]!.vehicle!.y = tileCentre(20);
    for (let i = 0; i < 100 && g.target === GATE_OPEN; i++) stepMatch(m, []);
    expect(g.target).toBe(0);
    // A man standing in the gateway, where the halves meet.
    m.soldiers.push({ ...makeSoldier(0, 0, tileCentre(10), tileCentre(5), m.tick, m.rng), state: 'idle', timer: 100000 });
    for (let i = 0; i < 40; i++) stepMatch(m, []);
    expect(g.target).toBe(GATE_OPEN);
    expect(m.gates).toContain(g);
  });

  it('is gone two seconds after nobody can see him', () => {
    const m = twoPlayerMatch();
    m.soldiers.push({ ...makeSoldier(0, 0, tileCentre(60), tileCentre(60), 0, m.rng), state: 'idle', timer: 10000 });
    for (let i = 0; i < SOLDIER_UNSEEN; i++) stepMatch(m, []);
    expect(m.soldiers).toHaveLength(1);
    stepMatch(m, []);
    expect(m.soldiers).toHaveLength(0);
  });
});

describe('helicopter', () => {
  function airborne(m: Match): Vehicle {
    launch(m, 0, 'heli');
    const h = m.players[0]!.vehicle!;
    for (let i = 0; i < 1000 && busy(h); i++) stepMatch(m, []);
    return h;
  }

  it('winds up, lifts off to 50 px drifting east and swinging round, and only then can fire', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'heli');
    const h = m.players[0]!.vehicle!;
    const x0 = h.x;
    let ticks = 0;
    for (; busy(h) && ticks < 1000; ticks++) {
      stepMatch(m, [{ throttle: 1, turn: 0, fire: true }]);
      expect(m.projectiles).toHaveLength(0);
    }
    // 56 ticks of engine, 161 of rotor, then 100 climbing at 0.5 px a tick, 0.25 px east each.
    expect(ticks).toBe(56 + 161 + 100);
    expect(h.z).toBe(HELI_HEIGHT);
    expect(h.x - x0).toBe(100 * 0x4000);
    expect(h.heading).toBe((-100 * 0x4000) & ANGLE_MASK);
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    expect(m.projectiles).toHaveLength(1);
  });

  it('fires its picked weapon down with the first button and level with the second, and swaps with the third', () => {
    const m = twoPlayerMatch();
    const h = airborne(m);
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    expect(m.projectiles.at(-1)).toMatchObject({ kind: 7, pitch: 0x71c71 });
    for (let i = 0; i < 20; i++) stepMatch(m, []);
    stepMatch(m, [{ throttle: 0, turn: 0, fire2: true }]);
    expect(m.projectiles.at(-1)).toMatchObject({ kind: 7, pitch: 0, heading: h.heading });
    stepMatch(m, [{ throttle: 0, turn: 0, fire3: true }]);
    expect(m.events).toContainEqual(expect.objectContaining({ type: 'weapon', slot: 1 }));
    // Held, it does not swap back.
    stepMatch(m, [{ throttle: 0, turn: 0, fire3: true }]);
    expect(h.weapon).toBe(1);
    stepMatch(m, [{ throttle: 0, turn: 0, fire2: true }]);
    expect(m.projectiles.at(-1)).toMatchObject({ kind: 6, pitch: 0 });
  });

  it('keeps moving after the throttle is let go, and hovers about on the spot', () => {
    const m = twoPlayerMatch();
    const h = airborne(m);
    for (let i = 0; i < 120; i++) stepMatch(m, [{ throttle: 1, turn: 0 }]);
    for (let i = 0; i < 20; i++) stepMatch(m, []);
    const glide = { x: h.x, y: h.y };
    stepMatch(m, []);
    expect(distance(h.x - glide.x, h.y - glide.y)).toBeGreaterThan(0);
    for (let i = 0; i < 300; i++) stepMatch(m, []);
    expect(h.speed).toBe(0);
    const still = { x: h.x, y: h.y };
    for (let i = 0; i < 300; i++) stepMatch(m, []);
    expect(distance(h.x - still.x, h.y - still.y)).toBeLessThan(40 * PX);
  });

  it('strafes sideways with the turret keys', () => {
    const m = twoPlayerMatch();
    const h = airborne(m);
    h.heading = 0;
    const x0 = h.x;
    for (let i = 0; i < 60; i++) stepMatch(m, [{ throttle: 0, turn: 0, turretRight: true }]);
    expect(h.x - x0).toBeGreaterThan(20 * PX);
    expect(h.heading).toBe(0);
  });

  it('lands on its lift facing heading 24 and is taken in, life returned', () => {
    const m = twoPlayerMatch();
    const h = airborne(m);
    const lives = m.players[0]!.lives.heli;
    const start = m.world.bases[0]!.start;
    h.x = tileCentre(start.tx) + 5 * PX;
    h.y = tileCentre(start.ty) - 3 * PX;
    expect(dock(m, 0)).toBe(true);
    let lowest = h.z;
    for (let i = 0; i < 1000 && m.players[0]!.state === 'driving'; i++) {
      stepMatch(m, []);
      lowest = Math.min(lowest, h.z);
      if (h.z === 0) {
        expect(h.x).toBe(tileCentre(start.tx));
        expect(h.y).toBe(tileCentre(start.ty));
        expect(h.heading).toBe(24 << 16);
      }
    }
    expect(lowest).toBe(0);
    expect(m.players[0]!.state).toBe('docking');
    expect(m.players[0]!.lives.heli).toBe(lives + 1);
    // It goes down on the lift where it landed.
    expect(liftOf(m, 0)!.vehicle).toBe(h);
  });
});

describe('shots in 3D', () => {
  it('has a fine sine for angles between the table\'s steps, and an angle finder', () => {
    expect([fineSin(0), fineSin(FINE_TURN / 4), fineSin(FINE_TURN / 2), fineCos(0), fineSin(FINE_TURN / 12)]).toEqual([0, ONE, 0, ONE, 32767]);
    expect(Math.abs(fineAtan2(5, 5) - FINE_TURN / 8)).toBeLessThan(2);
    expect([fineAtan2(0, -3), fineAtan2(-3, 0), fineAtan2(0, 3)]).toEqual([FINE_TURN / 2, -FINE_TURN / 4, 0]);
  });

  it('fires a tank shell level from the end of its barrel, 12 px ahead and 7 px up, for 80 ticks', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    const tank = m.players[0]!.vehicle!;
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    const p = m.projectiles[0]!;
    // Fired, then moved once.
    expect([p.x - tank.x, p.y - tank.y + 3 * PX, p.z, p.vz]).toEqual([0, -12 * PX, 7 * PX, 0]);
    let moves = 1;
    while (stepProjectile(p)) moves++;
    expect(moves).toBe(PROJECTILES[0]!.life - 1);
  });

  it('flies a level shell over a rock and into a building', () => {
    const m = twoPlayerMatch([{ type: 'ROCK_1S', x: 10, y: 8, base: null }, { type: 'BLDG_N', x: 10, y: 5, base: 1 }]);
    launch(m, 0, 'tank');
    const hp = m.world.hp[5 * GRID + 10]!;
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    const hits: string[] = [];
    for (let i = 0; i < 80; i++) {
      stepMatch(m, []);
      for (const e of m.events) if (e.type === 'hit') hits.push(`${e.target} ${e.y >> 21}`);
    }
    expect(hits).toEqual(['building 5']);
    expect(m.world.hp[5 * GRID + 10]).toBeLessThan(hp);
  });

  it('raises the tank\'s barrel for the second button and fires up, high enough for a helicopter', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    const tank = m.players[0]!.vehicle!;
    let ticks = 0;
    for (; !m.projectiles.length && ticks < 40; ticks++) stepMatch(m, [{ throttle: 0, turn: 0, fire2: true }]);
    // 0x471c7 at 0x4ccc a tick, the press itself turning it once more on the first tick.
    expect(ticks).toBe(14);
    expect(tank.barrel).toBe(BARREL_UP);
    const p = m.projectiles[0]!;
    let top = p.z;
    while (stepProjectile(p)) top = Math.max(top, p.z);
    expect(top).toBeGreaterThan(50 * PX);
    // The first button lowers it again, and the shot fires level once the gun has reloaded.
    m.projectiles = [];
    for (let i = 0; i < 14; i++) stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    expect(tank.barrel).toBe(0);
    for (let i = 0; i < 20 && !m.projectiles.length; i++) stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    expect(m.projectiles[0]!.vz).toBe(0);
  });

  it('hits a helicopter in the air with a raised shell, which a level one passes under', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    launch(m, 1, 'heli');
    const tank = m.players[0]!.vehicle!;
    const h = m.players[1]!.vehicle!;
    for (let i = 0; i < 1000 && busy(h); i++) stepMatch(m, []);
    const health = h.health;
    const hover = () => { h.x = tank.x; h.y = tank.y - 110 * PX; h.heli!.vx = 0; h.heli!.vy = 0; };
    hover();
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    for (let i = 0; i < 80; i++) { hover(); stepMatch(m, []); }
    expect(h.health).toBe(health);
    for (let i = 0; i < 120 && h.health === health; i++) { hover(); stepMatch(m, [{ throttle: 0, turn: 0, fire2: true }]); }
    expect(h.health).toBeLessThan(health);
  });

  it('fires the helicopter\'s guns down from either side in turn, angled in', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'heli');
    const h = m.players[0]!.vehicle!;
    for (let i = 0; i < 1000 && busy(h); i++) stepMatch(m, []);
    h.heading = 0;
    stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    const a = m.projectiles[0]!;
    const z0 = a.z;
    const y0 = a.y;
    for (let i = 0; i < 20 && m.projectiles.length < 2; i++) stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
    const b = m.projectiles[1]!;
    expect(a.x).toBeGreaterThan(h.x);
    expect(b.x).toBeLessThan(h.x);
    expect([a.heading, b.heading]).toEqual([(h.heading - 0x20000) & ANGLE_MASK, (h.heading + 0x20000) & ANGLE_MASK]);
    expect(a.pitch).toBe(0x71c71);
    expect(a.vz).toBeLessThan(0);
    // It comes down about 60 px ahead.
    let ground = false;
    for (let i = 0; i < 60 && !ground; i++) {
      stepMatch(m, []);
      ground = m.events.some((e) => e.type === 'hit' && e.target === 'ground');
    }
    expect(ground).toBe(true);
    expect(z0).toBeGreaterThan(45 * PX);
    expect(y0 - a.y).toBeGreaterThan(55 * PX);
  });

  it('fires the ASV\'s three tubes in turn, then reloads them', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'asv');
    const asv = m.players[0]!.vehicle!;
    const shots: [number, number][] = [];
    for (let i = 0; i < 200; i++) {
      stepMatch(m, [{ throttle: 0, turn: 0, fire: true }]);
      for (const e of m.events) if (e.type === 'fired') shots.push([m.tick, e.x - asv.x]);
    }
    const gaps = shots.slice(1, 4).map(([t], i) => t - shots[i]![0]);
    expect(gaps).toEqual([30, 30, 41]);
    expect(shots.slice(0, 4).map(([, dx]) => dx)).toEqual([-0x18000, 0, 0x18000, -0x18000]);
  });

  it('holds a gun tower\'s fire while its own side is in the line of fire', () => {
    const m = twoPlayerMatch([{ type: 'TOWER', x: 10, y: 20, base: 1 }, { type: 'BLDG_N', x: 12, y: 20, base: 1 }]);
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    jeep.x = tileCentre(13);
    jeep.y = tileCentre(20);
    let fired = 0;
    for (let i = 0; i < 700; i++) {
      stepMatch(m, []);
      fired += m.events.filter((e) => e.type === 'fired').length;
    }
    expect(m.turrets[0]!.heading).toBe(headingTo(1, 0));
    // It wakes with its tile's stored aim, tilted down (scenery byte 0 is 10 here), so no shell clears its building.
    expect(fired).toBe(0);
    expect(m.players[0]!.state).toBe('driving');
  });
});

describe('wrecks', () => {
  /** A shot of the given type coming down onto the vehicle from 20 px north of it. */
  function shoot(m: Match, kind: number, x: number, y: number): void {
    m.projectiles.push(fireProjectile(kind, 1, 1, [x, y - 20 * PX, 4 * PX], [0, 0, 0], 32 << 16, 0));
  }

  it('a helicopter shot down in the air falls and blows apart where it lands', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'heli');
    const h = m.players[0]!.vehicle!;
    for (let i = 0; i < 1000 && busy(h); i++) stepMatch(m, []);
    h.health = 1;
    m.projectiles.push(fireProjectile(11, 1, 1, [h.x, h.y - 20 * PX, h.z + 4 * PX], [0, 0, 0], 32 << 16, 0));
    for (let i = 0; i < 30 && !m.wrecks.length; i++) stepMatch(m, []);
    const w = m.wrecks[0]!;
    expect(w.kind).toBe('heli');
    expect(w.z).toBeGreaterThan(0);
    let blown: { z: number } | undefined;
    for (let i = 0; i < 400 && m.wrecks.length; i++) {
      stepMatch(m, []);
      blown ??= m.events.find((e) => e.type === 'wreckBlown') as { z: number } | undefined;
    }
    expect(blown?.z).toBe(0);
    expect(m.wrecks).toHaveLength(0);
    expect(m.events).toContainEqual(expect.objectContaining({ type: 'wreckMark', kind: 'heli', model: 'remains' }));
  });

  it('leaves a wreck that runs on with its speed, then lies as a mark on the ground', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'tank');
    const tank = m.players[0]!.vehicle!;
    tank.y = tileCentre(30);
    for (let i = 0; i < 30; i++) stepMatch(m, [GO]);
    tank.health = 1;
    shoot(m, 0, tank.x, tank.y);
    let ticks = 0;
    for (; ticks < 20 && !m.wrecks.length; ticks++) stepMatch(m, [GO]);
    expect(m.wrecks).toHaveLength(1);
    const w = m.wrecks[0]!;
    expect(w.speed).toBeGreaterThan(0);
    const y0 = w.y;
    let mark = null;
    for (let i = 0; i < 100 && !mark; i++) {
      stepMatch(m, []);
      mark = m.events.find((e) => e.type === 'wreckMark') ?? null;
    }
    expect(mark).toMatchObject({ kind: 'tank', base: 0, model: 'wreck', ticks: WRECK_TICKS });
    expect(w.y).toBeLessThan(y0);
    expect(m.wrecks).toHaveLength(0);
  });

  it('stands in the way when out of fuel, without exploding, and lets its driver out', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    jeep.y = tileCentre(30);
    jeep.fuel = 1;
    stepMatch(m, [GO]);
    expect(m.events).toContainEqual(expect.objectContaining({ type: 'destroyed', fuelOut: true }));
    const w = m.wrecks[0]!;
    for (let i = 0; i < 20; i++) stepMatch(m, []);
    expect(w.model).toBe('body');
    expect(m.soldiers).toHaveLength(1);
    expect(m.soldiers[0]!.base).toBe(0);
    expect(Math.abs(m.soldiers[0]!.x - w.x) + Math.abs(m.soldiers[0]!.y - w.y)).toBeGreaterThan(4 * PX);
    // Another vehicle runs into it.
    launch(m, 1, 'tank');
    const tank = m.players[1]!.vehicle!;
    tank.x = w.x;
    tank.y = w.y + 40 * PX;
    for (let i = 0; i < 80; i++) stepMatch(m, [undefined, GO]);
    expect(tank.y - w.y).toBeGreaterThan(10 * PX);
    for (let i = 0; i < WRECK_TICKS; i++) stepMatch(m, []);
    expect(m.wrecks).toHaveLength(0);
  });

  it('blows apart when shot for 12.0, leaving its remains', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    jeep.y = tileCentre(30);
    jeep.fuel = 1;
    stepMatch(m, [GO]);
    const w = m.wrecks[0]!;
    for (let i = 0; i < 20; i++) stepMatch(m, []);
    let blown = false;
    for (let n = 0; n < WRECK_TOUGHNESS / 0x10000 && !blown; n++) {
      shoot(m, 0, w.x, w.y);
      for (let i = 0; i < 10 && !blown; i++) {
        stepMatch(m, []);
        blown = m.events.some((e) => e.type === 'wreckBlown');
      }
    }
    expect(blown).toBe(true);
    expect(w.model).toBe('remains');
    stepMatch(m, []);
    expect(m.events).toContainEqual(expect.objectContaining({ type: 'wreckMark', model: 'remains' }));
  });
});

describe('attack drones', () => {
  function camper(difficulty = 5): Match {
    const m = map(() => LAND, { ...TWO_BASES });
    const match = createMatch(buildWorld(m, DEFS), m, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 7, { difficulty });
    launch(match, 0, 'tank');
    // Out of the bunker tile and away from the edges, where the drone can come from any side.
    match.players[0]!.vehicle!.x = tileCentre(60);
    match.players[0]!.vehicle!.y = tileCentre(60);
    return match;
  }

  it('has a pool per side set by difficulty, or by the map, at most five', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => dronePool(d, null))).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3]);
    expect(dronePool(5, 4)).toBe(4);
    expect(dronePool(5, 9)).toBe(5);
  });

  it('comes after a vehicle that stays on one tile, 512 px off and 50 px up, as many as the pool allows', () => {
    const m = camper();
    for (let i = 0; i < CAMP_TICKS; i++) stepMatch(m, []);
    expect(m.drones).toHaveLength(0);
    stepMatch(m, []);
    stepMatch(m, []);
    expect(m.drones).toHaveLength(1);
    const d = m.drones[0]!;
    const tank = m.players[0]!.vehicle!;
    expect(d.z).toBe(DRONE_HEIGHT);
    expect(Math.max(Math.abs(d.x - tank.x), Math.abs(d.y - tank.y))).toBeGreaterThan(DRONE_SPAWN - 4 * PX);
    for (let i = 0; i < CAMP_TICKS * 2; i++) stepMatch(m, []);
    expect(m.drones).toHaveLength(1);
  });

  it('leaves a moving vehicle alone, and does not come at all on the easy levels', () => {
    const m = camper();
    for (let i = 0; i < CAMP_TICKS * 3; i++) stepMatch(m, [{ throttle: 1, turn: 1 }]);
    // Circling crosses tiles often enough to keep the clock from running out.
    expect(m.events.some((e) => e.type === 'droneLaunched')).toBe(false);
    const easy = camper(3);
    for (let i = 0; i < CAMP_TICKS * 3; i++) stepMatch(easy, []);
    expect(easy.drones).toHaveLength(0);
  });

  it('flies to its target and shoots it', () => {
    const m = camper();
    const tank = m.players[0]!.vehicle!;
    const health = tank.health;
    for (let i = 0; i < 2000 && tank.health === health; i++) stepMatch(m, []);
    expect(tank.health).toBeLessThan(health);
    const d = m.drones[0]!;
    expect(distance(d.x - tank.x, d.y - tank.y)).toBeLessThan(100 * PX);
  });

  it('comes down to an air shot of 1.0 or more', () => {
    const m = camper();
    for (let i = 0; i < CAMP_TICKS + 2; i++) stepMatch(m, []);
    const d = m.drones[0]!;
    const shot = fireProjectile(4, 1, 1, [d.x, d.y + 20 * PX, d.z], [0, 0, 0], 0, 0);
    m.projectiles.push(shot);
    let down = false;
    for (let i = 0; i < 10 && !down; i++) {
      stepMatch(m, []);
      down = m.events.some((e) => e.type === 'droneDown');
    }
    expect(down).toBe(true);
    expect(m.drones).toHaveLength(0);
  });

  it('flies off once its target has gone, and is gone a second after nobody can see it', () => {
    const m = camper();
    for (let i = 0; i < CAMP_TICKS + 2; i++) stepMatch(m, []);
    const d = m.drones[0]!;
    m.players[0]!.vehicle = null;
    m.players[0]!.state = 'bunker';
    stepMatch(m, []);
    expect(d.target).toBeNull();
    for (let i = 0; i < DRONE_UNSEEN + 1; i++) stepMatch(m, []);
    expect(m.drones).toHaveLength(0);
  });
});

describe('scenery offsets', () => {
  it('draws with the C runtime\'s rand()', () => {
    const r = new MsvcRand(1);
    expect([r.rand(), r.rand(), r.rand()]).toEqual([41, 18467, 6334]);
  });

  it('places scenery within 12 px of its tile centre, the same way every time', () => {
    const a = sceneryOffsets(71459);
    expect(Math.max(...a)).toBeLessThanOrEqual(12);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-12);
    expect(sceneryOffsets(71459)).toEqual(a);
    expect(sceneryOffsets(1)).not.toEqual(a);
    // The fourth draw of each entry, which sub_42e4c0 reads by tile index rather than by x and y modulo 16.
    expect(sceneryEntry(0x1ff)).toBe(255);
    expect(sceneryEntry(130)).toBe(66);
    expect(sceneryVariety(71459)).toEqual(sceneryVariety(71459));
    expect(Math.max(...sceneryVariety(71459))).toBeGreaterThan(200);
  });
});

describe('destroyed buildings\' explosions', () => {
  // The wall and gate explosion (0x443e10) as the original has it, and a bush's (0x443b90) and its crush (0x4451b8),
  // cut down to their map ops.
  const WALL_SCRIPT = {
    duration: 27 << 16, rate: 0x4000, script: [
      ['wait', 11], ['neighbour', -1, 0, 54, 56], ['neighbour', 1, 0, 55, 56], ['neighbour', -1, 0, 46, 55], ['neighbour', 1, 0, 46, 54],
      ['corner', -1, 0, 88], ['corner', 1, 0, 88], ['tile'],
    ],
  } as const;
  const BUSH_SCRIPT = { duration: 24 << 16, rate: 0x4000, script: [['debris', 6], ['rubble', 40], ['wait', 3], ['model', 'x']] } as const;
  const CRUSH_SCRIPT = { duration: 2 << 16, rate: 0x5555, script: [['wait', 1], ['debris', 7], ['tile']] } as const;
  const table = fakeTable();
  const wall = (name: string) => ({ name, raw: [0, 2, 0x563, 0, 0, 0, 0, 0, 0, 0, 107, 0, 0], explosion: 'wall' });
  table[1] = { ...table[1]!, explosion: 'bush', crushExplosion: 'crush' };
  table[87] = { name: 'DEST_BUSH_1', raw: [0, 0, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  table[43] = { ...table[43]!, explosion: 'wall' };
  table[66] = { name: 'DEST_GATE_H', raw: [0, 0, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  table[46] = wall('WALL_H');
  table[54] = wall('LDMG_WALL_H');
  table[55] = wall('RDMG_WALL_H');
  table[56] = wall('BDMG_WALL_H');
  const defs = buildingDefs(table, { wall: WALL_SCRIPT, bush: BUSH_SCRIPT, crush: CRUSH_SCRIPT } as never);
  const at = (x: number) => 20 * GRID + x;

  function setup(objects: RfwMap['objects']): Match {
    const m = map(() => LAND, { ...TWO_BASES, objects });
    return createMatch(buildWorld(m, defs), m, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
  }
  const run = (m: Match, ticks: number) => {
    for (let i = 0; i < ticks; i++) stepMatch(m, []);
  };

  it('leaves a destroyed wall standing until its explosion breaks it and the walls beside it', () => {
    const m = setup([10, 11, 12, 13, 14].map((x) => ({ type: x === 10 ? 'GATE_H' : 'WALL_H', x, y: 20, base: 0 })));
    const w = m.world;
    hitBuilding(m, at(12), 0xff0000);
    expect(w.building[at(12)]).toBe(46);
    expect(w.hp[at(12)]).toBe(0);
    run(m, 39);
    expect(w.building[at(12)]).toBe(46);
    run(m, 1);
    expect(w.building[at(12)]).toBe(0);
    expect([107, 108]).toContain(w.terrain[at(12)]);
    expect([w.building[at(11)], w.building[at(13)]]).toEqual([55, 54]);
    // The wall beside the gate brings the gate down with it, which breaks in turn.
    hitBuilding(m, at(11), 0xff0000);
    run(m, 40);
    expect(w.building[at(11)]).toBe(0);
    expect(w.hp[at(10)]).toBe(0);
    expect(w.building[at(10)]).toBe(43);
    run(m, 40);
    expect(w.building[at(10)]).toBe(66);
  });

  it('takes a shot bush away at once and leaves its stump later, but crushes one straight to its stump', () => {
    const m = setup([{ type: 'BUSH_1S', x: 12, y: 20, base: null }, { type: 'BUSH_1S', x: 14, y: 20, base: null }]);
    const w = m.world;
    hitBuilding(m, at(12), 0xff0000);
    expect(w.building[at(12)]).toBe(0);
    run(m, 39);
    expect(w.building[at(12)]).toBe(0);
    run(m, 1);
    expect(w.building[at(12)]).toBe(87);
    expect(damageBuilding(w, at(14), 0x640000, m.rng, true)).toBe(true);
    expect(w.building[at(14)]).toBe(1);
  });
});

describe('submarine', () => {
  it('comes for a helicopter that strays off the map, surfaces and sinks it with a homing missile', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'heli');
    const h = m.players[0]!.vehicle!;
    for (let i = 0; i < 1000 && busy(h); i++) stepMatch(m, []);
    // Hanging 40 px off the west edge: past the 32 px that brings the submarine out.
    h.x = -40 * ONE;
    const t0 = m.tick;
    stepMatch(m, []);
    expect(m.sub).not.toBeNull();
    let fired = -1;
    let lost = -1;
    for (let t = 0; t < 1200 && lost < 0; t++) {
      stepMatch(m, []);
      if (fired < 0 && m.projectiles.some((p) => p.kind === DEATH_MISSILE)) fired = m.tick - t0;
      if (m.events.some((e) => e.type === 'destroyed' && e.player === 0)) lost = m.tick - t0;
    }
    // 240 ticks hunting, 100 rising to frame 20 at 0x3333 a tick, then 180 before it fires.
    expect(fired).toBeGreaterThan(240 + 100 + 180 - 5);
    expect(fired).toBeLessThan(240 + 100 + 180 + 5);
    expect(lost).toBeGreaterThan(fired);
  });

  it('dives and goes once nothing is off the map', () => {
    const m = twoPlayerMatch();
    launch(m, 0, 'heli');
    const h = m.players[0]!.vehicle!;
    for (let i = 0; i < 1000 && busy(h); i++) stepMatch(m, []);
    h.x = -40 * ONE;
    for (let t = 0; t < 300; t++) stepMatch(m, []);
    expect(m.sub?.state).toBe('surface');
    h.x = 10 * TILE_SIZE;
    for (let t = 0; t < 300 && m.sub; t++) stepMatch(m, []);
    expect(m.sub).toBeNull();
    expect(m.projectiles.some((p) => p.kind === DEATH_MISSILE)).toBe(false);
  });
});
