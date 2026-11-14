// Explosions, debris, smoke, splashes and wrecks. These follow the match's events and never touch the simulation.
//
// Explosions are the original's (the Expl class, VA 0x44bb70), from effects.json: each runs its definition's
// script once a tick (sub_42dbe0) and draws its faces for the current frame (sub_42dd90). Which explosion goes with
// which event follows the code that makes them. A destroyed building's explosion breaks its model
// into flying pieces (debris.ts). The match runs the same scripts for the map changes they make (@rfw/sim
// explosions.ts).

import {
  GRID, Rng, VEHICLE_KINDS, startScript, stepScript, terrainAt, type Match, type MatchEvent, type ScriptState, type Shot, type Vehicle,
  type VehicleKind,
} from '@rfw/sim';
import type { EffectsData, ExplosionDef, ExplosionOp, GameAssets, Model } from './assets.js';
import { Debris } from './debris.js';
import { artSide, paintOf } from './paint.js';

export interface Billboard {
  /** World position in pixels, z up. */
  x: number;
  y: number;
  z: number;
  cel: number;
}

/**
 * A mark left on the ground (the class at 0x4438e0, made by sub_40ad10). It lasts at least 60 ticks; after that its
 * draw (sub_40aca0) removes it instead of drawing it once no view has drawn it for longer than its grace: 120 ticks
 * for a man's splat, 720 for a wreck's mark. So a mark stays for as long as someone keeps it on screen.
 */
export interface Mark {
  x: number;
  y: number;
  variant: number;
  /** Bases 3 and 4 repaint the side's cels (paint.ts). */
  paint: number;
  /** Tick from which it may go (+0x64). */
  until: number;
  /** How long it may go undrawn (+0x6c). */
  grace: number;
  /** Tick it was last drawn (+0x68). */
  seen: number;
  gone?: boolean;
}

/** Whether a view draws the mark this tick, as sub_40aca0 decides; one that has gone is dropped next tick. */
export function drawMark(mark: Mark, tick: number): boolean {
  if (mark.gone) return false;
  if (mark.seen !== tick && tick >= mark.until && tick > mark.seen + mark.grace) {
    mark.gone = true;
    return false;
  }
  mark.seen = tick;
  return true;
}

export interface Wreck extends Mark {
  kind: VehicleKind;
  heading: number;
}

/** What a man run over or shot leaves on land: splat cel 806 plus variant, lying flat. */
export type Splat = Mark;

/** An explosion's model to draw this tick, at a world point in pixels. lift raises its draw-order point. */
export interface Blast {
  model: Model;
  x: number;
  y: number;
  z: number;
  lift: number;
  /** Turn about the up axis, sim heading units (debris pieces spin). */
  heading?: number;
}

/**
 * One explosion object. Its clock is 16.16, the frame being the whole part; its variant picks among face variants
 * and script branches (the object's +0x8; inferred to vary from one to the next).
 */
interface Explosion extends ScriptState {
  def: ExplosionDef;
  x: number;
  y: number;
  z: number;
  /** A model the script is showing instead of the faces (+0x3c), or null. */
  model: string | null;
  /** For a destroyed building's explosion: the building, and its owner's colour variant and paint, for its debris. */
  building?: number;
  owner?: number;
  paint?: number;
  /** Turn about the up axis and tilt (+0x4c, +0x57), sim heading units. */
  heading: number;
  pitch: number;
  /** A muzzle flash rides on the vehicle that fired until its script detaches it (sub_42daf0, op 16). */
  rider?: { vehicle: Vehicle; turret: boolean; offset: [number, number, number] };
}

/** Buildings with no owner draw their owner-coloured faces in the neutral colours (view.ts). */
const NEUTRAL_VARIANT = 2;

/** Random rolls for the scripts' chance and pick ops and the debris. Only looks: the match rolls its own for the map's changes. */
const looks = new Rng(0x5eed);

/** The bridge buildings the loader lays between bridge ends (sub_414130). */
const BRIDGE_H = 74;
const BRIDGE_V = 75;

