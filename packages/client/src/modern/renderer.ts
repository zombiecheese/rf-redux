// The modern view (Options > Picture > Visuals: Modern): the same match drawn in 3D with WebGL at 1280 x 720, with
// toy-soldier models, lit by a low sun with soft shadows, over an animated sea. The camera stands exactly where the
// retro camera (camera.ts) projects from, with the same focal length, follow, lead and zoom, so both views show the
// same part of the map across; at 16:9 the modern one shows a little more up and down the map.
//
// It draws the playfield, and the bunker and skull screens as scenes of their own (modern/screens.ts); the HUD and
// text are modern/hud.ts. Nothing here touches the match.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DOORS_OPEN, FINE_TURN, type Elevator, type Lives, type SkullLook, GRID, LIFT_SPEED, PROJECTILES, VEHICLES, mineArmed, sceneryEntry, subFrame, type Match, type MatchEvent, type Vehicle, type VehicleKind, type World,
} from '@rfw/sim';
import type { GameAssets, Model } from '../assets.js';
import { FOCAL, type Camera } from '../camera.js';
import { drawMark, type Splat, type Wreck as MarkWreck } from '../effects.js';
import { TEAMS } from '../paint.js';
import { building, gateLeaf, lightOf, lookOf, towerGun, type Box } from './buildings.js';
import { Fx } from './fx.js';
import { LookPass, THERMAL, heatFragment } from './look.js';
import { BunkerScene, SkullScene } from './screens.js';
import { Ground, TILE } from './ground.js';
import { Kit, NEUTRAL, teamPaint, type TeamPaint } from './kit.js';
import * as V from './vehicles.js';
import { MODERN_H, MODERN_W, modernLayout, type ModernRect } from './layout.js';

export { MODERN_H, MODERN_W, modernLayout, type ModernRect };

const CHUNK = 8;
const CHUNKS = GRID / CHUNK;
const GATE_H = 43;
const TOWER = 49;
const LARGE_TOWER = 50;
const BROKEN_BRIDGE = 76;
const TURRET_BUILDINGS = new Set([TOWER, LARGE_TOWER]);
/** The sun: low in the south-west, behind and left of the camera, as the retro shadows fall. */
const SUN = new THREE.Vector3(-0.42, 1, 0.55).normalize();
const SHADOW_SPAN = 340;
const HEADLIGHTS = 6;
/** Building lights lit at night: the ones nearest what the views look at. */
const LAMPS = 8;

type Lamp = { x: number; y: number; z: number; power: number; colour: number };

/** A full-view screen drawn in a view instead of (or, for the skull, over) the playfield. */
export type ModernScreen =
  | { kind: 'bunker'; base: number; lives: Lives; selected: VehicleKind; elevator: Elevator | null; tick: number }
  | { kind: 'skull'; look: SkullLook; rival: number; base: number; lost: VehicleKind | null; left: number; start: number };

export interface ModernView {
  cam: Camera;
  rect: ModernRect;
  viewer: number;
  /** Leaves the playfield out of this view. */
  skip: boolean;
  screen?: ModernScreen;
}

const radians = (heading: number) => (heading / 65536 / 64) * Math.PI * 2;

interface VehicleRig {
  root: THREE.Group;
  body: THREE.Mesh;
  turret?: THREE.Group;
  barrel?: THREE.Group;
  rotor?: THREE.Group;
  tail?: THREE.Group;
  wheels: THREE.Group[];
  /** How far the jeep's tyres are blown up, 0 to 1, eased toward the vehicle's state. */
  inflate: number;
}

/** Objects of one kind reused frame to frame: take() hands out the next, end() hides the ones not taken. */
class Pool<T extends { visible: boolean }> {
  private readonly items: T[] = [];
  private used = 0;
  constructor(private readonly make: () => T) {}
  begin(): void {
    this.used = 0;
  }
  take(): T {
    let it = this.items[this.used];
    if (!it) {
      it = this.make();
      this.items.push(it);
    }
    this.used++;
    it.visible = true;
    return it;
  }
  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i]!.visible = false;
  }
  get all(): readonly T[] {
    return this.items;
  }
}

