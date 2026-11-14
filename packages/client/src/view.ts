// Draws one player's view the way sub_408d60 does: ground rows far to near, then every object sorted back to
// front, with each quad model's faces in stored order behind the two-test cull (sub_41b2b0).

import { DOORS_OPEN, FINE_TURN, GATE_H, GRID, LIFT_SPEED, NO_TERRAIN, PROJECTILES, VEHICLES, mineArmed, mul, sceneryEntry, subFrame, type World, type Projectile, type Drone, type Gate, type Lift, type Match, type Soldier, type Vehicle } from '@rfw/sim';
import type { GameAssets, Model, ShotModel } from './assets.js';
import { BROKEN_BRIDGE, bridgeStub } from './bridges.js';
import type { Camera, Projected } from './camera.js';
import { type Billboard, type Blast, type Mark, type Splat, type Wreck, drawMark } from './effects.js';
import { type Frame, type Point, rgb } from './raster.js';
import { TEAMS, artSide, paintOf, paintedCel } from './paint.js';
import { buildingLook } from './variety.js';

const TILE = 32;
/** Before a map loads, every grid cell is water (sub_414130), so off-map tiles draw as water. */
const WATER_CEL = 2;
const SKY = rgb(0, 0, 0);
export const BASE_COLOURS = TEAMS.map((t) => t.colour);
/** Face flag bits from the models (render doc, "Buildings and vehicles are quad models"). */
const CULL_X = 1;
const CULL_Y = 2;
const ADD_VARIANT = 8;
/** Grid bits 14-15 hold the building variant: the owning team, or 2 for neutral. */
const NEUTRAL_VARIANT = 2;

interface Item {
  key: number;
  draw(): void;
}

/** Stand-in cels for shots when the shot models are missing (assets converted before they were exported). */
const SHOT_CEL = 1503;
const MISSILE_CEL = 1952;
const MISSILES: ReadonlySet<number> = new Set([2, 6, 8, 9, 10]);
/** Each projectile type's model (projectile table +0x2c, with its shadow model at +0x30); type 3 is never drawn. */
const SHOT_MODELS: readonly (ShotModel | null)[] = [
  'tracer', 'shell', 'missile', null, 'shell', 'shell', 'shell', 'tracer', 'missile', 'missile', 'big', 'tracer',
];

