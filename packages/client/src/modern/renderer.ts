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
  DEEP, DOORS_OPEN, GATE_OPEN, GATE_SPEED, LIFT_DEPTH, skullLook, FINE_TURN, LAND, SHALLOW, groundAt, type Elevator, type Lives, type SkullLook, GRID, LIFT_SPEED, PROJECTILES, VEHICLES, mineArmed, sceneryEntry, subFrame, type Match, type MatchEvent, type Vehicle, type VehicleKind, type World,
} from '@rfw/sim';
import type { GameAssets, Model } from '../assets.js';
import { FOCAL, type Camera } from '../camera.js';
import { drawMark, type Splat, type Wreck as MarkWreck } from '../effects.js';
import { TEAMS } from '../paint.js';
import { GATE_POST, building, gateLeaf, lightOf, lookOf, playset, towerGun, type Box } from './buildings.js';
import { Fx } from './fx.js';
import { LAMP_REACH, LampMap, lampLight, type Lamp } from './lampmap.js';
import { BEAM_HOODED, BEAM_SEARCH, BEAM_TWIN, LIGHT_TIME, LookPass, THERMAL, beamDistance, grainLights, heatFragment, type BeamShape } from './look.js';
import { BunkerScene, SkullScene } from './screens.js';
import { Ground, TILE, type SeaInputs } from './ground.js';
import { WaterMarks } from './water.js';
import { VehicleLights } from './vehiclelights.js';
import { Kit, NEUTRAL, teamPaint, type TeamPaint } from './kit.js';
import * as V from './vehicles.js';
import { PHOTO_SKY_TURN, PLASTIC_SKY, charredPlastic, gardenSky, melted, photoSky, toyPlastic, type PhotoSkies } from './toy.js';
import { rockMaterial } from './photorock.js';
import { scatterPatch } from './scatter.js';
import { ART } from './art.js';
import { stats } from './stats.js';
import type { PresetSpec } from '../quality.js';
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
// A warm afternoon sun, low enough for long shadows that show the toys standing on the ground.
const SUN = new THREE.Vector3(-0.55, 0.85, 0.7).normalize();
const SHADOW_SPAN = 340;
/** The sun's shadow map's across and up directions (at right angles to SUN), for keeping its texels on the ground. */
const SUN_SIDE = new THREE.Vector3(0, 1, 0).cross(SUN).normalize();
const SUN_UP = SUN.clone().cross(SUN_SIDE).normalize();
/**
 * One headlight for each player's vehicle (four at most). Every light that throws shadows is a texture the lit
 * materials read, so they are kept few: the buildings' lamps are all in one texture (lampmap.ts).
 */
const HEADLIGHTS = 4;
/**
 * The beam each vehicle throws at night, shaped to the vehicle (look.ts beamGrain): the jeep's twin warm headlamps,
 * the tank's dim hooded blackout lamps cut off above so they light only the road just ahead, the ASV's narrow
 * blue-white searchlight sweeping slowly from side to side across the water ahead, and the helicopter's searchlight
 * from under its nose, a hard-edged pool wandering over the ground ahead and below. Their small lights (tail lights,
 * navigation lights, the helicopter's flashing beacon) are glows, not lights (vehiclelights.ts).
 * from: how far ahead of the vehicle's middle the lamp is; sweep: how far the beam swings (radians).
 */