export class ModernRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04 });
  /** Vehicles, soldiers and drones: the same paint, but they run hot on the thermal camera. */
  private readonly hot = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04 });
  private readonly charred = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: 0x3a342e });
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  private world: World | null = null;
  private ground: Ground | null = null;
  private readonly chunks: (THREE.Mesh | null)[] = new Array(CHUNKS * CHUNKS).fill(null);
  private readonly chunkKeys: string[] = new Array(CHUNKS * CHUNKS).fill('');
  private readonly statics = new THREE.Group();
  private readonly dynamic = new THREE.Group();
  readonly fx = new Fx();
  private readonly paints: TeamPaint[] = TEAMS.map((t) => teamPaint(t.colour & 255, (t.colour >> 8) & 255, (t.colour >> 16) & 255));
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();
  private readonly pools = new Map<string, Pool<THREE.Object3D>>();
  private readonly rigs = new Map<Vehicle, VehicleRig>();
  private lastTime = performance.now();
  private readonly boxes: (Box | null)[];
  private bunker: BunkerScene | null = null;
  private night = false;
  private readonly sky = new THREE.HemisphereLight(0xcfe8ff, 0x8a6a48, 1.25);
  /** Headlights for the vehicles at night: a fixed few, so turning them on and off never rebuilds the shaders. */
  private readonly heads: THREE.SpotLight[] = [];
  private readonly lamps: THREE.PointLight[] = [];
  /** Each chunk's building lights, kept with its geometry. */
  private readonly chunkLamps: Lamp[][] = Array.from({ length: CHUNKS * CHUNKS }, () => []);
  /** How much windows and lamps glow: 0 by day, 1 at night. */
  private readonly glow = { value: 0 };
  private skull: SkullScene | null = null;
  /** The drone's feed over the picture (Options > Camera), and the thermal camera (I). */
  private feed = false;
  private thermal = false;
  private pass: LookPass | null = null;

  constructor(private readonly assets: GameAssets) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(1);
    this.gl.setSize(MODERN_W, MODERN_H, false);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.setScissorTest(true);
    this.canvas = document.createElement('canvas');
    this.canvas.width = MODERN_W;
    this.canvas.height = MODERN_H;

    this.scene.background = new THREE.Color(0x0c2a40);
    this.scene.add(this.sky);
    for (let i = 0; i < LAMPS; i++) {
      const l = new THREE.PointLight(0xffd090, 0, 150, 1.5);
      this.lamps.push(l);
      this.scene.add(l);
    }
    this.teach(this.material, 0);
    this.teach(this.hot, 1);
    this.teach(this.charred, 0.55);
    for (let i = 0; i < HEADLIGHTS; i++) {
      const l = new THREE.SpotLight(0xfff0c8, 0, 260, 0.5, 0.65, 1.2);
      this.heads.push(l);
      this.scene.add(l, l.target);
    }
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_SPAN;
    sc.right = SHADOW_SPAN;
    sc.top = SHADOW_SPAN;
    sc.bottom = -SHADOW_SPAN;
    sc.near = 10;
    sc.far = 1600;
    this.scene.add(this.sun, this.sun.target, this.statics, this.dynamic, this.fx.group);
    this.boxes = assets.parts.map((parts) => bodyBox(parts));
  }

  /**
   * Windows and lamp glass (the kits' glow attribute) shine warm at night; on the thermal camera the material shows
   * its heat instead of its lit colour.
   */
  private teach(material: THREE.Material, heat: number): void {
    // The closures read alike, so tell three.js each heat needs its own program.
    material.customProgramCacheKey = () => `heat:${heat}`;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.nightGlow = this.glow;
      shader.uniforms.thermal = THERMAL;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float glow;\nvarying float vGlow;\nvoid main() {\n  vGlow = glow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float nightGlow;\nuniform float thermal;\nvarying float vGlow;\nvoid main() {')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(1.0, 0.78, 0.42) * vGlow * nightGlow * 1.6;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${heatFragment(heat, true)}`);
    };
  }

  // ---- Events -------------------------------------------------------------------------------------------------

  /** The match's events of one tick, for the effects. */
  events(events: readonly MatchEvent[], m: Match): void {
    const px = (n: number) => n / 65536;
    for (const e of events) {
      switch (e.type) {
        case 'fired': {
          if (e.shot === 'mine' || e.shot === 'grenade') break;
          const big = typeof e.shot === 'number' && !!PROJECTILES[e.shot] && !PROJECTILES[e.shot]!.fine && e.shot !== 0 && e.shot !== 7 && e.shot !== 11;
          this.fx.muzzle(px(e.x), px(e.y), px(e.z ?? 0) + 6, big);
          break;
        }
        case 'hit': {
          const x = px(e.x);
          const y = px(e.y);
          const z = px(e.z ?? 0);
          const gun = typeof e.shot === 'number' && (e.shot === 0 || e.shot === 7 || e.shot === 11);
          if (e.target === 'water') this.fx.splash(x, y, !gun);
          else if (e.target === 'ground') {
            if (gun) this.fx.dirt(x, y);
            else this.fx.explosion(x, y, 0, 0.8, { scorch: true });
          } else this.fx.explosion(x, y, z, gun ? 0.35 : 0.9, { scorch: e.target === 'building' && !gun });
          break;
        }
        case 'destroyed': {
          const x = px(e.x);
          const y = px(e.y);
          const z = px(e.z);
          if (e.drowned) this.fx.splash(x, y, true);
          else if (!e.fuelOut) this.fx.explosion(x, y, z, 1.8, { scorch: z < 2, chunks: this.chunkColours(e.player >= 0 ? m.players[e.player]?.base ?? -1 : -1), smokeFor: 3 });
          break;
        }
        case 'wreckBlown':
          this.fx.explosion(px(e.x), px(e.y), px(e.z), 1.5, { scorch: true, chunks: this.chunkColours(e.base) });
          break;
        case 'wreckSunk':
          this.fx.splash(px(e.x), px(e.y), true);
          break;
        case 'buildingDestroyed': {
          if (e.crushed) {
            const x = (e.tile % GRID) * TILE + TILE / 2;
            const y = Math.floor(e.tile / GRID) * TILE + TILE / 2;
            this.fx.debris(x, y, 2, [new THREE.Color(0x4f9a3a), new THREE.Color(0x3b7a2c), new THREE.Color(0x7a5532)], 8, 0.6);
            break;
          }
          const x = (e.tile % GRID) * TILE + TILE / 2;
          const y = Math.floor(e.tile / GRID) * TILE + TILE / 2;
          const name = m.world.defs[e.building]?.name ?? '';
          const small = /BUSH|TREE|PALM|CACTUS|ROCK|TENT|PLANTER/i.test(name);
          this.fx.explosion(x, y, small ? 2 : 8, small ? 0.8 : 2.2, {
            scorch: true, smokeFor: small ? 0 : 6,
            chunks: small ? [new THREE.Color(0x4f9a3a), new THREE.Color(0x7a5532)] : [new THREE.Color(0xb4b2aa), new THREE.Color(0x8d8b84), new THREE.Color(0x6a5040), new THREE.Color(0xd9c7a3)],
          });
          break;
        }
        case 'tyres':
          this.fx.tyres(px(e.x), px(e.y));
          break;
        case 'resupply': {
          this.fx.sparkle(px(e.x), px(e.y), [0.5, 1, 0.55]);
          break;
        }
        case 'soldierKilled':
          if (e.water) this.fx.splash(px(e.x), px(e.y), false);
          else this.fx.dirt(px(e.x), px(e.y));
          break;
        case 'smoke':
          this.fx.smokeAt(px(e.x), px(e.y), px(e.z));
          break;
        case 'droneDown':
          this.fx.explosion(px(e.x), px(e.y), px(e.z), 1.1, { chunks: this.chunkColours(e.side) });
          break;
        default:
          break;
      }
    }
  }

  private chunkColours(base: number): THREE.Color[] {
    const p = this.paints[base] ?? NEUTRAL;
    return [new THREE.Color(p.main), new THREE.Color(p.dark), new THREE.Color(0x34363a), new THREE.Color(0x6c7178)];
  }

  // ---- Drawing ------------------------------------------------------------------------------------------------

  /**
   * Draws the match from each camera into its rectangle of the WebGL picture, and copies it to this.canvas.
   * viewer is the player whose team decides which mines show; skip leaves a view out (the bunker shows there).
   */
  draw(m: Match, views: readonly ModernView[], extras: { wrecks: readonly MarkWreck[]; splats: readonly Splat[] }): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (m.world !== this.world) this.setWorld(m.world);
    const ground = this.ground!;
    ground.update(m.world, m.lifts.filter((l) => l.phase !== 'wait').map((l) => l.tile));
    ground.tick(now / 1000);
    this.syncChunks(m.world);
    this.syncDynamic(m, extras, views.filter((v) => !v.skip).map((v) => v.cam), dt);
    this.aimHeadlights(m);
    this.lightBuildings(views);
    this.fx.step(dt);

    const ctx = this.canvas.getContext('2d')!;
    const at = (r: ModernRect) => {
      this.gl.setViewport(r.x, MODERN_H - r.y - r.h, r.w, r.h);
      this.gl.setScissor(r.x, MODERN_H - r.y - r.h, r.w, r.h);
    };
    // The map from each camera, then the drone's lens or the thermal camera over it, then the bunker and skull
    // screens, which are the player's own screens and not the feed.
    const field = views.filter((v) => !v.skip);
    for (const v of field) {
      at(v.rect);
      const team = m.players[v.viewer]?.team;
      for (const mine of this.mines) mine.visible = mine.userData.team === team || !mine.userData.armed;
      this.place(v.cam, v.rect);
      this.gl.render(this.scene, this.camera);
    }
    if (field.length && (this.feed || this.thermal)) (this.pass ??= new LookPass(MODERN_W, MODERN_H)).apply(this.gl, field.map((v) => v.rect), this.thermal, now / 1000);
    for (const v of views) {
      const r = v.rect;
      at(r);
      const sc = v.screen;
      if (sc?.kind === 'bunker') {
        const b = (this.bunker ??= new BunkerScene());
        b.setNight(this.night);
        b.frame(r.w / r.h);
        b.update(this.paints[sc.base] ?? NEUTRAL, sc.lives, sc.selected, sc.elevator, sc.tick);
        this.gl.render(b.scene, b.camera);
      } else if (sc?.kind === 'skull') {
        const k = (this.skull ??= new SkullScene());
        k.frame(r.w / r.h);
        k.update(sc.look, this.paints[sc.rival] ?? NEUTRAL, this.paints[sc.base] ?? NEUTRAL, sc.lost, sc.left, sc.start);
        // Over the map while it still shows: dim it, keep its picture and clear only the depth. Then on black.
        this.gl.autoClear = false;
        if (v.skip) {
          this.gl.setClearColor(0x000000, 1);
          this.gl.clear();
        } else this.gl.render(k.dim, k.camera);
        this.gl.clearDepth();
        this.gl.render(k.scene, k.camera);
        this.gl.autoClear = true;
      }
    }
    ctx.drawImage(this.gl.domElement, 0, 0);
  }

  /** Stands the camera where the retro camera projects from, framing the rectangle as the retro view frames its own. */
  private place(cam: Camera, rect: ModernRect): void {
    const pose = cam.pose();
    const view = cam.view;
    const k = rect.w / view.w;
    const f = FOCAL * k;
    const dist = FOCAL + pose.z;
    const s = Math.sin(pose.pitch);
    const c = Math.cos(pose.pitch);
    const c3 = this.camera;
    c3.position.set(pose.x, dist * s, pose.y + dist * c);
    c3.up.set(0, 1, 0);
    c3.lookAt(pose.x, 0, pose.y);
    const near = 8;
    const far = 4000;
    const cx = rect.w / 2 + view.dx * k;
    const cy = rect.h / 2 + view.dy * k;
    c3.near = near;
    c3.far = far;
    c3.projectionMatrix.makePerspective((-cx / f) * near, ((rect.w - cx) / f) * near, (cy / f) * near, (-(rect.h - cy) / f) * near, near, far);
    c3.projectionMatrixInverse.copy(c3.projectionMatrix).invert();
    c3.updateMatrixWorld();
    // Points are sized in game pixels: on screen a point's size is size * f / depth.
    this.fx.setScale(f);
    // The shadow box follows what this view looks at.
    this.sun.target.position.set(pose.x, 0, pose.y - 40);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN, 800);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * The camera's look: the drone's feed (or a clean picture), and the thermal camera, which shows heat instead of
   * light, so night hides nothing from it.
   */
  setLook(drone: boolean, thermal: boolean): void {
    this.feed = drone;
    if (thermal === this.thermal) return;
    this.thermal = thermal;
    THERMAL.value = thermal ? 1 : 0;
    this.background();
  }

  private background(): void {
    (this.scene.background as THREE.Color).setHex(this.thermal ? 0x1a1a1a : this.night ? 0x010205 : 0x0c2a40);
  }

  /** Day, or night: a faint moon for the sun, a black sky, dark water, and headlights on the vehicles. */
  setNight(night: boolean): void {
    if (night === this.night) return;
    this.night = night;
    this.sky.color.setHex(night ? 0x26345c : 0xcfe8ff);
    this.sky.groundColor.setHex(night ? 0x0a0806 : 0x8a6a48);
    this.sky.intensity = night ? 0.22 : 1.25;
    this.glow.value = night ? 1 : 0;
    this.sun.color.setHex(night ? 0x8ea4e8 : 0xfff2dc);
    this.sun.intensity = night ? 0.28 : 2.6;
    this.background();
    const w = this.ground?.water.uniforms;
    if (w) this.waterLight(w);
    this.bunker?.setNight(night);
  }

  private waterLight(u: Record<string, THREE.IUniform>): void {
    (u.tint!.value as THREE.Color).setRGB(this.night ? 0.1 : 1, this.night ? 0.13 : 1, this.night ? 0.2 : 1);
    (u.glint!.value as THREE.Color).setRGB(this.night ? 0.3 : 1, this.night ? 0.36 : 0.97, this.night ? 0.5 : 0.88);
  }

  /** At night, lights the buildings nearest what each view looks at (shared out between split-screen views). */
  private lightBuildings(views: readonly ModernView[]): void {
    let used = 0;
    if (this.night) {
      const field = views.filter((v) => !v.skip);
      const each = field.length ? Math.floor(LAMPS / field.length) : 0;
      const taken = new Set<Lamp>();
      for (const v of field) {
        const pose = v.cam.pose();
        const near: { lamp: Lamp; d: number }[] = [];
        const ccx = Math.floor(pose.x / TILE / CHUNK);
        const ccy = Math.floor(pose.y / TILE / CHUNK);
        for (let cy = Math.max(0, ccy - 1); cy <= Math.min(CHUNKS - 1, ccy + 1); cy++) {
          for (let cx = Math.max(0, ccx - 1); cx <= Math.min(CHUNKS - 1, ccx + 1); cx++) {
            for (const lamp of this.chunkLamps[cy * CHUNKS + cx]!) {
              if (!taken.has(lamp)) near.push({ lamp, d: (lamp.x - pose.x) ** 2 + (lamp.y - pose.y - 40) ** 2 });
            }
          }
        }
        near.sort((a, b) => a.d - b.d);
        for (const { lamp } of near.slice(0, each)) {
          const l = this.lamps[used++]!;
          taken.add(lamp);
          l.position.set(lamp.x, lamp.z, lamp.y);
          l.color.setHex(lamp.colour);
          l.intensity = lamp.power;
        }
      }
    }
    for (; used < LAMPS; used++) this.lamps[used]!.intensity = 0;
  }

  /** Points each vehicle's headlights (at night) ahead of it. */
  private aimHeadlights(m: Match): void {
    let i = 0;
    if (this.night) {
      for (const p of m.players) {
        const v = p.vehicle;
        if (!v || i >= HEADLIGHTS || v.z < -8 * 65536) continue;
        const a = radians(v.heading);
        const fx = Math.sin(a);
        const fz = -Math.cos(a);
        const x = v.x / 65536;
        const y = v.y / 65536;
        const z = Math.max(0, v.z / 65536);
        const l = this.heads[i++]!;
        l.intensity = v.kind === 'heli' ? 4500 : 2600;
        l.position.set(x + fx * 10, z + 10, y + fz * 10);
        l.target.position.set(x + fx * 90, 0, y + fz * 90);
        l.target.updateMatrixWorld();
      }
    }
    for (; i < HEADLIGHTS; i++) this.heads[i]!.intensity = 0;
  }

  /** A point of the bunker (its own units: across from the shaft, up from its top) on the modern screen in a view. */
  bunkerPoint(rect: ModernRect, x: number, y: number, z = 0): { x: number; y: number } {
    const b = (this.bunker ??= new BunkerScene());
    b.frame(rect.w / rect.h);
    const p = b.project(x, y, z);
    return { x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h };
  }

  /** Projects a world point (game pixels, z up) to the modern screen, for names over vehicles. */
  project(cam: Camera, rect: ModernRect, x: number, y: number, z: number): { x: number; y: number } | null {
    this.place(cam, rect);
    const p = new THREE.Vector3(x, z, y).project(this.camera);
    if (p.z > 1) return null;
    return { x: rect.x + ((p.x + 1) / 2) * rect.w, y: rect.y + ((1 - p.y) / 2) * rect.h };
  }

  private setWorld(world: World): void {
    this.world = world;
    if (this.ground) {
      this.statics.remove(this.ground.group);
      this.ground.dispose();
    }
    this.ground = new Ground(this.assets, world, SUN, this.gl.capabilities.maxTextureSize >= 8192);
    this.statics.add(this.ground.group);
    this.waterLight(this.ground.water.uniforms);
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (c) {
        this.statics.remove(c);
        c.geometry.dispose();
      }
      this.chunks[i] = null;
      this.chunkKeys[i] = '';
    }
    this.fx.clear();
    for (const rig of this.rigs.values()) this.dynamic.remove(rig.root);
    this.rigs.clear();
  }

  // ---- Buildings ----------------------------------------------------------------------------------------------

  private syncChunks(world: World): void {
    for (let cy = 0; cy < CHUNKS; cy++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        let key = '';
        for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
          for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
            const i = y * GRID + x;
            const b = world.building[i]!;
            if (b) key += `${i}:${b}:${world.owner[i]};`;
          }
        }
        const c = cy * CHUNKS + cx;
        if (key === this.chunkKeys[c]) continue;
        this.chunkKeys[c] = key;
        const old = this.chunks[c];
        if (old) {
          this.statics.remove(old);
          old.geometry.dispose();
          this.chunks[c] = null;
        }
        const geos: THREE.BufferGeometry[] = [];
        const lamps: Lamp[] = (this.chunkLamps[c] = []);
        for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
          for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
            const g = this.tileGeometry(world, y * GRID + x, lamps);
            if (g) geos.push(g);
          }
        }
        if (!geos.length) continue;
        const merged = mergeGeometries(geos, false);
        for (const g of geos) g.dispose();
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, this.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.chunks[c] = mesh;
        this.statics.add(mesh);
      }
    }
  }

  private tileGeometry(world: World, i: number, lamps: Lamp[]): THREE.BufferGeometry | null {
    const bid = world.building[i]!;
    if (!bid) return null;
    const def = world.defs[bid];
    if (!def) return null;
    const owner = world.owner[i]!;
    const tx = i % GRID;
    const ty = Math.floor(i / GRID);
    let ox = tx * TILE + TILE / 2;
    let oy = ty * TILE + TILE / 2;
    if (def.jitter) {
      const e = ((ty & 15) << 4) + (tx & 15);
      ox += world.scenery[e * 2]!;
      oy += world.scenery[e * 2 + 1]!;
    }
    let kit: Kit | null;
    if (bid === BROKEN_BRIDGE) kit = brokenBridge(world, i);
    else kit = building(def, def.name, this.boxes[bid] ?? null, i);
    if (!kit) return null;
    const lamp = bid === BROKEN_BRIDGE ? null : lightOf(def.name, this.boxes[bid] ?? null);
    if (lamp) lamps.push({ ...lamp, x: lamp.x + ox, y: lamp.y + oy });
    const g = kit.build(owner < 0 ? NEUTRAL : this.paints[owner] ?? NEUTRAL);
    g.translate(ox, 0, oy);
    return g;
  }

  // ---- Things that move ---------------------------------------------------------------------------------------

  private readonly mines: THREE.Object3D[] = [];

  private pool(key: string, make: () => THREE.Object3D): Pool<THREE.Object3D> {
    let p = this.pools.get(key);
    if (!p) {
      p = new Pool(() => {
        const o = make();
        this.dynamic.add(o);
        return o;
      });
      this.pools.set(key, p);
    }
    return p;
  }

  private geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = make();
      this.geoCache.set(key, g);
    }
    return g;
  }

  private mesh(key: string, make: () => Kit, team: TeamPaint, material: THREE.Material = this.material): THREE.Mesh {
    const m = new THREE.Mesh(this.geometry(key, () => make().build(team)), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  private syncDynamic(m: Match, extras: { wrecks: readonly MarkWreck[]; splats: readonly Splat[] }, cams: Camera[], dt: number): void {
    for (const p of this.pools.values()) p.begin();
    this.mines.length = 0;
    const seen = new Set<Vehicle>();

    for (const pl of m.players) if (pl.vehicle) this.vehicle(pl.vehicle, 0, seen, dt);
    for (const l of m.lifts) {
      if (l.phase === 'wait') continue;
      const tx = l.tile % GRID;
      const ty = Math.floor(l.tile / GRID);
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      const z = l.z / 65536;
      const base = l.vehicle.base;
      const team = this.paints[base] ?? NEUTRAL;
      this.pool(`shaft`, () => this.mesh('shaft', V.liftShaft, NEUTRAL)).take().position.set(x, 0, y);
      this.pool(`platform:${base}`, () => this.mesh(`platform:${base}`, V.liftPlatform, team)).take().position.set(x, z, y);
      this.vehicle(l.vehicle, z, seen, dt, true);
      // The hatch doors slide apart 0.3 px a tick of their timer from 5 px either side of the middle, and are gone
      // once 18 px apart (as view.ts draws them).
      const open = (l.doors * LIFT_SPEED) / 65536;
      if (open * 65536 < DOORS_OPEN) {
        for (const s of [-1, 1]) this.pool('door', () => this.mesh('door', V.liftDoor, NEUTRAL)).take().position.set(x + s * (5 + open), s > 0 ? 0.5 : 0.4, y);
      }
    }
    for (const [v, rig] of [...this.rigs]) {
      if (seen.has(v)) continue;
      this.dynamic.remove(rig.root);
      this.rigs.delete(v);
    }

    // Wrecks still moving, and the marks of those at rest.
    for (const w of m.wrecks) this.wreck(w.kind, w.base, w.x / 65536, w.y / 65536, w.z / 65536, w.heading, dt, w.model === 'body');
    const near = (x: number, y: number) => cams.some((c) => Math.abs(c.centreX - x) < 420 && Math.abs(c.pose().y - y) < 360);
    for (const w of extras.wrecks) {
      if (!near(w.x, w.y) || !drawMark(w, m.tick)) continue;
      this.wreck(w.kind, w.paint || w.variant, w.x, w.y, 0, w.heading, dt, false);
    }
    for (const s of extras.splats) {
      if (!near(s.x, s.y) || !drawMark(s, m.tick)) continue;
      const o = this.pool('splat', () => {
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(3, 8), new THREE.MeshLambertMaterial({ color: 0x5a1a14, transparent: true, opacity: 0.75, depthWrite: false }));
        mesh.rotateX(-Math.PI / 2);
        return mesh;
      }).take();
      o.position.set(s.x, 0.2, s.y);
    }

    // Soldiers: four steps of a walk, or swimming.
    for (const s of m.soldiers) {
      const base = s.base;
      const team = base < 0 ? NEUTRAL : this.paints[base] ?? NEUTRAL;
      const step = (s.frame >> 16) & 3;
      const key = s.water ? `swim:${base}:${step}` : `man:${base}:${step}`;
      const o = this.pool(key, () => this.mesh(key, () => (s.water ? V.swimmer(step * 1.57) : V.soldier(step * 1.57)), team, this.hot)).take();
      o.position.set(s.x / 65536, s.water ? -0.6 : 0, s.y / 65536);
      o.rotation.set(0, -radians(s.heading), 0);
    }

    // Gun towers' heads, turned and pitched; gates' leaves.
    const world = m.world;
    const turrets = new Map(m.turrets.map((t) => [t.tile, t]));
    for (let cy = 0; cy < CHUNKS; cy++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        if (!this.chunkKeys[cy * CHUNKS + cx]) continue;
        const x0 = cx * CHUNK * TILE;
        const y0 = cy * CHUNK * TILE;
        if (!cams.some((c) => c.centreX > x0 - 520 && c.centreX < x0 + CHUNK * TILE + 520 && c.pose().y > y0 - 460 && c.pose().y < y0 + CHUNK * TILE + 460)) continue;
        for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
          for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
            const i = y * GRID + x;
            const bid = world.building[i]!;
            if (!TURRET_BUILDINGS.has(bid) || !world.hp[i]) continue;
            const t = turrets.get(i) ?? idleGun(world, i);
            const owner = world.owner[i]!;
            const large = bid === LARGE_TOWER;
            const team = owner < 0 ? NEUTRAL : this.paints[owner] ?? NEUTRAL;
            const key = `gun:${large}:${owner}`;
            const gun = this.pool(key, () => {
              const parts = towerGun(large);
              const g = new THREE.Group();
              g.add(this.mesh(`${key}:head`, () => parts.head, team));
              const b = new THREE.Group();
              b.position.set(0, 4 * (large ? 1.25 : 1), 0);
              b.add(this.mesh(`${key}:barrels`, () => parts.barrels, team));
              g.add(b);
              return g;
            }).take() as THREE.Group;
            const h = this.boxes[bid]?.h ?? 24;
            gun.position.set(x * TILE + TILE / 2, h, y * TILE + TILE / 2);
            gun.rotation.set(0, -radians(t.heading), 0);
            // Pitch down is positive in the sim: tilt the barrels nose down.
            gun.children[1]!.rotation.set(-(t.pitch / 0x400000) * Math.PI * 2, 0, 0);
          }
        }
      }
    }
    // Gate leaves: each hinged at the inside of its post, reaching 8 px to the middle when shut and drawn in as the
    // gate opens (it opens 16 px). A shut gate is a building on its tile; an opening one is taken off the tile (the
    // sim's Gate), so its posts are drawn here too until it settles back into a building.
    const gates: { tile: number; bid: number; opening: number }[] = m.gates.map((g) => ({ tile: g.tile, bid: g.building, opening: g.opening / 65536 }));
    for (let i = 0; i < GRID * GRID; i++) {
      const bid = world.building[i]!;
      if (bid === GATE_H || bid === GATE_H + 1) gates.push({ tile: i, bid, opening: 0 });
    }
    const moving = new Set(m.gates.map((g) => g.tile));
    for (const { tile: i, bid, opening } of gates) {
      const len = Math.max(0.3, 8 * (1 - Math.min(16, opening) / 16));
      const owner = world.owner[i]!;
      const team = owner < 0 ? NEUTRAL : this.paints[owner] ?? NEUTRAL;
      const cx = (i % GRID) * TILE + TILE / 2;
      const cy = Math.floor(i / GRID) * TILE + TILE / 2;
      if (moving.has(i)) {
        const def = world.defs[bid];
        const key = `gateposts:${bid}:${owner}`;
        const posts = def && this.pool(key, () => this.mesh(key, () => building(def, def.name, this.boxes[bid] ?? null, i) ?? new Kit(), team)).take();
        posts?.position.set(cx, 0, cy);
      }
      for (const s of [-1, 1]) {
        const leaf = this.pool(`leaf:${owner}`, () => this.mesh(`leaf:${owner}`, () => gateLeaf(1), team)).take();
        leaf.scale.set(len, 1, 1);
        if (bid === GATE_H) {
          leaf.position.set(cx + s * 8, 0, cy);
          leaf.rotation.set(0, s < 0 ? 0 : Math.PI, 0);
        } else {
          leaf.position.set(cx, 0, cy + s * 8);
          leaf.rotation.set(0, s < 0 ? -Math.PI / 2 : Math.PI / 2, 0);
        }
      }
    }

    // Mines: a disc, with a red light while arming.
    for (const mine of m.mines) {
      const o = this.pool('mine', () => {
        const g = new THREE.Group();
        g.add(this.mesh('mine', () => new Kit().cyl(0, 0, 0, 2.2, 2.6, 1, 0x2e3a2a, 8).cyl(0, 0, 1, 0.6, 0.6, 0.6, 0x444444, 6), NEUTRAL));
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.7, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
        light.position.y = 1.7;
        g.add(light);
        return g;
      }).take();
      o.position.set(mine.x / 65536, 0, mine.y / 65536);
      const armed = mineArmed(mine);
      o.userData.team = mine.team;
      o.userData.armed = armed;
      o.children[1]!.visible = !armed && mine.blink < mine.arm >> 16;
      this.mines.push(o);
    }

    // Flags: a pole and the side's flag, waving.
    for (const f of m.flags) {
      if (!f.revealed || m.eliminated[f.base]) continue;
      const team = this.paints[f.base] ?? NEUTRAL;
      const o = this.pool(`flag:${f.base}`, () => this.mesh(`flag:${f.base}`, () => new Kit()
        .cyl(0, 0, 0, 0.5, 0.6, 20, 0xd8d8d8, 6).ball(0, 0, 20.3, 0.9, 0xe0b81c, 0)
        .box(4.5, 0, 13.5, 9, 0.5, 6, 'team'), team)).take();
      o.position.set(f.x / 65536, 0, f.y / 65536);
      o.rotation.set(0, Math.sin(m.tick * 0.15 + f.base) * 0.25, 0);
    }

    for (const g of m.grenades) {
      this.pool('grenade', () => this.mesh('grenade', () => new Kit().ball(0, 0, 0, 1.3, 0x3d4a2a, 0), NEUTRAL)).take().position.set(g.x / 65536, g.z / 65536 + 1, g.y / 65536);
    }

    for (const d of m.drones) this.drone(d.x / 65536, d.y / 65536, d.z / 65536, d.heading, d.side, d.pod, m.tick + d.id);

    if (m.sub) {
      const f = subFrame(m.sub);
      if (f >= 0) {
        const o = this.pool('sub', () => this.mesh('sub', V.submarine, NEUTRAL, this.hot)).take();
        const rise = Math.min(1, f / 19);
        const bob = f >= 20 ? Math.sin(m.tick * 0.2) * 0.8 : 0;
        o.position.set(m.sub.x / 65536, -16 + rise * 18 + bob, m.sub.y / 65536);
        o.rotation.set(0, 0, 0);
      }
    }

    for (const p of m.projectiles) {
      const kind = SHOT_MODELS[p.kind];
      if (!kind) continue;
      const x = p.x / 65536;
      const y = p.y / 65536;
      const z = p.z / 65536;
      const o = this.pool(`shot:${kind}`, () => {
        const mesh = this.mesh(`shot:${kind}`, () => V.shot(kind), NEUTRAL, kind === 'tracer' ? this.glowMaterial : this.material);
        mesh.castShadow = kind !== 'tracer';
        return mesh;
      }).take();
      o.position.set(x, z, y);
      const turns = p.pitch / (PROJECTILES[p.kind]!.fine ? FINE_TURN : 0x400000);
      o.rotation.set(0, 0, 0);
      o.rotation.order = 'YXZ';
      o.rotation.set(-turns * Math.PI * 2, -radians(p.heading), 0);
      if (kind === 'missile' || kind === 'big') {
        const a = radians(p.heading);
        this.fx.exhaust(x - Math.sin(a) * 5, y + Math.cos(a) * 5, z, dt);
      } else if (kind === 'tracer') this.fx.exhaust(x, y, z, 0);
    }

    for (const p of this.pools.values()) p.end();
  }

  /** A vehicle at height z (its own, or the lift platform's when on a lift). */
  private vehicle(v: Vehicle, liftZ: number, seen: Set<Vehicle>, dt: number, onLift = false): void {
    seen.add(v);
    const rig = this.rig(v);
    const z = onLift ? liftZ : v.z / 65536;
    rig.root.visible = true;
    rig.root.position.set(v.x / 65536, z, v.y / 65536);
    rig.root.rotation.set(0, -radians(v.heading), 0);
    if (rig.turret) rig.turret.rotation.set(0, -radians(v.turret), 0);
    if (rig.barrel) rig.barrel.rotation.set(-(v.barrel / 0x400000) * Math.PI * 2, 0, 0);
    if (rig.tail) rig.tail.rotation.x += (v.heli ? v.heli.engine / 65536 : 0) * dt * 60;
    if (v.heli && rig.rotor) rig.rotor.rotation.y = -radians(v.heli.rotor);
    if (rig.wheels.length) {
      const target = v.tyres ? 1 : 0;
      rig.inflate += Math.sign(target - rig.inflate) * Math.min(Math.abs(target - rig.inflate), dt * 2.5);
      const s = 1 + rig.inflate * 0.75;
      for (const w of rig.wheels) w.scale.set(1 + rig.inflate * 0.5, s, s);
      // The jeep rides up on its blown-up tyres.
      rig.root.position.y += rig.inflate * 2.2;
      const spin = (v.speed / 65536) * dt * 25;
      for (const w of rig.wheels) w.children[0]!.rotation.x -= spin;
    }
    // A badly hit vehicle smokes.
    const max = VEHICLES[v.kind].health;
    if (v.health < max * 0.4 && z > -4) this.fx.trail(v.x / 65536, v.y / 65536, z + 4, v.health < max * 0.2, dt);
  }

  private rig(v: Vehicle): VehicleRig {
    let rig = this.rigs.get(v);
    if (rig) return rig;
    const team = this.paints[v.base] ?? NEUTRAL;
    const kits = VEHICLE_KITS[v.kind]();
    const key = `${v.kind}:${v.base}`;
    const root = new THREE.Group();
    this.dynamic.add(root);
    const body = this.mesh(`${key}:body`, () => kits.body, team, this.hot);
    root.add(body);
    rig = { root, body, wheels: [], inflate: v.tyres ? 1 : 0 };
    if (kits.turret) {
      rig.turret = new THREE.Group();
      rig.turret.add(this.mesh(`${key}:turret`, () => kits.turret!, team, this.hot));
      root.add(rig.turret);
    }
    if (kits.barrel) {
      rig.barrel = new THREE.Group();
      const [py, pz] = kits.pivot ?? [0, 0];
      rig.barrel.position.set(0, pz, py);
      rig.barrel.add(this.mesh(`${key}:barrel`, () => kits.barrel!, team, this.hot));
      (rig.turret ?? root).add(rig.barrel);
    }
    if (kits.rotor) {
      rig.rotor = new THREE.Group();
      const [x, y, z] = kits.rotorAt ?? [0, 0, 0];
      rig.rotor.position.set(x, z, y);
      rig.rotor.add(this.mesh(`${key}:rotor`, () => kits.rotor!, team, this.hot));
      root.add(rig.rotor);
    }
    if (kits.tail) {
      rig.tail = new THREE.Group();
      const [x, y, z] = kits.tailAt ?? [0, 0, 0];
      rig.tail.position.set(x, z, y);
      rig.tail.add(this.mesh(`${key}:tail`, () => kits.tail!, team, this.hot));
      root.add(rig.tail);
    }
    for (const [x, y, z] of kits.wheelAt ?? []) {
      const w = new THREE.Group();
      w.position.set(x, z, y);
      w.add(this.mesh(`${key}:wheel`, () => kits.wheels!, team, this.hot));
      rig.wheels.push(w);
      root.add(w);
    }
    this.rigs.set(v, rig);
    return rig;
  }

  private wreck(kind: VehicleKind, base: number, x: number, y: number, z: number, heading: number, dt: number, body: boolean): void {
    const team = this.paints[base] ?? NEUTRAL;
    const key = `wreck:${kind}:${base}`;
    const o = this.pool(key, () => this.mesh(`${kind}:${base}:body`, () => VEHICLE_KITS[kind]().body, team, this.charred)).take() as THREE.Mesh;
    o.material = body ? this.hot : this.charred;
    o.position.set(x, z, y);
    o.rotation.set(0, -radians(heading), body ? 0 : 0.12);
    this.fx.trail(x, y, z, !body, dt);
  }

  private drone(x: number, y: number, z: number, heading: number, side: number, pod: number, frame: number): void {
    const team = this.paints[side] ?? NEUTRAL;
    const key = `drone:${side}`;
    const o = this.pool(key, () => {
      const kits = V.drone();
      const g = new THREE.Group();
      g.add(this.mesh(`${key}:body`, () => kits.body, team, this.hot));
      const b = new THREE.Group();
      b.add(this.mesh(`${key}:pod`, () => kits.barrel!, team, this.hot));
      b.position.set(0, 0, kits.pivot![0]);
      g.add(b);
      const r = new THREE.Group();
      r.add(this.mesh(`${key}:rotor`, () => kits.rotor!, team, this.hot));
      r.position.set(0, kits.rotorAt![2], 0);
      g.add(r);
      return g;
    }).take() as THREE.Group;
    o.position.set(x, z, y);
    o.rotation.set(0, -radians(heading), 0);
    o.children[1]!.rotation.set(-(((pod << 10) >> 10) / 0x400000) * Math.PI * 2, 0, 0);
    o.children[2]!.rotation.set(0, ((frame & 15) / 16) * Math.PI * 2, 0);
  }

  dispose(): void {
    this.ground?.dispose();
    this.pass?.dispose();
    for (const c of this.chunks) c?.geometry.dispose();
    for (const g of this.geoCache.values()) g.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}