export function drawView(
  frame: Frame, cam: Camera, m: Match, assets: GameAssets, viewer: number,
  extras: { sprites: readonly Billboard[]; blasts?: readonly Blast[]; wrecks: readonly Wreck[]; splats: readonly Splat[] } = { sprites: [], wrecks: [], splats: [] },
): void {
  const v = cam.view;
  frame.setClip(v.x, v.y, v.w, v.h);
  frame.fill(SKY);
  cam.begin();
  const range = cam.groundRange();
  const ty0 = Math.floor(range.top / TILE) - 1;
  const ty1 = Math.floor(range.bottom / TILE) + 1;
  const tx0 = Math.floor((cam.centreX - range.halfWidth) / TILE);
  const tx1 = Math.floor((cam.centreX + range.halfWidth) / TILE);
  const world = m.world;
  const items: Item[] = [];

  const corner = (gx: number, gy: number) => cam.project(gx, gy, 0);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const inside = tx >= 0 && ty >= 0 && tx < GRID && ty < GRID;
      const i = ty * GRID + tx;
      const t = inside ? world.terrain[i]! : NO_TERRAIN;
      const cel = assets.cel(t === NO_TERRAIN ? WATER_CEL : t & 127);
      const a = corner(tx * TILE, ty * TILE);
      const b = corner(tx * TILE + TILE, ty * TILE);
      const c = corner(tx * TILE + TILE, ty * TILE + TILE);
      const d = corner(tx * TILE, ty * TILE + TILE);
      if (cel && a && b && c && d) frame.quad([a, b, c, d], cel, true, 0);
      if (!inside) continue;
      const bid = world.building[i]!;
      if (bid) {
        const owner = world.owner[i]!;
        const variant = owner < 0 ? NEUTRAL_VARIANT : artSide(owner);
        const paint = owner < 0 ? 0 : paintOf(owner);
        // A destroyed bridge draws a stub of the deck in place of its own (empty) model, from its lift (-40 px or 0).
        const stub = bid === BROKEN_BRIDGE ? assets.bridgeStubs[bridgeStub(world, i) ?? -1] : undefined;
        if (stub) queueModel(items, frame, cam, assets, stub, tx * TILE + TILE / 2, ty * TILE + TILE / 2, 0, 0, variant, paint);
        // Bushes, palms and rocks sit off the tile's centre by the map's scenery offsets (sub_4365c0).
        let ox = 0;
        let oy = 0;
        if (world.defs[bid]?.jitter) {
          const e = ((ty & 15) << 4) + (tx & 15);
          ox = world.scenery[e * 2]!;
          oy = world.scenery[e * 2 + 1]!;
        }
        const gun = TURRET_BUILDINGS.has(bid) ? m.turrets.find((t) => t.tile === i) ?? (world.hp[i] ? idleGun(world, i) : null) : undefined;
        const look = (model: Model, v: number) => buildingLook(world, i, bid, model, v);
        queueBuilding(items, frame, cam, assets, bid, tx * TILE + TILE / 2 + ox, ty * TILE + TILE / 2 + oy, variant, gun, undefined, look, paint);
      }
    }
  }

  for (const g of m.gates) queueGate(items, frame, cam, assets, m, g);

  // A mine blinks while it arms; once armed only the team that laid it can see it.
  const team = m.players[viewer]?.team;
  for (const mine of m.mines) {
    const lit = !mineArmed(mine) && mine.blink < mine.arm >> 16;
    if (mineArmed(mine) && mine.team !== team) continue;
    queueBox(items, frame, cam, mine.x / 65536, mine.y / 65536, 0.5, 1.5, 1.5, 0, lit ? rgb(220, 40, 30) : rgb(30, 30, 30), 1);
  }
  for (const f of m.flags) {
    if (!f.revealed || m.eliminated[f.base]) continue;
    const x = f.x / 65536;
    const y = f.y / 65536;
    queueBox(items, frame, cam, x, y, 0, 1, 1, 18, rgb(200, 200, 200), 0);
    queueBox(items, frame, cam, x + 4, y, 14, 5, 3, 0, BASE_COLOURS[f.base] ?? SKY, 0);
  }
  // Marks within the drawn tiles are drawn (and may go, see drawMark); the rest wait unseen.
  const shown = (k: Mark) => {
    const tx = Math.floor(k.x / TILE);
    const ty = Math.floor(k.y / TILE);
    return tx >= tx0 && tx <= tx1 && ty >= ty0 && ty <= ty1 && drawMark(k, m.tick);
  };
  for (const s of extras.splats) if (shown(s)) queueModel(items, frame, cam, assets, SPLAT, s.x, s.y, 0, 0, s.variant, s.paint);
  for (const s of m.soldiers) queueSoldier(items, frame, cam, assets, s);
  for (const p of m.players) if (p.vehicle) queueVehicle(items, frame, cam, assets, p.vehicle, m.tick);
  for (const l of m.lifts) queueLift(items, frame, cam, assets, m, l);
  // Wrecks still moving or standing (wrecks.ts): the body until it takes on its wreck model, or out of fuel; the
  // helicopter's wreck model is its falling wreck (0x440bd0; its body for assets converted before that was exported).
  for (const w of m.wrecks) {
    const parts = assets.vehicles[w.kind];
    const model = w.model === 'body' ? parts.body : w.model === 'wreck' && w.kind === 'heli' ? parts.falling ?? parts.body : parts.wreck;
    if (model) queueModel(items, frame, cam, assets, model, w.x / 65536, w.y / 65536, w.z / 65536, w.heading, artSide(w.base), paintOf(w.base));
  }
  for (const d of m.drones) queueDrone(items, frame, cam, assets, d, m.tick);
  const sub = m.sub ? subFrame(m.sub) : -1;
  if (m.sub && sub >= 0) queueModel(items, frame, cam, assets, SUB_MODEL, m.sub.x / 65536, m.sub.y / 65536, 0, 0, sub);
  for (const w of extras.wrecks) {
    if (!shown(w)) continue;
    const model = assets.vehicles[w.kind].wreck;
    if (model) queueModel(items, frame, cam, assets, model, w.x, w.y, 0, w.heading, w.variant, w.paint);
  }
  for (const p of m.projectiles) queueShot(items, frame, cam, assets, p);
  for (const g of m.grenades) queueBox(items, frame, cam, g.x / 65536, g.y / 65536, g.z / 65536, 1.5, 1.5, 0, rgb(90, 90, 60), 0);
  for (const s of extras.sprites) queueBillboard(items, frame, cam, assets, s);
  for (const b of extras.blasts ?? []) {
    // Sorted from its point lifted by the definition's +0x50, as the original adds it to the sort height.
    const p = cam.project(b.x, b.y, b.z + b.lift);
    if (p) items.push({ key: farness(p, p.x, cam), draw: () => drawModel(frame, cam, assets, b.model, b.x, b.y, b.z, b.heading ?? 0, 0) });
  }

  items.sort((a, b) => b.key - a.key);
  for (const it of items) it.draw();
}