const BEAMS: Record<VehicleKind, { power: number; colour: number; angle: number; soft: number; reach: number; height: number; shape: BeamShape; from: number; sweep: number }> = {
  jeep: { power: 520, colour: 0xffd9a0, angle: 0.46, soft: 0.5, reach: 60, height: 5, shape: BEAM_TWIN, from: 11, sweep: 0 },
  tank: { power: 380, colour: 0xffe2b0, angle: 0.62, soft: 0.6, reach: 36, height: 5, shape: BEAM_HOODED, from: 12, sweep: 0 },
  asv: { power: 760, colour: 0xd6e4ff, angle: 0.2, soft: 0.25, reach: 110, height: 10, shape: BEAM_SEARCH, from: 9, sweep: 0.35 },
  heli: { power: 900, colour: 0xf4f8ff, angle: 0.24, soft: 0.2, reach: 22, height: 2, shape: BEAM_SEARCH, from: 10, sweep: 0.3 },
};

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
const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** A gate's leaf, post to middle (px). */
const GATE_LEAF = 16;
/** Smooth start and stop: 0 to 1 over 0 to 1, with no speed at either end. */
const smooth = (u: number) => {
  const t = Math.max(0, Math.min(1, u));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * How far a gate's leaves have slid back (px), part of a tick on from the sim's opening (they move a steady half
 * pixel a tick), eased over the whole of their travel: the same start, end and timing as the sim's, only softer.
 */
export function gateSlide(opening: number, target: number, part: number): number {
  const step = Math.sign(target - opening) * Math.min(Math.abs(target - opening), GATE_SPEED * part);
  return (GATE_OPEN / 65536) * smooth((opening + step) / GATE_OPEN);
}

/**
 * How high a lift's platform stands (px, -32 to 0), part of a tick on from the sim's (it moves a steady 0.3 px a
 * tick), eased over its whole travel so it pulls away from rest and settles into its stop rather than starting and
 * stopping dead. It takes the same ticks as the sim's: only the drawing is eased.
 */
export function liftHeight(z: number, phase: string, part: number): number {
  const dir = phase === 'rise' ? 1 : phase === 'sink' ? -1 : 0;
  const at = Math.max(-LIFT_DEPTH, Math.min(0, z + dir * LIFT_SPEED * part));
  return (LIFT_DEPTH / 65536) * (smooth(1 + at / LIFT_DEPTH) - 1);
}

/** How far a lift's hatch doors have slid apart (px, 0 to 16, when they are under the ground), from their timer. */
export function hatchSlide(doors: number, phase: string, part: number): number {
  const dir = phase === 'rise' ? 1 : phase === 'sink' ? -1 : 0;
  const open = Math.max(0, doors + dir * part) * LIFT_SPEED;
  return HATCH * smooth(open / DOORS_OPEN);
}
/** Each hatch door's width: they meet in the middle of the shaft and slide under the ground beside it. */
const HATCH = 16;
/** Sim ticks a second, for vehicles' speeds in pixels a second. */
const TICKS = 62.5;
/** Where the moon stands for its path on the sea: high in the north-west, ahead of the camera. */
const MOON = new THREE.Vector3(-0.32, 0.6, -0.74).normalize();

/**
 * How each ground vehicle disturbs the water: its wheels' or tracks' half spacing and how far back they are (px),
 * how wide a line each leaves, the foam, chop and silt of that line, how much it throws up (spray a second at full
 * pace, and its colour), its bow wave's foam, the speed that counts as full pace (px/s), and how low it sits in the
 * shallows (px).
 */
const WAKES: Record<Exclude<VehicleKind, 'heli'>, { half: number; back: number; line: number; foam: number; chop: number; silt: number; spray: number; muddy: boolean; bow: number; fast: number; wade: number }> = {
  // Narrow tyres: two thin white lines and a light kick of spray.
  jeep: { half: 4.5, back: 5, line: 3.2, foam: 0.5, chop: 0.35, silt: 0.08, spray: 40, muddy: false, bow: 0.35, fast: 60, wade: 1.6 },
  // Wide tracks: broad lanes of brown churned water, a heavy bow wave, clods of muddy water thrown up.
  tank: { half: 7, back: 7, line: 6, foam: 0.3, chop: 0.55, silt: 0.32, spray: 26, muddy: true, bow: 0.65, fast: 40, wade: 2.4 },
  // Six big wheels: white water, a bit of mud, and rooster tails of spray off the back.
  asv: { half: 6.5, back: 9, line: 4.5, foam: 0.55, chop: 0.45, silt: 0.16, spray: 55, muddy: false, bow: 0.5, fast: 30, wade: 2 },
};

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
  /** How low it sits in the water (px), eased; and seconds to its next ripple ring. */
  wade: number;
  ringIn: number;
  /** Whether it was last drawn on a lift, and seconds since it rolled off one (its suspension settling). */
  lifted: boolean;
  settle: number;
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

/** The strongest the stream breaks up for a hit on the viewer's own vehicle (blasts nearby can still go to 1). */
const STRUCK_MAX = 0.7;
/** How long a slice of getting ready runs before the loading screen gets a frame (ms). */
const SLICE_MS = 10;

export class ModernRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly sun = new THREE.DirectionalLight(0xffe6c2, 2.7);
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04 });
  /** Vehicles, soldiers and drones: moulded toy plastic, and they run hot on the thermal camera. */
  private readonly hot = toyPlastic();
  /** Buildings, towers, walls and gates: plastic playset pieces, a little less glossy than the toys. */
  private readonly playset = playsetPlastic();
  /** Burnt-out wrecks: the toy melted and scorched. */
  private readonly charred = charredPlastic();
  /** The garden's rocks, in photo-scanned stone. */
  private readonly stone = rockMaterial();
  /** A patch's buildings by material: toys (the playset's plastic), plants, burnt-out ones and rocks. */
  private readonly chunkMaterials: readonly THREE.Material[] = [this.playset, this.material, this.charred, this.stone];
  /** The photographed skies the plastic reflects, once they have loaded (ART.photoSky). */
  private skies: PhotoSkies | null = null;
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  private world: World | null = null;
  private ground: Ground | null = null;
  /** Each chunk's buildings: the playset pieces' (and plants'), the rocks', the rest's and the burnt-out wrecks' meshes, in a group. */
  private readonly chunks: (THREE.Group | null)[] = new Array(CHUNKS * CHUNKS).fill(null);
  /** Whether each chunk has been built for this world. */
  private readonly chunkBuilt: boolean[] = new Array<boolean>(CHUNKS * CHUNKS).fill(false);
  /** Each tile's building and owner when its chunk was last built, to see which chunks changed without garbage. */
  private readonly seenBuilding = new Uint8Array(GRID * GRID);
  private readonly seenOwner = new Int8Array(GRID * GRID);
  private readonly statics = new THREE.Group();
  private readonly dynamic = new THREE.Group();
  readonly fx = new Fx();
  private readonly paints: TeamPaint[] = TEAMS.map((t) => teamPaint(t.colour & 255, (t.colour >> 8) & 255, (t.colour >> 16) & 255));
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();
  private readonly pools = new Map<string, Pool<THREE.Object3D>>();
  private readonly rigs = new Map<Vehicle, VehicleRig>();
  private lastTime = performance.now();
  /**
   * How far on to the next sim tick this frame is drawn (0-1, set by the game from its tick clock). The lifts and
   * gates move at a steady rate, so they are drawn where they are between ticks, smooth at any frame rate.
   */
  part = 0;
  /** Each lift's phase when last drawn, to see a hatch open and a lift lock at the top. */
  private liftSeen = new Map<object, string>();
  private readonly boxes: (Box | null)[];
  private bunker: BunkerScene | null = null;
  private night = false;
  /** Extra moonlight at night, for the level editor (setMoonlight). */
  private moon = 0;
  private readonly sky = new THREE.HemisphereLight(0xcfe8ff, 0x8a6a48, 1.25);
  /** Headlights for the vehicles at night: a fixed few, so turning them on and off in a night match never rebuilds the shaders. */
  private readonly heads: THREE.SpotLight[] = [];
  /** Every building's lamp at night, with its light and shadows worked out on the map. */
  private readonly lampMap = new LampMap();
  /** Where the buildings have changed since the lamps' light was last worked out (pixels), or all of it. */
  private lampsStale: { x0: number; y0: number; x1: number; y1: number } | 'all' | null = 'all';
  /** Each chunk's building lights, kept with its geometry. */
  private readonly chunkLamps: Lamp[][] = Array.from({ length: CHUNKS * CHUNKS }, () => []);
  /** Where each tile's building lies in its patch's merged mesh (the mesh and its run of vertices). */
  private readonly tileRuns = new Map<number, { mesh: THREE.Mesh; start: number; count: number }>();
  /** Each patch's tiles changed since it was built, drawn as a small mesh a material of their own. */
  private readonly chunkPatches: Map<number, TileGeometry>[] = Array.from({ length: CHUNKS * CHUNKS }, () => new Map());
  /** How much windows and lamps glow: 0 by day, 1 at night. */
  private readonly glow = { value: 0 };
  private skull: SkullScene | null = null;
  /** The drone's feed over the picture (always on in a match), and the thermal camera (switched in the match). */
  private feed = false;
  private thermal = false;
  private pass: LookPass | null = null;
  /** Recent blasts (seconds on the performance clock), and when each player's vehicle was last hit or destroyed. */
  private readonly blasts: { x: number; y: number; at: number; power: number }[] = [];
  private readonly struck = new Map<number, { at: number; long: boolean }>();
  /** The stream breaking up regardless of what it watches (0-1): the feed cutting out at the end of the win scene. */
  private jamming = 0;
  /** What the vehicles leave on the sea: foam, chop, silt and ripples. */
  private readonly marks = new WaterMarks();
  /** The headlights for the sea shader, which lights itself. */
  private readonly sea: SeaInputs;
  /** The vehicles' small lights: lamp glass, tail and navigation lights, beacons. */
  private readonly lights = new VehicleLights();

  constructor(private readonly assets: GameAssets) {
    // The picture is copied (copyTo, or into this.canvas) only in the frame it is drawn, so the browser need not keep it.
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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
    this.hot.envMap = this.playset.envMap = this.charred.envMap = this.fx.shardMaterial.envMap = gardenSky(this.gl, SUN);
    this.teach(this.material, 0);
    this.teach(this.playset, 0);
    this.teach(this.hot, 1);
    this.teach(this.charred, 0.55);
    this.teach(this.stone, 0);
    // Its own program: the plain material's closures read the same.
    this.stone.customProgramCacheKey = () => 'heat:0:rock';
    if (ART.photoSky) {
      void photoSky(this.gl).then((skies) => {
        this.skies = skies;
        for (const m of [this.hot, this.playset, this.charred, this.fx.shardMaterial]) m.envMapRotation.y = PHOTO_SKY_TURN;
        this.moonlit();
      });
    }
    for (let i = 0; i < HEADLIGHTS; i++) {
      const l = new THREE.SpotLight(0xfff0c8, 0, 260, 0.5, 0.65, 1.2);
      // Headlights throw shadows too, drawn once a frame while they are on (not again for a second split-screen view).
      l.castShadow = true;
      l.shadow.autoUpdate = false;
      l.shadow.mapSize.set(512, 512);
      l.shadow.bias = -0.002;
      l.shadow.normalBias = 0.5;
      l.shadow.radius = 2;
      l.shadow.camera.near = 3;
      l.shadow.camera.updateProjectionMatrix();
      l.shadow.needsUpdate = true;
      // In the scene only at night (setNight): by day every lit pixel would still pay for four spotlights, their
      // shadow maps and their beams' grain, all at nothing.
      this.heads.push(l);
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
    this.scene.add(this.sun, this.sun.target, this.statics, this.dynamic, this.fx.group, this.lights.points);
    this.boxes = assets.parts.map((parts) => bodyBox(parts));
    this.sea = {
      marks: this.marks.texture,
      rings: this.marks.ringData,
      lampMap: this.lampMap.texture,
      glare: this.lampMap.glare,
      night: this.glow,
      heads: {
        pos: Array.from({ length: HEADLIGHTS }, () => new THREE.Vector3()),
        dir: Array.from({ length: HEADLIGHTS }, () => new THREE.Vector3(0, -1, 0)),
        col: Array.from({ length: HEADLIGHTS }, () => new THREE.Vector3()),
        cone: Array.from({ length: HEADLIGHTS }, () => new THREE.Vector3(0.9, 0.95, 0)),
      },
      moon: MOON.clone(),
      flashes: { pos: Array.from({ length: 4 }, () => new THREE.Vector3()), power: [0, 0, 0, 0] },
    };
  }

  /**
   * Windows and lamp glass (the kits' glow attribute) shine warm at night; on the thermal camera the material shows
   * its heat instead of its lit colour.
   */
  private teach(material: THREE.Material, heat: number): void {
    // The closures read alike, so tell three.js each heat needs its own program.
    material.customProgramCacheKey = () => `heat:${heat}`;
    // The toy plastic's own change (matte rubber) comes first.
    const own = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, gl) => {
      own(shader, gl);
      shader.uniforms.nightGlow = this.glow;
      shader.uniforms.thermal = THERMAL;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float glow;\nvarying float vGlow;\nvoid main() {\n  vGlow = glow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float nightGlow;\nuniform float thermal;\nvarying float vGlow;\nvoid main() {')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(1.0, 0.78, 0.42) * vGlow * nightGlow * 1.6;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${heatFragment(heat, true)}`);
      grainLights(shader);
      lampLight(shader, this.lampMap.texture, this.glow);
    };
  }

  // ---- Events -------------------------------------------------------------------------------------------------

  /** The match's events of one tick, for the effects. */
  events(events: readonly MatchEvent[], m: Match): void {
    const px = (n: number) => n / 65536;
    const now = performance.now() / 1000;
    const blast = (x: number, y: number, power: number) => {
      this.blasts.push({ x, y, at: now, power });
      if (this.blasts.length > 32) this.blasts.shift();
    };
    for (const e of events) {
      // What shakes the drone's stream: a blast near what it watches, and above all a hit on the player's vehicle.
      switch (e.type) {
        case 'destroyed':
          blast(px(e.x), px(e.y), 0.5);
          this.struck.set(e.player, { at: now, long: true });
          break;
        case 'wreckBlown':
          blast(px(e.x), px(e.y), 0.4);
          break;
        case 'droneDown':
          blast(px(e.x), px(e.y), 0.35);
          break;
        case 'buildingDestroyed': {
          const small = /BUSH|TREE|PALM|CACTUS|ROCK|TENT|PLANTER/i.test(m.world.defs[e.building]?.name ?? '');
          blast((e.tile % GRID) * TILE + TILE / 2, Math.floor(e.tile / GRID) * TILE + TILE / 2, e.crushed || small ? 0.2 : 0.55);
          break;
        }
        case 'hit':
          if (e.target === 'vehicle') {
            for (const p of m.players) {
              const v = p.vehicle;
              if (v && Math.hypot(v.x - e.x, v.y - e.y) < 18 * 65536 && !(this.struck.get(p.id)?.long && now - this.struck.get(p.id)!.at < 1.2)) this.struck.set(p.id, { at: now, long: false });
            }
          }
          break;
        default:
          break;
      }
    }
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
          if (e.target === 'water') {
            this.fx.splash(x, y, !gun);
            this.marks.ring(x, y, gun ? 0.3 : 0.7, gun ? 22 : 34, gun ? 1 : 1.8);
            this.marks.stamp(x, y, gun ? 5 : 14, gun ? 0.6 : 1, 0.6, 0);
          }
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
          if (e.drowned) this.bigSplash(x, y);
          else if (!e.fuelOut) this.fx.explosion(x, y, z, 1.8, { scorch: z < 2, chunks: this.chunkColours(e.player >= 0 ? m.players[e.player]?.base ?? -1 : -1), smokeFor: 3 });
          break;
        }
        case 'wreckBlown':
          this.fx.explosion(px(e.x), px(e.y), px(e.z), 1.5, { scorch: true, chunks: this.chunkColours(e.base) });
          break;
        case 'wreckSunk':
          this.bigSplash(px(e.x), px(e.y));
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
          if (e.water) {
            this.fx.splash(px(e.x), px(e.y), false);
            this.marks.ring(px(e.x), px(e.y), 0.35, 20, 1.2);
          } else this.fx.dirt(px(e.x), px(e.y));
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

  /** Something big going under: a splash, rings and a patch of foam. */
  private bigSplash(x: number, y: number): void {
    this.fx.splash(x, y, true);
    this.marks.ring(x, y, 0.9, 36, 2);
    this.marks.ring(x, y, 0.5, 20, 2.2);
    this.marks.stamp(x, y, 22, 1, 0.8, 0.2);
  }

  private chunkColours(base: number): THREE.Color[] {
    const p = this.paints[base] ?? NEUTRAL;
    return [new THREE.Color(p.main), new THREE.Color(p.dark), new THREE.Color(0x34363a), new THREE.Color(0x6c7178)];
  }

  // ---- Drawing ------------------------------------------------------------------------------------------------

  /** Brings the 3D world up to date with the match for a picture at now, drawing nothing; the seconds since the last. */
  private stage(m: Match, views: readonly ModernView[], extras: { wrecks: readonly MarkWreck[]; splats: readonly Splat[] }, now: number): number {
    LIGHT_TIME.value = (now / 1000) % 1000;
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (m.world !== this.world) this.setWorld(m.world);
    const ground = this.ground!;
    // A ground prepare began painting and never finished is painted now.
    ground.paintNow();
    ground.update(m.world, m.lifts.filter((l) => l.phase !== 'wait').map((l) => l.tile));
    ground.tick(now / 1000);
    this.syncChunks(m.world);
    this.syncDynamic(m, extras, views.filter((v) => !v.skip).map((v) => v.cam), dt);
    this.aimHeadlights(m, views, now / 1000);
    // (Not on the thermal camera, which sees heat, not light.)
    this.lights.update(this.thermal ? [] : this.rigs, this.night, now / 1000, dt);
    // One piece of getting ready a frame, once the match has its first pictures up.
    if (this.direct && this.world) this.warmUp(m);
    this.lightBuildings();
    this.waterFx(m, dt);
    this.fx.step(dt);
    this.fx.flashes(this.sea.flashes.pos, this.sea.flashes.power);
    return dt;
  }

  /** The bunker screen's scene, set for a screen r. */
  private bunkerFor(sc: Extract<ModernScreen, { kind: 'bunker' }>, r: ModernRect): BunkerScene {
    const b = (this.bunker ??= new BunkerScene());
    b.setNight(this.night);
    b.frame(r.w / r.h);
    b.update(this.paints[sc.base] ?? NEUTRAL, sc.lives, sc.selected, sc.elevator, sc.tick);
    return b;
  }

  /** The skull screen's scene, set for a screen r. */
  private skullFor(sc: Extract<ModernScreen, { kind: 'skull' }>, r: ModernRect): SkullScene {
    const k = (this.skull ??= new SkullScene());
    k.frame(r.w / r.h);
    k.update(sc.look, this.paints[sc.rival] ?? NEUTRAL, this.paints[sc.base] ?? NEUTRAL, sc.lost, sc.left, sc.start);
    return k;
  }

  /**
   * Draws the match from each camera into its rectangle of the WebGL picture, and copies it to this.canvas.
   * viewer is the player whose team decides which mines show; skip leaves a view out (the bunker shows there).
   */
  draw(m: Match, views: readonly ModernView[], extras: { wrecks: readonly MarkWreck[]; splats: readonly Splat[] }): void {
    const now = performance.now();
    if (stats) {
      stats.attach(this.gl);
      const c = this.gl.domElement;
      stats.describe(`3D ${c.width}x${c.height}${this.qualityName ? ` ${this.qualityName}` : ''}${this.night ? ' night' : ' day'}${views.length > 1 ? ` ${views.length} views` : ''}`);
    }
    const dt = this.stage(m, views, extras, now);
    stats?.begin('scene');
    this.marks.render(this.gl, dt);

    const at = (r: ModernRect) => {
      this.gl.setViewport(r.x, MODERN_H - r.y - r.h, r.w, r.h);
      this.gl.setScissor(r.x, MODERN_H - r.y - r.h, r.w, r.h);
    };
    // The map from each camera, then the drone's lens or the thermal camera over it, then the bunker and skull
    // screens, which are the player's own screens (the bunker then gets its security camera's look).
    const field = views.filter((v) => !v.skip);
    for (const v of field) {
      at(v.rect);
      const team = m.players[v.viewer]?.team;
      for (const mine of this.mines) mine.visible = mine.userData.team === team || !mine.userData.armed;
      this.place(v.cam, v.rect);
      this.gl.render(this.scene, this.camera);
    }
    stats?.begin('feed');
    if (field.length && (this.feed || this.thermal)) (this.pass ??= new LookPass(MODERN_W, MODERN_H)).apply(this.gl, field.map((v) => v.rect), field.map((v) => this.glitchFor(v)), this.feed, this.thermal, now / 1000, this.feed && !this.thermal);
    stats?.begin('screens');
    for (const v of views) {
      const r = v.rect;
      at(r);
      const sc = v.screen;
      if (sc?.kind === 'bunker') {
        const b = this.bunkerFor(sc, r);
        this.gl.render(b.scene, b.camera);
      } else if (sc?.kind === 'skull') {
        const k = this.skullFor(sc, r);
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
    // The bunker is watched by a security camera: the same lens, grain and grade as the drone's, never thermal, its
    // colour washed out by day and black and white infrared by night. (This is drawn here, on the picture: the HUD is
    // a see-through canvas of its own over it, where blending modes have no picture to work on.)
    const cams = views.filter((v) => v.screen?.kind === 'bunker').map((v) => v.rect);
    if (cams.length) (this.pass ??= new LookPass(MODERN_W, MODERN_H)).apply(this.gl, cams, cams.map(() => 0), true, false, now / 1000, false, this.night ? 'night' : 'day');
    stats?.end();
    stats?.add('draw', performance.now() - now);
    if (this.direct) return;
    const copyFrom = performance.now();
    this.canvas.getContext('2d')!.drawImage(this.gl.domElement, 0, 0);
    stats?.add('present', performance.now() - copyFrom);
  }

  /**
   * The match shows the WebGL canvas itself on the page (Display.presentModern), with its HUD on a canvas of its own
   * over it, so draw skips the copy into this.canvas. Off (the level editor, the galleries, the win scene), every
   * frame is copied there to draw on and show.
   */
  direct = false;

  /** Which headlights throw shadows at night (the quality preset). */
  private headShadows: PresetSpec['headlightShadows'] = 'all';
  private spec: PresetSpec | null = null;
  private qualityName = '';

  /**
   * The quality preset (quality.ts): the sun's shadow map, the headlights' shadows and the tilt-shift at once; the
   * garden's scatter rebuilt at once; the ground's photo scans from the next match.
   */
  setQuality(spec: PresetSpec, name = ''): void {
    const was = this.spec;
    this.spec = spec;
    this.qualityName = name;
    this.headShadows = spec.headlightShadows;
    ART.tiltShift = spec.tiltShift;
    ART.photoGround = spec.photoGround;
    ART.groundDetail = spec.groundDetail;
    if (this.sun.shadow.mapSize.x !== spec.sunShadow) {
      this.sun.shadow.mapSize.set(spec.sunShadow, spec.sunShadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (ART.scatter !== spec.scatter || ART.scatterDensity !== spec.scatterDensity) {
      ART.scatter = spec.scatter;
      ART.scatterDensity = spec.scatterDensity;
      // Build the patches again with the garden's scatter as it is now (their buildings stay as they are).
      if (was) this.chunkBuilt.fill(false);
    }
  }

  /**
   * The 3D picture's size for one shown `shown` device pixels wide: the preset's size, times the dynamic
   * resolution's scale (0.6-1). In steps of 1/32 of the modern screen, so it settles rather than jitters.
   */
  resolution(shown: number, scale: number): void {
    const spec = this.spec;
    if (!spec) return;
    const wide = Math.max(640, spec.width(shown) * scale);
    const pr = Math.max(0.5, Math.round((wide / MODERN_W) * 32) / 32);
    if (pr !== this.gl.getPixelRatio()) this.gl.setPixelRatio(pr);
  }

  /** The WebGL canvas the picture is drawn on. */
  get glCanvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  /** How hard the drone's stream breaks up over a view now: blasts near what it watches, and hits on its player. */
  private glitchFor(v: ModernView): number {
    const now = performance.now() / 1000;
    const fade = (age: number, span: number) => (age < 0 || age > span ? 0 : 1 - age / span);
    const pose = v.cam.pose();
    let g = 0;
    for (const b of this.blasts) if (Math.abs(b.x - pose.x) < 480 && Math.abs(b.y - pose.y) < 360) g = Math.max(g, b.power * fade(now - b.at, 0.45));
    const s = this.struck.get(v.viewer);
    // A hit on the player's own vehicle breaks the feed up at most to 70%, so who is shooting stays in sight.
    if (s) g = Math.max(g, STRUCK_MAX * fade(now - s.at, s.long ? 1.2 : 0.6));
    return Math.max(g, this.jamming);
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
    this.lights.setScale(f);
    // The shadow box follows what this view looks at, in whole steps of its shadow map's texels across the sun's
    // view, so shadows stay put on the ground as the camera moves instead of crawling and shimmering at the edges.
    // A free camera pulled back (a replay's) has its shadow box grown to what it sees.
    const span = Math.round(SHADOW_SPAN * cam.reach());
    const sc = this.sun.shadow.camera;
    if (sc.right !== span) {
      sc.left = -span;
      sc.right = span;
      sc.top = span;
      sc.bottom = -span;
      sc.updateProjectionMatrix();
    }
    const texel = (2 * span) / this.sun.shadow.mapSize.x;
    const at = SUN_SIDE.clone().multiplyScalar(Math.round((pose.x * SUN_SIDE.x + (pose.y - 40) * SUN_SIDE.z) / texel) * texel)
      .addScaledVector(SUN_UP, Math.round((pose.x * SUN_UP.x + (pose.y - 40) * SUN_UP.z) / texel) * texel);
    // Back onto the ground along the sun's direction: moving a point along it moves nothing in the shadow map.
    at.addScaledVector(SUN, -at.y / SUN.y);
    this.sun.target.position.copy(at);
    this.sun.position.copy(at).addScaledVector(SUN, 800);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  /**
   * The camera's look: the drone's feed (or a clean picture), and the thermal camera, which shows heat instead of
   * light, so night hides nothing from it.
   */
  /** Breaks the stream up by this much (0-1) whatever is on screen, until set back to 0. */
  jam(level: number): void {
    this.jamming = Math.max(0, Math.min(1, level));
  }

  /** The look last set: whether the drone's feed and the thermal camera are on, and whether it is night. */
  get look(): { drone: boolean; thermal: boolean; night: boolean } {
    return { drone: this.feed, thermal: this.thermal, night: this.night };
  }

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
    this.glow.value = night ? 1 : 0;
    // Adding or taking out the headlights rebuilds the lit materials' shaders: once a match, as it starts.
    for (const l of this.heads) {
      if (night) this.scene.add(l, l.target);
      else this.scene.remove(l, l.target);
    }
    this.sun.color.setHex(night ? 0x8ea4e8 : 0xffe6c2);
    this.moonlit();
    this.background();
    const w = this.ground?.water.uniforms;
    if (w) this.waterLight(w);
    this.bunker?.setNight(night);
  }

  /**
   * Extra moonlight at night (0 none, as in a match, to 1): the level editor's Night preview uses it so the whole
   * map can be read while laying it out. Matches never set it.
   */
  setMoonlight(level: number): void {
    const m = Math.max(0, Math.min(1, level));
    if (m === this.moon) return;
    this.moon = m;
    this.moonlit();
  }

  private moonlit(): void {
    this.sky.intensity = this.night ? 0.22 + 0.75 * this.moon : 1.25;
    this.sun.intensity = this.night ? 0.28 + 0.9 * this.moon : 2.7;
    // The plastic reflects the garden by day; at night only a trace of it, as moonlight.
    this.hot.envMapIntensity = this.playset.envMapIntensity = this.charred.envMapIntensity = this.night ? 0.03 + 0.2 * this.moon : PLASTIC_SKY;
    if (this.skies) {
      // The photographed park at night is lit by its own lamps and moon: it needs none of the day's dimming.
      this.hot.envMap = this.playset.envMap = this.charred.envMap = this.night ? this.skies.night : this.skies.day;
      if (this.night) this.hot.envMapIntensity = this.playset.envMapIntensity = this.charred.envMapIntensity = 0.12 + 0.3 * this.moon;
    }
    // The plastic shards of debris reflect as the toys do.
    this.fx.shardMaterial.envMap = this.hot.envMap;
    this.fx.shardMaterial.envMapIntensity = this.hot.envMapIntensity;
  }

  private waterLight(u: Record<string, THREE.IUniform>): void {
    (u.tint!.value as THREE.Color).setRGB(this.night ? 0.1 : 1, this.night ? 0.13 : 1, this.night ? 0.2 : 1);
    (u.glint!.value as THREE.Color).setRGB(this.night ? 0.3 : 1, this.night ? 0.36 : 0.97, this.night ? 0.5 : 0.88);
  }

  /**
   * At night every building's lamp is lit: their light and shadows are worked out again wherever the buildings have
   * changed (a building knocked down, or the level editor's edits), and only then, as the lamps never move.
   */
  private lightBuildings(): void {
    if (!this.night || !this.world || !this.lampsStale) return;
    const area = this.lampsStale === 'all' ? undefined : this.lampsStale;
    this.lampMap.bake(this.world, this.boxes, this.chunkLamps.flat(), area);
    this.lampsStale = null;
  }

  /** The buildings changed over this rectangle (pixels): the lamps' light there needs working out again. */
  private staleLamps(x0: number, y0: number, x1: number, y1: number): void {
    if (this.lampsStale === 'all') return;
    const r = LAMP_REACH;
    const s = this.lampsStale;
    this.lampsStale = s
      ? { x0: Math.min(s.x0, x0 - r), y0: Math.min(s.y0, y0 - r), x1: Math.max(s.x1, x1 + r), y1: Math.max(s.y1, y1 + r) }
      : { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
  }

  /** Points each vehicle's headlights (at night) ahead of it. */
  private aimHeadlights(m: Match, views: readonly ModernView[], t: number): void {
    const lit = new Array<boolean>(HEADLIGHTS).fill(false);
    // Which headlights throw shadows, by the quality preset: all, the ones of the players at this screen, or none.
    // A change rebuilds the lit shaders, so it is only ever made as the preset changes or a match starts.
    for (let i = 0; i < HEADLIGHTS; i++) {
      const cast = this.headShadows === 'all' || (this.headShadows === 'own' && views.some((v) => v.viewer === i));
      const l = this.heads[i]!;
      if (l.castShadow !== cast) {
        l.castShadow = cast;
        if (!cast) {
          l.shadow.map?.dispose();
          l.shadow.map = null;
        }
      }
    }
    if (this.night) {
      for (const p of m.players) {
        const v = p.vehicle;
        // Each player's vehicle has its own headlight, so its beam's pattern stays its own.
        const i = p.id;
        if (!v || i >= HEADLIGHTS || v.z < -8 * 65536) continue;
        lit[i] = true;
        const b = BEAMS[v.kind];
        const a = radians(v.heading);
        const fx = Math.sin(a);
        const fz = -Math.cos(a);
        // A searchlight swings slowly to and fro across the way ahead (each player's at its own pace).
        const s = a + b.sweep * Math.sin(t * (0.45 + i * 0.07) + i * 1.7);
        const x = v.x / 65536;
        const y = v.y / 65536;
        const z = Math.max(0, v.z / 65536);
        const l = this.heads[i]!;
        l.intensity = b.power;
        l.color.setHex(b.colour);
        l.angle = b.angle;
        l.penumbra = b.soft;
        // The beam's shape rides on its reach (look.ts beamDistance), which the lit shaders read per light.
        l.distance = beamDistance(b.reach + 120 + z, b.shape);
        l.position.set(x + fx * b.from, z + b.height, y + fz * b.from);
        l.target.position.set(x + Math.sin(s) * b.reach, 0, y - Math.cos(s) * b.reach);
        l.target.updateMatrixWorld();
        l.updateMatrixWorld();
        // On the thermal camera shadows are not drawn, but a light must have drawn its shadow map once to be used.
        l.shadow.needsUpdate = l.castShadow && (!this.thermal || !l.shadow.map);
        const h = this.sea.heads;
        h.pos[i]!.copy(l.position);
        h.dir[i]!.copy(l.target.position).sub(l.position).normalize();
        const c = l.color;
        h.col[i]!.set(c.r, c.g, c.b).multiplyScalar(b.power / 260);
        h.cone[i]!.set(Math.cos(b.angle), Math.cos(b.angle * (1 - b.soft)), b.shape);
      }
    }
    for (let i = 0; i < HEADLIGHTS; i++) {
      if (lit[i]) continue;
      this.heads[i]!.intensity = 0;
      this.sea.heads.col[i]!.set(0, 0, 0);
    }
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

  private setWorld(world: World, later = false): void {
    this.world = world;
    this.warm = null;
    if (this.ground) {
      this.statics.remove(this.ground.group);
      this.ground.dispose();
    }
    this.marks.clear();
    this.ground = new Ground(this.assets, world, SUN, this.gl.capabilities.maxTextureSize >= 8192, this.sea, (shader) => lampLight(shader, this.lampMap.texture, this.glow), later);
    this.statics.add(this.ground.group);
    this.waterLight(this.ground.water.uniforms);
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (c) {
        this.statics.remove(c);
        disposeChunk(c);
      }
      this.chunks[i] = null;
      this.chunkBuilt[i] = false;
      this.chunkLamps[i] = [];
      for (const t of this.chunkPatches[i]!.values()) t.g.dispose();
      this.chunkPatches[i]!.clear();
    }
    this.tileRuns.clear();
    this.lampsStale = 'all';
    this.fx.clear();
    for (const rig of this.rigs.values()) this.dynamic.remove(rig.root);
    this.rigs.clear();
  }

  // ---- Buildings ----------------------------------------------------------------------------------------------

  /**
   * Builds the patches of the map not built yet, and swaps the buildings that changed. Given until (a
   * performance.now() time), it builds at least one new patch and stops building when that time has passed: false
   * while patches are left to build.
   */
  private syncChunks(world: World, until = Infinity): boolean {
    let left = false;
    let built = false;
    // The tiles whose buildings changed, for the ground's ambient occlusion.
    let ax0 = GRID;
    let ay0 = GRID;
    let ax1 = 0;
    let ay1 = 0;
    const changedTiles: number[] = [];
    for (let cy = 0; cy < CHUNKS; cy++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        // Every patch is built whole once, even with no buildings, for the garden's scatter. After that a building
        // that changes (destroyed, burnt, or a flag changing hands) is swapped on its own tile: rebuilding the whole
        // patch for it took a frame of 30-100 ms, a stutter at every blast that brought something down.
        const c = cy * CHUNKS + cx;
        const fresh = !this.chunkBuilt[c];
        if (fresh && built && performance.now() > until) {
          left = true;
          continue;
        }
        changedTiles.length = 0;
        for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
          for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
            const i = y * GRID + x;
            const b = world.building[i]!;
            const o = b ? world.owner[i]! : 0;
            if (b !== this.seenBuilding[i] || o !== this.seenOwner[i]) {
              this.seenBuilding[i] = b;
              this.seenOwner[i] = o;
              changedTiles.push(i);
            }
          }
        }
        if (!fresh && !changedTiles.length) continue;
        if (fresh) {
          this.buildChunk(world, c, cx, cy);
          built = true;
          ax0 = Math.min(ax0, cx * CHUNK);
          ay0 = Math.min(ay0, cy * CHUNK);
          ax1 = Math.max(ax1, (cx + 1) * CHUNK);
          ay1 = Math.max(ay1, (cy + 1) * CHUNK);
          continue;
        }
        this.patchChunk(world, c, changedTiles);
        for (const i of changedTiles) {
          const tx = i % GRID;
          const ty = Math.floor(i / GRID);
          ax0 = Math.min(ax0, tx);
          ay0 = Math.min(ay0, ty);
          ax1 = Math.max(ax1, tx + 1);
          ay1 = Math.max(ay1, ty + 1);
        }
      }
    }
    if (ART.ao && this.ground && ax1 > ax0) this.ground.paintAo(ax0, ay0, ax1, ay1, (tx, ty) => this.footOf(world, ty * GRID + tx));
    return !left;
  }

  /** Builds a patch of the map whole: its buildings merged into a mesh a material, and the garden's scatter. */
  private buildChunk(world: World, c: number, cx: number, cy: number): void {
    this.chunkBuilt[c] = true;
    const old = this.chunks[c];
    if (old) {
      this.statics.remove(old);
      disposeChunk(old);
      this.chunks[c] = null;
    }
    for (const g of this.chunkPatches[c]!.values()) g.g.dispose();
    this.chunkPatches[c]!.clear();
    const sets: TileGeometry[][] = [[], [], [], []];
    const lamps: Lamp[] = (this.chunkLamps[c] = []);
    for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
      for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
        const i = y * GRID + x;
        const lamp = this.tileLamp(world, i);
        if (lamp) lamps.push(lamp);
        const t = this.tileGeometry(world, i);
        if (t) sets[t.set]!.push(t);
      }
    }
    this.staleLamps(cx * CHUNK * TILE, cy * CHUNK * TILE, (cx + 1) * CHUNK * TILE, (cy + 1) * CHUNK * TILE);
    const group = new THREE.Group();
    sets.forEach((tiles, set) => {
      if (!tiles.length) return;
      const merged = mergeGeometries(tiles.map((t) => t.g), false);
      for (const t of tiles) t.g.dispose();
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, this.chunkMaterials[set]!);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      // Where each tile's building lies in the merged mesh, so it can be taken out on its own later.
      let start = 0;
      for (const t of tiles) {
        const count = t.g.getAttribute('position').count;
        this.tileRuns.set(t.tile, { mesh, start, count });
        start += count;
      }
    });
    const ground = this.ground;
    if (ground) {
      const blocked = (x: number, y: number) => world.building[Math.floor(y / TILE) * GRID + Math.floor(x / TILE)]! !== 0;
      for (const mesh of scatterPatch(cx * CHUNK * TILE, cy * CHUNK * TILE, (cx + 1) * CHUNK * TILE, (cy + 1) * CHUNK * TILE, (x, y) => ground.cover(x, y), blocked, this.stone, this.material)) group.add(mesh);
    }
    if (!group.children.length) return;
    this.chunks[c] = group;
    this.statics.add(group);
  }

  /**
   * Swaps the buildings of a few tiles of a built patch: each one's old shape in the merged mesh is folded away to a
   * point (a small upload), and what stands there now joins the patch's few changed tiles, kept as a mesh a
   * material of their own. The scatter stays as it was.
   */
  private patchChunk(world: World, c: number, tiles: readonly number[]): void {
    const patches = this.chunkPatches[c]!;
    for (const i of tiles) {
      const run = this.tileRuns.get(i);
      if (run) {
        foldAway(run.mesh.geometry, run.start, run.count);
        this.tileRuns.delete(i);
      }
      patches.get(i)?.g.dispose();
      patches.delete(i);
      const t = this.tileGeometry(world, i);
      if (t) patches.set(i, t);
      const tx = i % GRID;
      const ty = Math.floor(i / GRID);
      this.staleLamps(tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE);
    }
    // The patch's lamps again, without building anything.
    const cx = c % CHUNKS;
    const cy = Math.floor(c / CHUNKS);
    const lamps: Lamp[] = (this.chunkLamps[c] = []);
    for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
      for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
        const lamp = this.tileLamp(world, y * GRID + x);
        if (lamp) lamps.push(lamp);
      }
    }
    let group = this.chunks[c];
    if (!group) {
      group = new THREE.Group();
      this.chunks[c] = group;
      this.statics.add(group);
    }
    for (const o of [...group.children]) {
      if (!o.userData.patch) continue;
      group.remove(o);
      (o as THREE.Mesh).geometry.dispose();
    }
    const sets: THREE.BufferGeometry[][] = [[], [], [], []];
    for (const t of patches.values()) sets[t.set]!.push(t.g);
    sets.forEach((geos, set) => {
      if (!geos.length) return;
      const merged = geos.length === 1 ? geos[0]!.clone() : mergeGeometries(geos, false);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, this.chunkMaterials[set]!);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.patch = true;
      group.add(mesh);
    });
  }

  /** A tile's building's footprint about the tile's middle and its height, for ambient occlusion; null for none. */
  private footOf(world: World, i: number): { x0: number; y0: number; x1: number; y1: number; h: number } | null {
    const bid = world.building[i]!;
    if (!bid || bid === BROKEN_BRIDGE) return null;
    const def = world.defs[bid];
    const box = this.boxes[bid];
    if (!def || !box) return null;
    // Plants stand on a thin trunk and the bridge over water: neither shades the ground at its foot.
    if (/^(none|bush|palm|tree|cactus|stump|bridge|flag|flagBroken|light)$/.test(lookOf(def.name))) return null;
    return { x0: box.x0 + box.ox, y0: box.y0 + box.oy, x1: box.x1 + box.ox, y1: box.y1 + box.oy, h: box.h };
  }

  /** Where a tile's building stands (pixels): the tile's middle, moved by the map's jitter for its kind. */
  private tileSpot(world: World, i: number, def: { jitter: boolean }): { ox: number; oy: number } {
    const tx = i % GRID;
    const ty = Math.floor(i / GRID);
    let ox = tx * TILE + TILE / 2;
    let oy = ty * TILE + TILE / 2;
    if (def.jitter) {
      const e = ((ty & 15) << 4) + (tx & 15);
      ox += world.scenery[e * 2]!;
      oy += world.scenery[e * 2 + 1]!;
    }
    return { ox, oy };
  }

  /** The lamp a tile's building has lit at night, if any. */
  private tileLamp(world: World, i: number): Lamp | null {
    const bid = world.building[i]!;
    if (!bid || bid === BROKEN_BRIDGE) return null;
    const def = world.defs[bid];
    if (!def) return null;
    const lamp = lightOf(def.name, this.boxes[bid] ?? null);
    // Not every house has its lamp on: a street of them, every door lit, would be as bright as day.
    const home = lookOf(def.name) === 'house' && ((Math.imul(i, 2654435761) >>> 16) & 3) !== 0;
    if (!lamp || home) return null;
    const { ox, oy } = this.tileSpot(world, i, def);
    return { ...lamp, x: lamp.x + ox, y: lamp.y + oy };
  }

  /** A tile's building, built where it stands, and which of the patch's materials it takes. */
  private tileGeometry(world: World, i: number): TileGeometry | null {
    const bid = world.building[i]!;
    if (!bid) return null;
    const def = world.defs[bid];
    if (!def) return null;
    const owner = world.owner[i]!;
    const { ox, oy } = this.tileSpot(world, i, def);
    let kit: Kit | null;
    if (bid === BROKEN_BRIDGE) kit = brokenBridge(world, i);
    else kit = building(def, def.name, this.boxes[bid] ?? null, i);
    if (!kit) return null;
    const g = kit.build(owner < 0 ? NEUTRAL : this.paints[owner] ?? NEUTRAL);
    g.translate(ox, 0, oy);
    return { tile: i, g, set: kit.burnt ? 2 : kit.stone ? 3 : kit.toy ? 0 : 1 };
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
    // The bunker lifts. The hatch's two doors slide apart under the ground beside the shaft (they meet in the
    // middle when shut, so there is never a gap or a door left lying on the ground), the platform eases up or down
    // the shaft, and amber beacons at the shaft's corners turn while it moves. A hatch opening puffs dust out of the
    // shaft; a lift locking at the top kicks a little dust from its edges, and the vehicle settles on its springs as
    // it rolls off.
    const seenLifts = new Set<object>();
    for (const l of m.lifts) {
      if (l.phase === 'wait') continue;
      seenLifts.add(l);
      const tx = l.tile % GRID;
      const ty = Math.floor(l.tile / GRID);
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      const z = liftHeight(l.z, l.phase, this.part);
      const base = l.vehicle.base;
      const team = this.paints[base] ?? NEUTRAL;
      const was = this.liftSeen.get(l);
      if (was !== l.phase) {
        this.liftSeen.set(l, l.phase);
        // (By day: at night the dust would glow in the lamps' light it does not have.)
        if (!was && !this.night) for (let k = 0; k < 3; k++) this.fx.smokeAt(x + rand(-8, 8), y + rand(-8, 8), 0.5);
        if (l.phase === 'up' && !this.night) for (const [a, b] of [[-14, 0], [14, 0], [0, -14], [0, 14]] as const) this.fx.smokeAt(x + a, y + b, 0.5);
      }
      this.pool(`shaft`, () => this.mesh('shaft', V.liftShaft, NEUTRAL)).take().position.set(x, 0, y);
      // The platform's deck is level with its trim, so it is flush with the ground at the top.
      this.pool(`platform:${base}`, () => this.mesh(`platform:${base}`, V.liftPlatform, team)).take().position.set(x, z - 0.6, y);
      this.vehicle(l.vehicle, z, seen, dt, true);
      const slide = hatchSlide(l.doors, l.phase, this.part);
      if (slide < HATCH) {
        for (const s of [-1, 1]) {
          const door = this.pool('hatch', () => this.mesh('hatch', V.liftDoor, NEUTRAL)).take();
          door.position.set(x + s * slide, -1.4, y);
          door.rotation.set(0, s < 0 ? Math.PI : 0, 0);
        }
      }
      // The beacons flash round the shaft in turn while the lift moves.
      const beat = (performance.now() / 1000) * 2.2;
      ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([a, b], k) => {
        this.pool('beacon', () => this.mesh('beacon', V.liftBeacon, NEUTRAL)).take().position.set(x + a * 14.5, 0, y + b * 14.5);
        if ((beat + k / 4) % 1 > 0.5) return;
        const lens = this.pool('beaconlens', () => new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffb020 }))).take();
        lens.position.set(x + a * 14.5, 1.6, y + b * 14.5);
      });
    }
    for (const l of [...this.liftSeen.keys()]) if (!seenLifts.has(l)) this.liftSeen.delete(l);
    for (const [v, rig] of [...this.rigs]) {
      if (seen.has(v)) continue;
      this.dynamic.remove(rig.root);
      this.rigs.delete(v);
    }

    // Wrecks still moving, and the marks of those at rest.
    for (const w of m.wrecks) this.wreck(w.kind, w.base, w.x / 65536, w.y / 65536, w.z / 65536, w.heading, dt, w.model === 'body');
    // A free camera pulled back (a replay's) sees further, and draws further.
    const near = (x: number, y: number) => cams.some((c) => Math.abs(c.centreX - x) < 420 * c.reach() && Math.abs(c.pose().y - y) < 360 * c.reach());
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
        if (!this.chunkBuilt[cy * CHUNKS + cx]) continue;
        const x0 = cx * CHUNK * TILE;
        const y0 = cy * CHUNK * TILE;
        if (!cams.some((c) => {
          const r = c.reach();
          return c.centreX > x0 - 520 * r && c.centreX < x0 + CHUNK * TILE + 520 * r && c.pose().y > y0 - 460 * r && c.pose().y < y0 + CHUNK * TILE + 460 * r;
        })) continue;
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
              g.add(this.mesh(`${key}:head`, () => parts.head, team, this.playset));
              const b = new THREE.Group();
              b.position.set(0, 4 * (large ? 1.25 : 1), 0);
              b.add(this.mesh(`${key}:barrels`, () => parts.barrels, team, this.playset));
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
    // Gates: two barred leaves meeting in the middle of the tile, between posts just outside its edges on the line
    // of the wall. Opening, each leaf slides back into its post (the sim's opening, 0-15 px, the same as its
    // halves' collision shapes), eased so it pulls away gently and slows into its stop; a beacon on each post blinks
    // while the gate moves. A shut gate is a building on its tile; a moving one is the sim's Gate, so its posts are
    // drawn here too until it settles back into a building.
    const gates: { tile: number; bid: number; slide: number }[] = m.gates.map((g) => ({ tile: g.tile, bid: g.building, slide: gateSlide(g.opening, g.target, this.part) }));
    for (let i = 0; i < GRID * GRID; i++) {
      const bid = world.building[i]!;
      if (bid === GATE_H || bid === GATE_H + 1) gates.push({ tile: i, bid, slide: 0 });
    }
    const moving = new Map(m.gates.map((g) => [g.tile, g]));
    const blink = Math.floor(performance.now() / 260) % 2 === 0;
    for (const { tile: i, bid, slide } of gates) {
      const owner = world.owner[i]!;
      const team = owner < 0 ? NEUTRAL : this.paints[owner] ?? NEUTRAL;
      const cx = (i % GRID) * TILE + TILE / 2;
      const cy = Math.floor(i / GRID) * TILE + TILE / 2;
      const across = bid === GATE_H;
      const g = moving.get(i);
      if (g) {
        const def = world.defs[bid];
        const key = `gateposts:${bid}:${owner}`;
        const posts = def && this.pool(key, () => this.mesh(key, () => building(def, def.name, this.boxes[bid] ?? null, i) ?? new Kit(), team, playset(def.name) ? this.playset : this.material)).take();
        posts?.position.set(cx, 0, cy);
        // The beacons blink while the leaves move, and while it waits to settle once shut.
        if (blink && (g.opening !== g.target || g.opening === 0)) {
          for (const s of [-1, 1]) {
            const lamp = this.pool('gatelamp', () => new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 5), new THREE.MeshBasicMaterial({ color: 0xffa020 }))).take();
            lamp.position.set(cx + (across ? s * GATE_POST : 0), 21, cy + (across ? 0 : s * GATE_POST));
          }
        }
      }
      for (const s of [-1, 1]) {
        const leaf = this.pool(`leaf:${owner}`, () => this.mesh(`leaf:${owner}`, () => gateLeaf(GATE_LEAF), team, this.playset)).take();
        // Each leaf runs from its post's side (16 px out) to the middle, slid back by the opening.
        const from = s * (GATE_LEAF + slide);
        if (across) {
          leaf.position.set(cx + from, 0, cy);
          leaf.rotation.set(0, s < 0 ? 0 : Math.PI, 0);
        } else {
          leaf.position.set(cx, 0, cy + from);
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
      const o = this.pool(`flag:${f.base}`, () => this.mesh(`flag:${f.base}`, () => new Kit(true)
        .cyl(0, 0, 0, 0.5, 0.6, 20, 0xd8d8d8, 6).ball(0, 0, 20.3, 0.9, 0xe0b81c, 1)
        .box(4.5, 0, 13.5, 9, 0.5, 6, 'team'), team, this.playset)).take();
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
    // Rolled off a lift that has just locked at the top: it dips once on its springs and settles.
    if (rig.lifted && !onLift && liftZ === 0) rig.settle = 0;
    rig.lifted = onLift;
    if (rig.settle < 0.6 && v.kind !== 'heli') {
      rig.settle += dt;
      rig.root.position.y -= Math.sin(rig.settle * 16) * Math.exp(-rig.settle * 7) * 0.7;
    }
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
    // In the shallows a ground vehicle sits down in the water, and a floating jeep rides low on its tyres.
    if (v.kind !== 'heli') {
      const wade = onLift || v.ground === LAND ? 0 : v.ground === DEEP ? (v.tyres ? 2.6 : 0) : WAKES[v.kind].wade;
      rig.wade += Math.sign(wade - rig.wade) * Math.min(Math.abs(wade - rig.wade), dt * 8);
      rig.root.position.y -= rig.wade;
    }
    // A badly hit vehicle smokes.
    const max = VEHICLES[v.kind].health;
    if (v.health < max * 0.4 && z > -4) this.fx.trail(v.x / 65536, v.y / 65536, z + 4, v.health < max * 0.2, dt);
  }

  /**
   * What the vehicles do to the water this frame. In the shallows a ground vehicle leaves lines of foam and silt
   * behind its wheels or tracks, pushes a bow wave out to the sides and throws up spray, each kind its own way
   * (WAKES); a jeep floating in deep water leaves a V of foam and a wash behind it; a vehicle going under boils the
   * water with bubbles; one standing still sends out slow rings. A helicopter low over water flattens and roughens
   * it under the rotor and blows rings, chop and spray out across it. Swimmers and the surfacing sub ripple it.
   */
  private waterFx(m: Match, dt: number): void {
    const world = this.world;
    if (!world || dt <= 0) return;
    const w = this.marks;
    const pace = Math.min(1, dt * 60);
    const lifted = new Set(m.lifts.map((l) => l.vehicle));
    for (const pl of m.players) {
      const v = pl.vehicle;
      const rig = v && this.rigs.get(v);
      if (!v || !rig || lifted.has(v)) continue;
      const x = v.x / 65536;
      const y = v.y / 65536;
      if (v.kind === 'heli') {
        this.downwash(v, x, y, dt);
        continue;
      }
      if (v.ground === LAND) continue;
      const a = radians(v.heading);
      const fx = Math.sin(a);
      const fy = -Math.cos(a);
      const rx = Math.cos(a);
      const ry = Math.sin(a);
      const speed = (v.speed / 65536) * TICKS;
      const sp = Math.abs(speed);
      // Which way is behind it as it goes: its back, or its front when reversing.
      const back = speed >= 0 ? 1 : -1;
      const k = WAKES[v.kind];
      rig.ringIn -= dt;
      if (v.ground === DEEP && !v.tyres) {
        // Going under: the water boils with air coming up.
        if (Math.random() < dt * 24) w.stamp(x + rand(-8, 8), y + rand(-8, 8), rand(4, 10), 0.6, 0.5, 0.1);
        if (Math.random() < dt * 12) this.fx.bubbles(x + rand(-6, 6), y + rand(-6, 6));
        if (rig.ringIn <= 0) {
          w.ring(x + rand(-4, 4), y + rand(-4, 4), 0.55, 22, 1.4);
          rig.ringIn = 0.22;
        }
        continue;
      }
      if (sp < 4) {
        // Standing in the water: it laps round the vehicle.
        if (rig.ringIn <= 0) {
          w.ring(x, y, 0.22, 14, 1.8);
          rig.ringIn = 1.1;
        }
        continue;
      }
      const t = Math.min(1, sp / k.fast);
      const sx = x - fx * back * k.back;
      const sy = y - fy * back * k.back;
      const bx = x + fx * back * k.back;
      const by = y + fy * back * k.back;
      if (v.ground === SHALLOW) {
        for (const s of [-1, 1]) {
          const wx = sx + rx * s * k.half;
          const wy = sy + ry * s * k.half;
          w.stamp(wx, wy, k.line, k.foam * t * pace, k.chop * t * pace, k.silt * pace);
          if (Math.random() < dt * k.spray * t) {
            this.fx.spray(wx, wy, -fx * back * sp * (v.kind === 'asv' ? 0.6 : 0.3) + rx * s * rand(4, 14), -fy * back * sp * (v.kind === 'asv' ? 0.6 : 0.3) + ry * s * rand(4, 14), v.kind === 'asv' ? rand(50, 85) : rand(30, 60), k.muddy, v.kind === 'tank' ? 2.6 : 1.8);
          }
          // The bow wave, pushed out to the sides.
          if (Math.random() < dt * 16 * t) {
            w.patch({
              x: bx + rx * s * k.half, y: by + ry * s * k.half, vx: rx * s * (8 + sp * 0.35), vy: ry * s * (8 + sp * 0.35),
              life: rand(0.9, 1.3), s0: 3, s1: 9, foam: k.bow, chop: 0.6, silt: k.silt * 0.4, drag: 0.25,
            });
          }
        }
      } else {
        // A jeep floating on its tyres: a V of foam spreading out behind it, and a wash where it has been.
        if (Math.random() < dt * 36) {
          for (const s of [-1, 1]) {
            w.patch({
              x: sx + rx * s * 5, y: sy + ry * s * 5, vx: rx * s * (5 + sp * 0.3), vy: ry * s * (5 + sp * 0.3),
              life: rand(1.4, 1.9), s0: 2.5, s1: 5.5, foam: 0.4, chop: 0.7, silt: 0, drag: 0.55,
            });
          }
        }
        w.stamp(sx, sy, 6, 0.45 * t * pace, 0.55 * t * pace, 0);
        if (Math.random() < dt * 16 * t) this.fx.spray(bx, by, rx * rand(-12, 12), ry * rand(-12, 12), rand(18, 34), false, 1.4);
      }
      if (rig.ringIn <= 0) {
        w.ring(bx, by, 0.2 + 0.3 * t, 30, 1.2);
        rig.ringIn = 0.3;
      }
    }
    // Swimmers paddling.
    for (const s of m.soldiers) if (s.water && Math.random() < dt * 1.4) w.ring(s.x / 65536, s.y / 65536, 0.18, 12, 1.3);
    // The sub coming up or going down: the water boils over it.
    if (m.sub) {
      const f = subFrame(m.sub);
      if (f >= 0 && f < 20 && Math.random() < dt * 10) {
        const x = m.sub.x / 65536 + rand(-10, 10);
        const y = m.sub.y / 65536 + rand(-10, 10);
        w.stamp(x, y, rand(6, 12), 0.7, 0.6, 0);
        if (Math.random() < 0.3) w.ring(x, y, 0.45, 24, 1.5);
      }
    }
  }

  /**
   * A helicopter's downwash over water, stronger the lower it is (it shows at its cruising height of 50 px and is
   * gone by about 100): the water under the rotor pressed flat and roughened, and air rushing out across the surface
   * in rings of chop, foam and spray.
   */
  private downwash(v: Vehicle, x: number, y: number, dt: number): void {
    const h = v.heli;
    if (!h || !this.world) return;
    const z = v.z / 65536;
    const spin = h.rotorSpeed / 0x40000;
    const s = spin * Math.min(1, Math.max(0, (100 - z) / 55));
    if (s < 0.05 || groundAt(this.world, v.x, v.y, 0) === LAND) return;
    const w = this.marks;
    const pace = Math.min(1, dt * 60);
    const r0 = 3 + z * 0.12;
    w.stamp(x, y, 16 + z * 0.35, 0.012 * s * pace, 0.3 * s * pace, 0);
    w.stamp(x, y, 26 + z * 0.5, 0.02 * s * pace, 0.2 * s * pace, 0, true);
    const n = dt * 70 * s;
    for (let i = 0; i < n || Math.random() < n - i; i++) {
      const a = Math.random() * Math.PI * 2;
      const c = Math.cos(a);
      const d = Math.sin(a);
      const out = rand(40, 70) * (0.6 + 0.4 * s);
      w.patch({ x: x + c * r0, y: y + d * r0, vx: c * out, vy: d * out, life: rand(0.55, 0.95), s0: 3, s1: 8, foam: 0.1 * s, chop: 0.9 * s, silt: 0, drag: 0.3 });
      if (i > 60) break;
    }
    const rig = this.rigs.get(v);
    if (rig) {
      rig.ringIn -= dt;
      if (rig.ringIn <= 0) {
        w.ring(x, y, 0.5 * s, 42, 1.1);
        rig.ringIn = 0.2;
      }
    }
    this.fx.mist(x, y, s, dt);
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
    rig = { root, body, wheels: [], inflate: v.tyres ? 1 : 0, wade: 0, ringIn: 0, lifted: false, settle: 9 };
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
    // A body still flying from the blast is the toy as it was; one at rest has melted in the fire.
    const key = `wreck:${kind}:${base}:${body ? 'body' : 'melt'}`;
    const o = this.pool(key, () => {
      if (body) return this.mesh(`${kind}:${base}:body`, () => VEHICLE_KITS[kind]().body, team, this.hot);
      const m = new THREE.Mesh(this.meltGeometry(kind, base), this.charred);
      m.castShadow = m.receiveShadow = true;
      return m;
    }).take() as THREE.Mesh;
    o.position.set(x, z, y);
    o.rotation.set(0, -radians(heading), 0);
    this.fx.trail(x, y, z, !body, dt);
  }

  /** A burnt-out wreck's shape: the vehicle's body melted in the fire (worked out once a kind and base). */
  private meltGeometry(kind: VehicleKind, base: number): THREE.BufferGeometry {
    return this.geometry(`${kind}:${base}:melt`, () => {
      const team = this.paints[base] ?? NEUTRAL;
      Kit.fine = true;
      const whole = VEHICLE_KITS[kind]().body.build(team);
      Kit.fine = false;
      const out = melted(whole, base + kind.length);
      whole.dispose();
      return out;
    });
  }

  // ---- Getting ready ------------------------------------------------------------------------------------------

  /**
   * What a vehicle's destruction needs that is otherwise made the moment it happens, a stutter of a frame or two:
   * the skull screen (its models and shaders), the explosion's effects, and each side's melted wrecks. Made one
   * piece a frame early in the match, mostly while the bunker shows.
   */
  private warm: (() => void)[] | null = null;

  private warmUp(m: Match): void {
    this.warmList(m).shift()?.();
  }

  /**
   * Gets the whole of a match ready while its loading screen is up (the canvas is off the page), a slice at a time so
   * the loading screen keeps moving: the ground painted and every patch of buildings built, then each of frames
   * staged, its shaders compiled (in the background, where the browser can: KHR_parallel_shader_compile) and drawn
   * once, for the 3D world, the bunker and skull screens, every model and the shaders for each look, then the last of
   * the pieces warmUp makes. step is awaited between slices and gives the loading screen its frame; the look is left
   * as it was.
   */
  async prepare(frames: readonly { m: Match; views: readonly ModernView[]; thermal?: boolean }[], step: () => Promise<void>): Promise<void> {
    const none = { wrecks: [], splats: [] };
    const drone = this.feed;
    const thermal = this.thermal;
    let until = performance.now() + SLICE_MS;
    /** A breath once this slice's time is used up. */
    const pause = async () => {
      if (performance.now() < until) return;
      await step();
      until = performance.now() + SLICE_MS;
    };
    /** A breath now, once the shaders under way are ready. */
    const settle = async () => {
      const jobs = this.compiling!.splice(0);
      if (jobs.length) await Promise.all(jobs);
      await step();
      until = performance.now() + SLICE_MS;
    };
    this.compiling = [];
    try {
      const first = frames[0]?.m;
      if (first) {
        if (first.world !== this.world) {
          this.setWorld(first.world, true);
          await this.ground!.paintIn(pause);
        }
        while (!this.syncChunks(first.world, until)) {
          await step();
          until = performance.now() + SLICE_MS;
        }
        await step();
        await this.ground!.upload(this.gl, step);
        await settle();
      }
      // The bunker's and the skull's screens are made each in a slice of their own.
      this.bunker ??= new BunkerScene();
      await settle();
      this.skull ??= new SkullScene();
      await settle();
      for (const f of frames) {
        this.setLook(drone, f.thermal ?? thermal);
        this.stage(f.m, f.views, none, performance.now());
        this.compileFor(f.views);
        await settle();
        this.draw(f.m, f.views, none);
        await settle();
      }
      const list = first ? this.warmList(first) : [];
      while (list.length) {
        list.shift()!();
        await settle();
      }
    } finally {
      this.compiling = null;
      this.setLook(drone, thermal);
    }
  }

  /**
   * While prepare runs, the shaders being compiled in the background (precompile adds to it), awaited between
   * slices; null otherwise, when precompile compiles at once.
   */
  private compiling: Promise<unknown>[] | null = null;

  /** Compiles the shaders a scene needs: in the background while prepare runs, else at once. */
  private precompile(scene: THREE.Object3D, camera: THREE.Camera, target: THREE.Scene | null = null): void {
    if (this.compiling) this.compiling.push(this.gl.compileAsync(scene, camera, target));
    else this.gl.compile(scene, camera, target);
  }

  /** The shaders a picture of views needs, as stage left the world: the map's, its look's and each screen's. */
  private compileFor(views: readonly ModernView[]): void {
    const field = views.filter((v) => !v.skip);
    if (field.length) {
      // The whole scene, whatever the cameras take in.
      this.place(field[0]!.cam, field[0]!.rect);
      this.precompile(this.scene, this.camera);
    }
    const pass = (this.pass ??= new LookPass(MODERN_W, MODERN_H));
    for (const v of views) {
      const sc = v.screen;
      if (sc?.kind === 'bunker') {
        const b = this.bunkerFor(sc, v.rect);
        this.precompile(b.scene, b.camera);
      } else if (sc?.kind === 'skull') {
        const k = this.skullFor(sc, v.rect);
        this.precompile(k.dim, k.camera);
        this.precompile(k.scene, k.camera);
      }
    }
    pass.compile((scene, camera) => this.precompile(scene, camera));
  }

  private warmList(m: Match): (() => void)[] {
    if (!this.warm) {
      const kinds: VehicleKind[] = ['jeep', 'tank', 'asv', 'heli'];
      const bases = [...new Set(m.players.map((p) => p.base))];
      this.warm = [
        () => {
          const k = (this.skull ??= new SkullScene());
          k.frame(MODERN_W / MODERN_H);
          k.update(skullLook(1), this.paints[bases[1] ?? 0] ?? NEUTRAL, this.paints[bases[0] ?? 0] ?? NEUTRAL, 'tank', 1, 3);
          this.precompile(k.scene, k.camera);
          this.precompile(k.dim, k.camera);
        },
        () => {
          // Far off the map, where nobody sees it: its particles, smoke, scorch marks and shards go through the
          // shaders once. Compiled as part of the whole scene: the effects' own flash lights, counted a second time
          // when they were compiled on their own, made shaders for 8 lights where the picture has 4, and the first
          // real scorch mark still stopped the picture to make its own.
          this.fx.explosion(-4000, -4000, 2, 1.5, { scorch: true, chunks: [new THREE.Color(0x6b8f3a)], smokeFor: 0.5 });
          this.precompile(this.scene, this.camera);
        },
        ...bases.flatMap((b) => kinds.map((kind) => () => {
          const mesh = new THREE.Mesh(this.meltGeometry(kind, b), this.charred);
          mesh.castShadow = mesh.receiveShadow = true;
          const scratch = new THREE.Scene().add(mesh);
          this.precompile(scratch, this.camera, this.scene);
        })),
      ];
    }
    return this.warm;
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
    this.lights.dispose();
    this.ground?.dispose();
    this.pass?.dispose();
    this.marks.dispose();
    for (const c of this.chunks) if (c) disposeChunk(c);
    for (const p of this.chunkPatches) for (const t of p.values()) t.g.dispose();
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

/** The playset buildings' plastic: the toys' moulding, a touch rougher and with less clear coat on its big walls. */
function playsetPlastic(): THREE.MeshPhysicalMaterial {
  const m = toyPlastic();
  m.roughness = 0.4;
  m.clearcoat = 0.25;
  return m;
}

/** A tile's building built where it stands, and which of a patch's materials it takes (renderer.chunkMaterials). */
interface TileGeometry {
  tile: number;
  g: THREE.BufferGeometry;
  set: number;
}

/**
 * Folds a run of a merged mesh's vertices onto its first, so the triangles there have no area and draw nothing, and
 * uploads only that run.
 */
function foldAway(g: THREE.BufferGeometry, start: number, count: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const a = pos.array;
  const s = start * 3;
  for (let k = s + 3; k < s + count * 3; k += 3) {
    a[k] = a[s]!;
    a[k + 1] = a[s + 1]!;
    a[k + 2] = a[s + 2]!;
  }
  pos.addUpdateRange(s, count * 3);
  pos.needsUpdate = true;
}

function disposeChunk(c: THREE.Group): void {
  for (const o of c.children) {
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (!o.userData.shared) (o as THREE.Mesh).geometry.dispose();
  }
}