/** Shot types fired from guns, which use the first of the projectile table's explosion lists. */
const GUN_SHOTS: ReadonlySet<number> = new Set([0, 3, 5, 7, 11]);
/** Ground of terrain 73-83 takes the third explosion in a shot's list (sub_414b10). */
const ROUGH = [73, 83] as const;

/** A mark's least life, and how long a man's splat may go undrawn (sub_433c60, sub_433ce0). */
const MARK_TICKS = 60;
const SPLAT_GRACE = 120;

export class Effects {
  private blasts: Explosion[] = [];
  private wrecks: Wreck[] = [];
  private splats: Splat[] = [];
  private made = 0;
  private readonly data: EffectsData | null;
  private readonly buildings: readonly (string | null)[];
  private readonly crushed: readonly (string | null)[];
  private readonly pieces: GameAssets['debris'];
  private readonly debris: Debris | null;
  /** Sounds the scripts played this tick: index into the original's sound table, and where (pixels). */
  private sounds: { sound: number; x: number; y: number }[] = [];

  constructor(assets?: Pick<GameAssets, 'effects' | 'explosions' | 'crushExplosions' | 'debris' | 'cel'>) {
    this.data = assets?.effects ?? null;
    this.buildings = assets?.explosions ?? [];
    this.crushed = assets?.crushExplosions ?? [];
    this.pieces = assets?.debris ?? [];
    this.debris = this.data && assets ? new Debris(this.data, (i) => assets.cel(i), looks, (k, x, y) => this.explode(k, x, y, 0)) : null;
  }

  /** Runs the debris and explosions for a tick, then starts the effects for the tick's events. */
  add(events: readonly MatchEvent[], m: Match): void {
    this.debris?.step(m.world);
    this.blasts = this.blasts.filter((e) => stepScript(e, e.def, (op) => this.act(e, op), looks));
    for (const e of this.blasts) if (e.rider) ride(e);
    if (this.data) this.addExplosions(events, m, this.data);
    for (const e of events) {
      switch (e.type) {
        case 'wreckMark':
          this.wrecks.push({
            kind: e.kind, x: e.x / 65536, y: e.y / 65536, heading: e.heading, variant: artSide(e.base), paint: paintOf(e.base), until: m.tick + MARK_TICKS,
            grace: e.ticks, seen: m.tick,
          });
          break;
        case 'soldierKilled':
          // In water a man leaves nothing, only his cry (sub_433c60).
          // The sim's variant holds the man's side (base & 1); bases 3 and 4 draw Brown's splat repainted.
          if (!e.water) {
            const variant = e.variant - (e.base & 1) + artSide(e.base);
            this.splats.push({ x: e.x / 65536, y: e.y / 65536, variant, paint: paintOf(e.base), until: m.tick + MARK_TICKS, grace: SPLAT_GRACE, seen: m.tick });
          }
          break;
      }
    }
  }

  /** Starts an explosion by its key at a point (16.16), for a scene with no match events (the win scene). */
  burst(key: string, x: number, y: number, z: number): void {
    this.explode(key, x, y, z);
  }

  /** Starts an explosion (sub_42e080): its first think sets the clock to 1.0 (sub_42dbe0). */
  private explode(key: string | null | undefined, x: number, y: number, z: number, building?: { id: number; owner: number; paint: number }): Explosion | null {
    const def = key ? this.data?.defs[key] : undefined;
    if (!def) return null;
    const e: Explosion = {
      def, x: x / 65536, y: y / 65536, z: Math.max(0, z) / 65536, t: 0, ops: def.script, pc: 0, model: null, variant: this.made++,
      building: building?.id, owner: building?.owner, paint: building?.paint, heading: 0, pitch: 0,
    };
    startScript(e, (op) => this.act(e, op), looks);
    this.blasts.push(e);
    return e;
  }