/**
 * Draw-order key from sub_41afb0, as "how far back": larger draws first. Points further up the screen and
 * further from the camera are further back; objects near the view edges draw slightly earlier.
 */
function farness(p: Projected, screenX: number, cam: Camera): number {
  return -p.zc - p.yc / 256 + Math.abs(screenX - (cam.view.x + cam.view.w / 2)) / 512;
}

/** Heading in the sim's 16.16, 64-step units to radians. */
function radians(heading: number): number {
  return (heading / 65536 / 64) * Math.PI * 2;
}

/**
 * Draws a quad model the way sub_41b430 and sub_41b2b0 do: rotate the vertices by the heading, project them,
 * then emit faces either in the order listed for the heading's eighth of a turn (models with sectors) or in
 * stored order behind the two-test cull.
 */
function drawModel(
  frame: Frame, cam: Camera, assets: GameAssets, model: Model, ox: number, oy: number, oz: number, heading: number,
  variant: number, paint = 0, ground?: Ground,
): void {
  const a = radians(heading);
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const pts = model.verts.map(([x, y, z]) => cam.project(ox + x * cos - y * sin, oy + x * sin + y * cos, oz + z));
  const emit = (f: Model['faces'][number]) => {
    if (ground && f.v.every((k) => oz + model.verts[k]![2] >= 0) !== (ground === 'above')) return;
    const corners = f.v.map((k) => pts[k]);
    if (corners.some((c) => !c)) return;
    const index = f.cel + (f.flags & ADD_VARIANT ? variant : 0);
    // Bases 3 and 4 repaint the side's faces: those adding the variant, and soldiers' frames (paint.ts).
    const pair = f.pair ?? (f.flags & ADD_VARIANT ? 1 : 0);
    const cel = f.image ?? (paint && pair ? paintedCel(assets.cel, index, pair, paint) : assets.cel(index)) ?? assets.cel(f.cel);
    if (cel) frame.quad(corners as Point[], cel, false, undefined, f.keep);
  };
  if (model.sectors) {
    const order = model.sectors[((heading >>> 0) >> 19) & 7] ?? [];
    for (const i of order) {
      const f = model.faces[i];
      if (f) emit(f);
    }
    return;
  }
  for (const f of model.faces) {
    const t0 = pts[f.cull[0]];
    const t1 = pts[f.cull[1]];
    if (!t0 || !t1) continue;
    if (f.flags & CULL_X && t0.x > t1.x) continue;
    if (f.flags & CULL_Y && t0.y > t1.y) continue;
    emit(f);
  }
}

/** Which faces of a model on a lift to draw: those wholly above the ground, or the rest, seen down the shaft. */
type Ground = 'above' | 'below';

/** Draw-order key of a model at a point, taken from the point lifted by the model's word 8 (sub_41afb0). */
function modelKey(cam: Camera, model: Model, origin: Projected, x: number, y: number, z: number): number {
  const p = model.lift ? cam.project(x, y, z + model.lift) ?? origin : origin;
  return farness(p, p.x, cam);
}

/**
 * The submarine (sub.ts): its model (0x44ebd8, drawn by sub_434ab0) is one 128 x 64 px quad leaning back from the
 * camera, cel 630 plus its frame.
 */
const SUB_MODEL: Model = {
  lift: -40,
  verts: [[-64, -32, 16], [64, -32, 16], [64, 32, -16], [-64, 32, -16]],
  faces: [{ cel: 630, flags: ADD_VARIANT, cull: [0, 0], v: [0, 1, 2, 3] }],
};

function queueModel(
  items: Item[], frame: Frame, cam: Camera, assets: GameAssets, model: Model,
  ox: number, oy: number, oz: number, heading: number, variant: number, paint = 0,
): void {
  const origin = cam.project(ox, oy, oz);
  if (!origin) return;
  items.push({
    key: modelKey(cam, model, origin, ox, oy, oz),
    draw: () => drawModel(frame, cam, assets, model, ox, oy, oz, heading, variant, paint),
  });
}

/** Buildings whose head model is a gun (sub_41b4b0) that turns with the tower: TOWER and LARGE_TOWER. */
const TURRET_BUILDINGS = new Set([49, 50]);
/** A tower's gun before it wakes: the aim its tile's scenery entry holds (sub_42e180), as the sim wakes it with. */
function idleGun(world: World, i: number): { heading: number; pitch: number } {
  const e = sceneryEntry(i);
  return { heading: (world.variety[e]! & 0x3f) << 16, pitch: (world.scenery[e * 2]! & 0xff) << 14 };
}