const VEHICLE_KITS: Record<VehicleKind, () => V.VehicleKits> = { tank: V.tank, jeep: V.jeep, asv: V.asv, heli: V.heli };

/** Each projectile type's model, as the retro view's (type 3 is never drawn). */
const SHOT_MODELS: readonly ('tracer' | 'shell' | 'missile' | 'big' | null)[] = [
  'tracer', 'shell', 'missile', null, 'shell', 'shell', 'shell', 'tracer', 'missile', 'missile', 'big', 'tracer',
];

/** A tower's gun before it wakes: the aim its tile's scenery entry holds (as view.ts). */
function idleGun(world: World, i: number): { heading: number; pitch: number } {
  const e = sceneryEntry(i);
  return { heading: (world.variety[e]! & 0x3f) << 16, pitch: (world.scenery[e * 2]! & 0xff) << 14 };
}

/** The tallest of a building's parts: its body, with where it stands from the tile's middle. */
export function bodyBox(parts: readonly { model: Model | null; offset: [number, number, number] }[]): Box | null {
  let best: Box | null = null;
  for (const p of parts) {
    const v = p.model?.verts;
    if (!v?.length) continue;
    const xs = v.map((q) => q[0]);
    const ys = v.map((q) => q[1]);
    const zs = v.map((q) => q[2]);
    const box: Box = {
      x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), h: Math.max(...zs) + p.offset[2],
      ox: p.offset[0], oy: p.offset[1], oz: p.offset[2],
    };
    // Flat parts are drop shadows and floors; a model with height wins.
    if (!best || box.h > best.h) best = box;
  }
  return best;
}

/** A bridge tile blown up: charred planks hanging from the sides that still hold. */
function brokenBridge(world: World, i: number): Kit {
  const k = new Kit();
  const horizontal = world.building[i - 1] === 74 || world.building[i + 1] === 74;
  for (let j = 0; j < 4; j++) {
    const t = -14 + j * 4;
    const drop = -3 - j * 1.5;
    k.box(horizontal ? t : 0, horizontal ? 0 : t, drop, horizontal ? 3.6 : 26, horizontal ? 26 : 3.6, 1, j & 1 ? 0x4a3020 : 0x5d3c22, { tilt: horizontal ? 0 : 0.3, roll: horizontal ? 0.3 : 0 });
  }
  return k;
}

export { lookOf };