  /**
   * A muzzle flash (sub_42e0b0): an explosion at the muzzle, tilted by the shot's pitch, riding on the vehicle at
   * that point on it, turned with it (and with the tank's turret).
   */
  private muzzle(m: Match, e: Extract<MatchEvent, { type: 'fired' }>, d: EffectsData): void {
    const v = e.player === undefined ? undefined : m.players[e.player]?.vehicle;
    const kind = e.shot === 0 ? 'tank' : e.shot === 8 || e.shot === 9 ? 'asv' : e.shot === 6 ? 'heli' : null;
    if (!v || !kind || v.kind !== kind) return;
    const x = this.explode(d.muzzle?.[kind], e.x, e.y, e.z ?? 0);
    if (!x) return;
    const turret = kind === 'tank';
    const a = -radians(turret ? v.heading + v.turret : v.heading);
    const dx = (e.x - v.x) / 65536;
    const dy = (e.y - v.y) / 65536;
    x.rider = { vehicle: v, turret, offset: [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a), ((e.z ?? 0) - v.z) / 65536] };
    x.pitch = ((e.pitch ?? 0) >>> 16 & 63) << 16;
    ride(x);
  }

  /**
   * The script ops that change what an explosion shows, and its debris (sub_42d790): the destroyed building's
   * model, or one the script names, broken up from the explosion's point; and its sounds (sub_42d360).
   */
  private act(e: Explosion, op: ExplosionOp): void {
    switch (op[0]) {
      case 'sound':
        this.sounds.push({ sound: op[1] as number, x: e.x, y: e.y });
        break;
      case 'model':
        e.model = op[1] as string;
        break;
      case 'own':
        e.model = null;
        break;
      case 'detach':
        e.rider = undefined;
        break;
      case 'debris': {
        const pieces = op[2] ? this.data?.pieces?.[op[2] as string] : e.building ? this.pieces[e.building] : undefined;
        if (pieces) this.debris?.throw(pieces, op[1] as unknown as (string | null)[], e.x * 65536, e.y * 65536, e.z * 65536, e.owner ?? 0, { paint: e.paint });
        break;
      }
    }
  }

  private addExplosions(events: readonly MatchEvent[], m: Match, d: EffectsData): void {
    for (const e of events) {
      switch (e.type) {
        case 'fired':
          this.muzzle(m, e, d);
          break;
        case 'hit':
          this.explode(hitExplosion(d, m, e.shot, e.target, e.x, e.y), e.x, e.y, e.z ?? 0);
          break;
        case 'smoke': {
          // sub_415100: up to 3 px off on each axis and 5 px up, running at a random rate from 0x2aaa.
          const r = (n: number) => Math.floor(Math.random() * n);
          const puff = this.explode(d.smoke, e.x + (r(4) << 16), e.y + (r(4) << 16), e.z + 0x50000);
          if (puff) puff.def = { ...puff.def, rate: r(0x1555) + 0x2aaa };
          break;
        }
        case 'droneDown': {
          this.explode(d.drone, e.x, e.y, e.z);
          const vd = d.vehicleDebris;
          const pieces = vd?.pieces.drone[(e.heading >> 19) & 7];
          if (vd && pieces) this.debris?.throw(pieces, vd.air, e.x, e.y, e.z, artSide(e.side), { heading: e.heading, drift: [e.vx, e.vy], paint: paintOf(e.side) });
          break;
        }
        case 'destroyed':
          // Driven into deep water: the splash and the patch it leaves (sub_40c8f0). Out of fuel: no explosion.
          if (e.drowned) {
            this.explode(d.splash, e.x, e.y, 0);
            this.explode(d.sunk, e.x, e.y, 0);
          } else if (!e.fuelOut) {
            this.explode(d.vehicles[VEHICLE_KINDS.indexOf(e.kind)], e.x, e.y, e.z);
          }
          break;
        case 'wreckBlown': {
          this.explode(d.vehicles[VEHICLE_KINDS.indexOf(e.kind)], e.x, e.y, e.z);
          // Only the helicopter's models have faces with debris kinds; low down it takes the ground programs.
          const vd = d.vehicleDebris;
          const set = e.kind !== 'heli' ? undefined : e.model === 'body' ? vd?.pieces.heli : e.model === 'wreck' ? vd?.pieces.heliWreck : undefined;
          const pieces = set?.[(e.heading >> 19) & 7];
          if (vd && pieces) {
            this.debris?.throw(pieces, e.z < 0xa0001 ? vd.ground : vd.air, e.x, e.y, e.z, artSide(e.base), { heading: e.heading, forward: true, paint: paintOf(e.base) });
          }
          break;
        }
        case 'wreckSunk':
          this.explode(d.sunk, e.x, e.y, 0);
          break;
        case 'buildingDestroyed': {
          // From the tile's centre, moved by the scenery offsets for bushes and rocks (sub_42e6a0 calls the model's
          // +0x28, sub_4365c0).
          const tx = e.tile % GRID;
          const ty = Math.floor(e.tile / GRID);
          let x = tx * 32 + 16;
          let y = ty * 32 + 16;
          if (m.world.defs[e.building]?.jitter) {
            const k = ((ty & 15) << 4) + (tx & 15);
            x += m.world.scenery[k * 2]!;
            y += m.world.scenery[k * 2 + 1]!;
          }
          if (e.building === BRIDGE_H || e.building === BRIDGE_V) this.planks(e.tile, e.building === BRIDGE_V, d);
          const owner = m.world.owner[e.tile]!;
          this.explode((e.crushed ? this.crushed[e.building] : null) ?? this.buildings[e.building], x * 65536, y * 65536, 0, {
            id: e.building, owner: owner < 0 ? NEUTRAL_VARIANT : artSide(owner), paint: owner < 0 ? 0 : paintOf(owner),
          });
          break;
        }
      }
    }
  }

  /**
   * A destroyed bridge's planks (its record's +0x1c, sub_436d50): 2 to 8 of them, from 16 px back along the bridge
   * and stepping along it by 4 px at a time, the steps shared out of 7 at random. Each is a quad 2 px wide lying
   * across the bridge, 8 to 19 px long somewhere in the 32 px of deck, thrown with its own drift: up to half a
   * pixel a tick either way across the ground and 0.23 to 1.4 px a tick up. Inferred: the original adds a quarter
   * of the destroying object's velocity when that object's class is 0; that object is not known here.
   */
  private planks(tile: number, vertical: boolean, d: EffectsData): void {
    const plank = d.bridgePlank;
    if (!plank?.program || !this.debris) return;
    const along = vertical ? 1 : 0;
    const pos = [(tile % GRID) * 0x200000 + 0x100000, Math.floor(tile / GRID) * 0x200000 + 0x100000];
    pos[along]! -= 0x100000;
    let n = looks.below(3) + 2 + looks.below(5);
    let left = 7;
    while (n > 0) {
      n--;
      const step = left - n < 0 ? 0 : looks.below(left - n) + 1;
      left -= step;
      pos[along]! += step * 0x40000;
      const len = looks.below(12) * 0x10000 + 0x80000;
      const from = (looks.below(32 - (len >> 16)) - 16) * 0x10000;
      // Corners (0x454f08 for a vertical bridge's, 0x454f38 for a horizontal one's), across then along.
      const corner = (a: number, b: number): [number, number, number] => (vertical ? [a, b, 0] : [b, a, 0]);
      const v = [corner(from, 0x10000), corner(from + len, 0x10000), corner(from + len, -0x10000), corner(from, -0x10000)];
      const sign = () => (looks.below(2) ? -1 : 1);
      const vx = (looks.below(0x4000) + looks.below(0x4000)) * sign();
      const vy = (looks.below(0x4000) + looks.below(0x4000)) * sign();
      const vz = looks.below(0x1eb8) * 10 + 0x3ae1;
      this.debris.throw([{ cel: plank.cel, add: false, kind: 1, offset: [0, 0, 0], v }], [plank.program], pos[0]!, pos[1]!, 0, 0, { drift: [vx, vy, vz] });
    }
  }

  /** The sounds the explosion scripts played since the last call. */
  takeSounds(): { sound: number; x: number; y: number }[] {
    return this.sounds.splice(0);
  }

  /** What to draw this tick, and the wrecks still lying around. Finished effects are dropped. */
  current(tick: number): { sprites: Billboard[]; blasts: Blast[]; wrecks: Wreck[]; splats: Splat[] } {
    this.wrecks = this.wrecks.filter((w) => !w.gone);
    this.splats = this.splats.filter((s) => !s.gone);
    const blasts: Blast[] = [];
    for (const e of this.blasts) {
      const model = e.model ? this.data?.models[e.model] : faces(e);
      if (model) blasts.push({ model: e.pitch ? tilt(model, e.pitch) : model, x: e.x, y: e.y, z: e.z, lift: e.def.lift / 65536, heading: e.heading });
    }
    for (const p of this.debris?.current() ?? []) blasts.push({ ...p, lift: 0 });
    return {
      splats: this.splats,
      sprites: [],
      blasts,
      wrecks: this.wrecks,
    };
  }
}