/**
 * A building: every model of its chain, each its own draw object at the tile's point plus the model's offset
 * (sub_41afb0), so shadows, trunks and a tower's base draw beside the head model. A gun tower's head is its gun,
 * turned by the gun's pitch and then its heading (sub_42e180 hands them to sub_41b4b0); it is left out once the
 * tower has no hit points (gun null). bend reshapes each model first (a gate's leaves); look gives the head model and
 * variant the tile's draw callbacks pick (variety.ts), or null to leave it out. paint is the owner's (paint.ts).
 */
function queueBuilding(
  items: Item[], frame: Frame, cam: Camera, assets: GameAssets, bid: number, x: number, y: number, variant: number,
  gun?: { heading: number; pitch: number } | null, bend?: (model: Model) => Model,
  look?: (model: Model, variant: number) => { model: Model; variant: number } | null, paint = 0,
): void {
  const parts = assets.parts[bid] ?? [];
  parts.forEach((part, i) => {
    if (!part.model) return;
    let model = bend ? bend(part.model) : part.model;
    let shade = variant;
    if (look && i === 0) {
      const l = look(model, variant);
      if (!l) return;
      model = l.model;
      shade = l.variant;
    }
    let heading = 0;
    if (gun !== undefined && i === 0) {
      if (!gun) return;
      model = gun.pitch ? pitched(model, gun.pitch / 0x400000) : model;
      heading = gun.heading;
    }
    queueModel(items, frame, cam, assets, model, x + part.offset[0], y + part.offset[1], part.offset[2], heading, shade, paint);
  });
}

/** A model turned about its x axis by a fraction of a turn, as sub_41b4b0 pitches shots and tower guns. */
function pitched(model: Model, turns: number): Model {
  const a = turns * Math.PI * 2;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return { ...model, verts: model.verts.map(([vx, vy, vz]): [number, number, number] => [vx, vy * c - vz * sn, vy * sn + vz * c]) };
}

/**
 * A flying object's shadow (the Shadow class, VA 0x443078): sub_409bd0 keeps it on the ground away from its parent
 * by the parent's height, as if lit from behind the camera and to the left: right by z * 85 / 256 and up the map
 * by about half of z (the original's own masking is kept). Its sort height (+0x50) is the parent's less 1 px, so it
 * draws just before the parent. Positions are the sim's 16.16 values.
 */
function queueShadow(
  items: Item[], frame: Frame, cam: Camera, assets: GameAssets, model: Model,
  px: number, py: number, pz: number, parent: Projected | null, heading: number, variant: number, paint = 0,
): void {
  const x = (px + (pz >> 8) * 0x55) / 65536;
  const y = (py - ((pz & 0xffffff01) >> 1)) / 65536;
  const origin = cam.project(x, y, 0);
  if (!origin) return;
  items.push({
    key: parent ? farness(parent, parent.x, cam) + 1 / 1024 : farness(origin, origin.x, cam),
    draw: () => drawModel(frame, cam, assets, model, x, y, 0, heading, variant, paint),
  });
}

/** The gate leaf's free end: vertices 9, 10, 13 and 14 of both gate models. */
const GATE_LEAF = [9, 10, 13, 14];
/** The post's top face shows cel 0x35A instead of 0x359 while the gate is open. */
const GATE_OPEN_CEL = 0x35a;

/**
 * An open or closing gate, drawn as the gate models' own draw functions do (sub_42e240 and sub_42e2b0 for the two
 * halves of GATE_H, sub_42e320 and sub_42e390 for GATE_V): each leaf's free end is pulled back towards its post by
 * the whole pixels the gate has opened (the second half's ends sit on the negative side), and the post's top changes
 * cel.
 */
function queueGate(items: Item[], frame: Frame, cam: Camera, assets: GameAssets, m: Match, g: Gate): void {
  const axis = g.building === GATE_H ? 0 : 1;
  const open = g.opening >> 16;
  const bend = (model: Model): Model => {
    const verts = model.verts.map((v, i) => {
      if (!GATE_LEAF.includes(i)) return v;
      const out: [number, number, number] = [v[0], v[1], v[2]];
      out[axis] = Math.sign(v[axis]) * (16 - open);
      return out;
    });
    const last = model.faces.length - 1;
    const faces = open > 0 ? model.faces.map((f, i) => (i === last ? { ...f, cel: GATE_OPEN_CEL } : f)) : model.faces;
    return { ...model, verts, faces };
  };
  const tx = g.tile % GRID;
  const ty = Math.floor(g.tile / GRID);
  const owner = m.world.owner[g.tile]!;
  const variant = owner < 0 ? NEUTRAL_VARIANT : artSide(owner);
  queueBuilding(items, frame, cam, assets, g.building, tx * TILE + TILE / 2, ty * TILE + TILE / 2, variant, undefined, bend, undefined, owner < 0 ? 0 : paintOf(owner));
}

// Soldiers (models 0x44e928 and 0x44e9c0, drawn by sub_433950 and sub_433a10). On land a man is an upright quad
// leaning back from the camera with a slanted shadow quad, both picked from eight per-direction face pairs
// (0x44e4a8 for side 0, 0x44e6a8 for side 1), and the animation frame is added to the cel. Each direction has 20
// cels from 655: frames 0-9 for side 0, then 10-19 for side 1; the three left-facing directions mirror the
// right-facing ones. Swimming he is a flat quad turned with his heading, cels 756 on (25 more for side 1).
const MAN_VERTS: [number, number, number][] = [
  [-4, -1.5, 4.5], [4, -1.5, 4.5], [4, 1.5, 0], [-4, 1.5, 0], [0, -2.5, 0], [8, -2.5, 0], [4, 1.5, 0], [-4, 1.5, 0],
];
const MAN_SHADOW_CEL = 755;
/** Cel of frame 0 for side 0 in each direction, and whether the direction is mirrored. */
const MAN_DIRS: readonly (readonly [number, boolean])[] = [
  [655, false], [675, false], [695, false], [715, false], [735, false], [715, true], [695, true], [675, true],
];
const SWIM_CEL = 756;
const SWIM_SIDE = 25;
const SWIM_MODEL: Model = {
  verts: [[-4, -4, 0.5], [4, -4, 0.5], [4, 12, 0.5], [-4, 12, 0.5]],
  faces: [{ cel: SWIM_CEL, flags: ADD_VARIANT, cull: [0, 0], v: [3, 0, 1, 2], pair: SWIM_SIDE }],
};
/** The splat a man leaves on land (effect model 0x44ea58): a flat 8 px square, cels 806-811. */
const SPLAT: Model = {
  verts: [[-4, -4, 0], [4, -4, 0], [4, 4, 0], [-4, 4, 0]],
  faces: [{ cel: 806, flags: ADD_VARIANT, cull: [0, 0], v: [0, 1, 2, 3] }],
};
/** A man's frames for side 1 are 10 cels on from side 0's. */
const MAN_SIDE = 10;

function queueSoldier(items: Item[], frame: Frame, cam: Camera, assets: GameAssets, s: Soldier): void {
  const x = s.x / 65536;
  const y = s.y / 65536;
  const side = artSide(s.base);
  const paint = paintOf(s.base);
  const f = s.frame >> 16;
  if (s.water) {
    queueModel(items, frame, cam, assets, SWIM_MODEL, x, y, 0, s.heading, f + (side ? SWIM_SIDE : 0), paint);
    return;
  }
  const [base, mirror] = MAN_DIRS[(((s.heading + 0x40000) & 0x380000) >> 19)]!;
  const body: [number, number, number, number] = mirror ? [1, 0, 3, 2] : [0, 1, 2, 3];
  const shadow: [number, number, number, number] = mirror ? [5, 4, 7, 6] : [4, 5, 6, 7];
  const model: Model = {
    verts: MAN_VERTS,
    faces: [
      { cel: MAN_SHADOW_CEL, flags: 0, cull: [0, 0], v: shadow },
      { cel: base + side * MAN_SIDE + f, flags: 0, cull: [0, 0], v: body, pair: MAN_SIDE },
    ],
  };
  queueModel(items, frame, cam, assets, model, x, y, 0, 0, 0, paint);
}


/** The helicopter shadow's back corners (vertices 2 and 3, VA 0x440e0c and 0x440e18) and how far they pull in. */
const HELI_SHADOW_BACK = [2, 3];
const HELI_SHADOW_SQUEEZE = 0x120000;

/**
 * The helicopter's shadow (model 0x440ed8, drawn by sub_403760): while the engine winds up its back edge is pulled
 * forward by 18 px less the engine's share of 18 px, so the rotor's shadow grows as it starts. Once the rotor is
 * at full speed the draw function swaps the shadow to the plain model 0x440e90 for good, so it is only seen here
 * during the first spin-up.
 */