/**
 * The explosion for a shot's end (sub_414e20 with the projectile table's +0x34 list): guns use the first list,
 * everything else the second (grenades too, sub_4156f0). Mines have their own (sub_409d80).
 */
function hitExplosion(d: EffectsData, m: Match, shot: Shot, target: 'vehicle' | 'building' | 'ground' | 'water', x: number, y: number): string | null {
  if (shot === 'mine') return d.mine;
  const list = d.shots[typeof shot === 'number' && GUN_SHOTS.has(shot) ? 0 : 1]!;
  if (target === 'water') return list[1] ?? null;
  if (target === 'vehicle') return list[3] ?? null;
  if (target === 'building') return list[4] ?? null;
  const terrain = terrainAt(m.world, x >> 21, y >> 21) & 0x7f;
  return list[terrain >= ROUGH[0] && terrain <= ROUGH[1] ? 2 : 0] ?? null;
}

/** Keeps a riding explosion at its point on the vehicle, turned with it (sub_42daf0). */
function ride(e: Explosion): void {
  const r = e.rider!;
  const v = r.vehicle;
  e.heading = (r.turret ? v.heading + v.turret : v.heading) & 0x3fffff;
  const a = radians(e.heading);
  const [ox, oy, oz] = r.offset;
  e.x = v.x / 65536 + ox * Math.cos(a) - oy * Math.sin(a);
  e.y = v.y / 65536 + ox * Math.sin(a) + oy * Math.cos(a);
  e.z = Math.max(0, v.z / 65536 + oz);
}