function heliShadow(model: Model, phase: string, engine: number): Model {
  if (phase !== 'spinup' || engine >= 0x10000) return model;
  const squeeze = (HELI_SHADOW_SQUEEZE - mul(engine, HELI_SHADOW_SQUEEZE)) / 65536;
  const verts = model.verts.map((v, i): [number, number, number] => (HELI_SHADOW_BACK.includes(i) ? [v[0], v[1] - squeeze, v[2]] : v));
  return { ...model, verts };
}

/**
 * A vehicle: its ground shadow, its body, and the tank's turret or the helicopter's rotor on top (sub_42eae0 and
 * the per-vehicle draw functions sub_402dc0, sub_402ec0, sub_402fc0, sub_403550). The face variant is the team.
 */
function queueVehicle(items: Item[], frame: Frame, cam: Camera, assets: GameAssets, v: Vehicle, tick: number): void {
  const x = v.x / 65536;
  const y = v.y / 65536;
  const parts = assets.vehicles[v.kind];
  // Ground vehicles sit lower as they sink in deep water; the helicopter climbs to 50 px.
  const z = v.z / 65536;
  const variant = artSide(v.base);
  const paint = paintOf(v.base);
  const shadow = v.heli && parts.shadow ? heliShadow(parts.shadow, v.heli.phase, v.heli.engine) : parts.shadow;
  const origin = cam.project(x, y, z);
  if (shadow && z > 0) queueShadow(items, frame, cam, assets, shadow, v.x, v.y, v.z, origin, v.heading, variant, paint);
  if (!origin) return;
  items.push({
    key: parts.body ? modelKey(cam, parts.body, origin, x, y, z) : farness(origin, origin.x, cam),
    draw: () => drawVehicle(frame, cam, assets, v, z, shadow && z === 0 && v.ground === 0 ? shadow : undefined),
  });
}

/** A vehicle's models at height z, on its shadow if it has one there; ground picks the faces on a lift. */
function drawVehicle(frame: Frame, cam: Camera, assets: GameAssets, v: Vehicle, z: number, shadow?: Model, ground?: Ground): void {
  const x = v.x / 65536;
  const y = v.y / 65536;
  const parts = assets.vehicles[v.kind];
  const variant = artSide(v.base);
  const paint = paintOf(v.base);
  if (shadow) drawModel(frame, cam, assets, shadow, x, y, z, v.heading, variant, paint, ground);
  if (parts.body) drawModel(frame, cam, assets, parts.body, x, y, z, v.heading, variant, paint, ground);
  if (parts.turret) drawModel(frame, cam, assets, parts.turret, x, y, z, (v.heading + v.turret) & 0x3fffff, variant, paint, ground);
  // The rotor turns by the helicopter's rotor angle (player record +0x80), which spins up before take-off.
  if (parts.rotor) drawModel(frame, cam, assets, parts.rotor, x, y, z, ((v.heli?.rotor ?? 0) + v.heading) & 0x3fffff, variant, paint, ground);
}

// The bunker lift on the map (sim lift.ts), drawn by the lift objects' draw functions: the shaft under the open
// tile (model 0x44dab0, sub_42ebb0), the platform with the vehicle on it (0x44d8f8, sub_42eae0) and the hatch
// doors sliding apart over it (0x44d890, sub_42ea10). Before the shaft the original copies the last cel it drew,
// and draws that again after the doors, so the open tile's hazard frame covers whatever of the lift would show
// past the hole; here the same is done by drawing the tile again over the lift, clipped to the tile.
const LIFT_SHAFT: Model = {
  verts: [
    [-14, -14, 0], [14, -14, 0], [14, 14, 0], [-14, 14, 0], [-14, -14, -31], [14, -14, -31], [14, 14, -31], [-14, 14, -31],
    [-16, -16, 0], [16, -16, 0], [16, -12, 0], [-16, -12, 0],
  ],
  faces: [
    { cel: 827, flags: CULL_Y, cull: [1, 5], v: [0, 1, 5, 4] },
    { cel: 828, flags: CULL_X, cull: [3, 7], v: [0, 3, 7, 4] },
    { cel: 826, flags: CULL_X, cull: [6, 2], v: [2, 1, 5, 6] },
    { cel: 826, flags: CULL_Y, cull: [7, 3], v: [2, 3, 7, 6] },
    { cel: 831, flags: 0, cull: [0, 0], v: [8, 9, 10, 11] },
  ],
};
const LIFT_PLATFORM: Model = {
  verts: [[-16, -15, 0], [16, -15, 0], [16, 15, 0], [-16, 15, 0]],
  faces: [{ cel: 829, flags: ADD_VARIANT, cull: [0, 0], v: [0, 1, 2, 3] }],
};
const DOOR_VERTS: [number, number, number][] = [[-8, -15, 0], [8, -15, 0], [8, 16, 0], [-8, 16, 0]];
const LIFT_DOORS: readonly Model[] = [822, 824].map((cel) => ({ verts: DOOR_VERTS, faces: [{ cel, flags: ADD_VARIANT, cull: [0, 0], v: [0, 1, 2, 3] }] }));
/** Each door's middle starts this far (5 px) from the tile's middle. */
const DOOR_GAP = 5;