function radians(heading: number): number {
  return (heading / 0x400000) * Math.PI * 2;
}

/** A model tilted about its across axis (0x481710), as shots are. */
function tilt(model: Model, pitch: number): Model {
  const a = radians(pitch);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { ...model, verts: model.verts.map(([x, y, z]): [number, number, number] => [x, y * c - z * s, y * s + z * c]) };
}

/**
 * The faces showing at the explosion's frame (sub_42dd90). A face with a pick of 2 or 3 starts a group of 4 or 8
 * of which the variant picks one; with 1 or 4 the variant's bit 0 or 1 swaps it for the next face. A face fades
 * out from its fade frame (sub_423060): 1 - (frame - fade + 1) / (last - fade + 2), in sixteenths, and is gone
 * below two.
 */
function faces(e: Explosion): Model | null {
  const { def } = e;
  const frame = (e.t << 8) >> 24;
  const s = def.scale / 65536;
  const sz = def.scaleZ ? s : 1;
  const out: Model['faces'] = [];
  for (let i = 0; i < def.faces.length;) {
    let f = def.faces[i]!;
    let next = i + 1;
    switch (f.pick) {
      case 1:
      case 4:
        if (e.variant & (f.pick === 1 ? 1 : 2)) {
          f = def.faces[i + 1] ?? f;
          next = i + 2;
        }
        break;
      case 2:
        f = def.faces[i + (e.variant & 3)] ?? f;
        next = i + 4;
        break;
      case 3:
        f = def.faces[i + (e.variant & 7)] ?? f;
        next = i + 8;
        break;
    }
    i = next;
    if (frame < f.first || frame > f.last) continue;
    let keep = 16;
    if (frame >= f.fade) {
      const level = 0x10000 - (frame - f.fade + 1) * Math.floor(0x10000 / (f.last - f.fade + 2));
      keep = (level >> 12) - 1;
      if (keep < 1) continue;
    }
    out.push({ cel: f.cel + frame - f.first, flags: 0, cull: [0, 0], v: f.v, keep });
  }
  if (!out.length) return null;
  return { verts: def.verts.map(([x, y, z]) => [x * s, y * s, z * sz]), faces: out };
}