function queueLift(items: Item[], frame: Frame, cam: Camera, assets: GameAssets, m: Match, l: Lift): void {
  if (l.phase === 'wait') return;
  const tx = l.tile % GRID;
  const ty = Math.floor(l.tile / GRID);
  const x = tx * TILE + TILE / 2;
  const y = ty * TILE + TILE / 2;
  const z = l.z / 65536;
  const v = l.vehicle;
  const origin = cam.project(x, y, 0);
  if (!origin) return;
  const body = assets.vehicles[v.kind].body;
  const variant = artSide(v.base);
  const shadow = assets.vehicles[v.kind].shadow;
  items.push({
    key: body ? modelKey(cam, body, origin, x, y, 0) : farness(origin, origin.x, cam),
    draw: () => {
      const corners = [cam.project(x - 16, y - 16, 0), cam.project(x + 16, y - 16, 0), cam.project(x + 16, y + 16, 0), cam.project(x - 16, y + 16, 0)];
      if (corners.some((c) => !c)) return;
      const pts = corners as Point[];
      const view = cam.view;
      const x0 = Math.max(view.x, Math.floor(Math.min(...pts.map((p) => p.x))));
      const x1 = Math.min(view.x + view.w, Math.ceil(Math.max(...pts.map((p) => p.x))));
      const y0 = Math.max(view.y, Math.floor(Math.min(...pts.map((p) => p.y))));
      const y1 = Math.min(view.y + view.h, Math.ceil(Math.max(...pts.map((p) => p.y))));
      if (x1 > x0 && y1 > y0) {
        frame.setClip(x0, y0, x1 - x0, y1 - y0);
        drawModel(frame, cam, assets, LIFT_SHAFT, x, y, 0, 0, variant);
        drawModel(frame, cam, assets, LIFT_PLATFORM, x, y, z, 0, variant);
        drawVehicle(frame, cam, assets, v, z, shadow, 'below');
        // The doors slide apart 0.3 px a tick of their timer, and are not drawn once 18 px apart.
        const open = l.doors * LIFT_SPEED;
        if (open < DOORS_OPEN) {
          const off = (open + DOOR_GAP * 65536) / 65536;
          drawModel(frame, cam, assets, LIFT_DOORS[0]!, x - off, y, 0, 0, variant);
          drawModel(frame, cam, assets, LIFT_DOORS[1]!, x + off, y, 0, 0, variant);
        }
        const tile = assets.cel(m.world.terrain[l.tile]! & 127);
        if (tile) frame.quad(pts, tile, false, 0);
        frame.setClip(view.x, view.y, view.w, view.h);
      }
      drawVehicle(frame, cam, assets, v, z, undefined, 'above');
    },
  });
}

// Attack drones (model 0x443740, drawn by sub_409ef0). Before drawing, the draw function turns the gun pod
// (vertices 0-7) by the pod's tilt and the rotor (vertices 42-47) to one of 16 positions, (frame + object id) & 15.
// The body's banking is left out. Its shadow is a 32 px square on the ground under it (model 0x4437f0).
const DRONE_POD = 8;
const DRONE_ROTOR = [42, 48] as const;

function queueDrone(items: Item[], frame: Frame, cam: Camera, assets: GameAssets, d: Drone, tick: number): void {
  const parts = assets.vehicles.drone;
  if (!parts?.body) return;
  const x = d.x / 65536;
  const y = d.y / 65536;
  const z = d.z / 65536;
  if (parts.shadow) queueShadow(items, frame, cam, assets, parts.shadow, d.x, d.y, d.z, cam.project(x, y, z), d.heading, 0);
  // The pod pitches about the model's x axis; the rotor spins about z.
  const tilt = ((d.pod << 10) >> 10) / 0x400000 * Math.PI * 2;
  const spin = (((tick + d.id) & 15) / 16) * Math.PI * 2;
  const pc = Math.cos(tilt);
  const ps = Math.sin(tilt);
  const rc = Math.cos(spin);
  const rs = Math.sin(spin);
  const verts = parts.body.verts.map((v, i): [number, number, number] => {
    if (i < DRONE_POD) return [v[0], v[1] * pc - v[2] * ps, v[1] * ps + v[2] * pc];
    if (i >= DRONE_ROTOR[0] && i < DRONE_ROTOR[1]) return [v[0] * rc - v[1] * rs, v[0] * rs + v[1] * rc, v[2]];
    return v;
  });
  queueModel(items, frame, cam, assets, { ...parts.body, verts }, x, y, z, d.heading, artSide(d.side), paintOf(d.side));
}

/**
 * A shot (the projectile class's draw, sub_41b4b0): its model turned by its pitch, then its heading, plus its
 * shadow object on the ground (sub_4148f0 gives every shot one, from the table's +0x30 model). The pitch is on the
 * heading circle, or the fine circle for fine types, which fly at a quarter of the angle they hold.
 * Inferred: the tracer's draw (sub_41b750) also tilts it towards the camera; it is drawn flat like the others, and
 * the missiles' trail face is drawn with frame 0.
 */
function queueShot(items: Item[], frame: Frame, cam: Camera, assets: GameAssets, p: Projectile): void {
  const kind = SHOT_MODELS[p.kind];
  const parts = kind ? assets.vehicles.shots?.[kind] : undefined;
  const x = p.x / 65536;
  const y = p.y / 65536;
  const z = p.z / 65536;
  if (!parts?.body) {
    if (kind) queueBillboard(items, frame, cam, assets, { x, y, z, cel: MISSILES.has(p.kind) ? MISSILE_CEL : SHOT_CEL });
    return;
  }
  const origin = cam.project(x, y, z);
  if (parts.shadow) queueShadow(items, frame, cam, assets, parts.shadow, p.x, p.y, p.z, origin, p.heading, 0);
  if (!origin) return;
  const body = parts.body;
  const model = p.pitch === 0 ? body : pitched(body, p.pitch / (PROJECTILES[p.kind]!.fine ? FINE_TURN : 0x400000));
  items.push({ key: modelKey(cam, body, origin, x, y, z), draw: () => drawModel(frame, cam, assets, model, x, y, z, p.heading, 0) });
}

/** A cel standing upright at a world point, centred on it and scaled with distance, like the effect sprites. */
function queueBillboard(items: Item[], frame: Frame, cam: Camera, assets: GameAssets, b: Billboard): void {
  const cel = assets.cel(b.cel);
  const p = cam.project(b.x, b.y, b.z);
  const q = cam.project(b.x + 1, b.y, b.z);
  if (!cel || !p || !q) return;
  const s = q.x - p.x;
  const hw = (cel.w * s) / 2;
  const hh = (cel.h * s) / 2;
  items.push({
    key: farness(p, p.x, cam) - 0.5,
    draw: () => frame.quad([{ x: p.x - hw, y: p.y - hh }, { x: p.x + hw, y: p.y - hh }, { x: p.x + hw, y: p.y + hh }, { x: p.x - hw, y: p.y + hh }], cel),
  });
}

/** An axis-aligned box standing on (x, y), drawn as its top face at height z + h, plus an optional shadow. */
function queueBox(
  items: Item[], frame: Frame, cam: Camera, x: number, y: number, z: number, hw: number, hd: number, h: number,
  colour: number, keyBias: number,
): void {
  const origin = cam.project(x, y, z);
  if (!origin) return;
  items.push({
    key: farness(origin, origin.x, cam) + keyBias,
    draw: () => {
      if (h > 0) {
        // A post: a thin quad standing up from the ground.
        const p = [cam.project(x - hw, y, z), cam.project(x + hw, y, z), cam.project(x + hw, y, z + h), cam.project(x - hw, y, z + h)];
        if (p.every((c) => c)) frame.solid(p as Point[], colour);
        return;
      }
      const p = [cam.project(x - hw, y - hd, z), cam.project(x + hw, y - hd, z), cam.project(x + hw, y + hd, z), cam.project(x - hw, y + hd, z)];
      if (p.every((c) => c)) frame.solid(p as Point[], colour);
    },
  });
}

/** Draws one building by itself, for the level editor's palette and its floating paste preview; owner -1 is neutral. */
export function drawBuilding(frame: Frame, cam: Camera, assets: GameAssets, bid: number, x: number, y: number, owner: number): void {
  const items: Item[] = [];
  queueBuilding(items, frame, cam, assets, bid, x, y, owner < 0 ? NEUTRAL_VARIANT : artSide(owner), undefined, undefined, undefined, owner < 0 ? 0 : paintOf(owner));
  items.sort((a, b) => b.key - a.key);
  for (const it of items) it.draw();
}
