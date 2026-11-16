// The vehicles' own small lights in the modern view: lamp glass, tail lights, navigation lights and beacons, each
// vehicle with the set its kind would carry. They are glows, not lights: one batch of points drawn in a single call
// over the scene (a lit core and a soft halo each), so they cost next to nothing however many vehicles there are.
// The beam each player's vehicle throws on the ground is the renderer's one real spotlight for it (BEAMS).
//
//   jeep  twin headlamps, red tail lights that brighten as it brakes or backs up
//   tank  hooded blackout headlamps, small convoy tail lamps
//   ASV   navigation lights (red to port, green to starboard), white masthead and stern lights, a searchlight lens
//   heli  a red anti-collision beacon on the tail fin that flashes (by day too), a white tail strobe, red and green
//         navigation lights on the stub wings, and the searchlight under the nose
//
// Positions are in the kits' own units (vehicles.ts: x across, y back from the nose, z up), on the body or turret.

import * as THREE from 'three';
import type { VehicleKind } from '@rfw/sim';

/** How a light shows over time: 1 is fully on. t is seconds, seed spreads vehicles apart so no two flash together. */
type Pattern = 'steady' | 'beacon' | 'strobe' | 'brake';

interface Marker {
  at: [number, number, number];
  part?: 'body' | 'turret';
  colour: number;
  /** Across the halo, game pixels. */
  size: number;
  pattern?: Pattern;
  /** How bright it shows by day (0: night only). */
  day?: number;
}

const HEAD = 0xfff1c8;
const RED = 0xff2414;
const GREEN = 0x30ff70;
const WHITE = 0xf4f8ff;

export const MARKERS: Record<VehicleKind, Marker[]> = {
  jeep: [
    { at: [-3.2, -11.2, 3.6], colour: HEAD, size: 14 },
    { at: [3.2, -11.2, 3.6], colour: HEAD, size: 14 },
    { at: [-4.3, 10.3, 3.4], colour: RED, size: 8, pattern: 'brake' },
    { at: [4.3, 10.3, 3.4], colour: RED, size: 8, pattern: 'brake' },
  ],
  tank: [
    // Hooded: small and dim, the slit of light under each hood.
    { at: [-4.6, -12.2, 4.2], colour: 0xffd690, size: 8 },
    { at: [4.6, -12.2, 4.2], colour: 0xffd690, size: 8 },
    { at: [-3.5, 11.3, 3], colour: RED, size: 6, pattern: 'brake' },
    { at: [3.5, 11.3, 3], colour: RED, size: 6, pattern: 'brake' },
  ],
  asv: [
    { at: [-7.6, -10.5, 7.4], colour: RED, size: 8 },
    { at: [7.6, -10.5, 7.4], colour: GREEN, size: 8 },
    { at: [-3.5, -6.5, 9.8], colour: WHITE, size: 8 },
    { at: [0, 12.6, 5.6], colour: WHITE, size: 7 },
    { at: [-3.5, -9.6, 8.4], colour: 0xdce8ff, size: 12 },
  ],
  heli: [
    { at: [0, 28.6, 11.9], colour: RED, size: 26, pattern: 'beacon', day: 0.7 },
    { at: [0, 30.4, 8.2], colour: WHITE, size: 14, pattern: 'strobe', day: 0.6 },
    { at: [-10.3, 0, 5.6], colour: RED, size: 8 },
    { at: [10.3, 0, 5.6], colour: GREEN, size: 8 },
    { at: [0, -10.4, 2.4], colour: WHITE, size: 14 },
  ],
};

/** A short sharp flash, fading fast, phase seconds after it fired (0 before). */
const flash = (phase: number, at: number) => (phase < at ? 0 : Math.exp(-(phase - at) * 16));

/** The gallery's &flash=1: every beacon and strobe caught at the top of its flash, for screenshots. */
export const LIGHTS_SHOW = { flash: false };

function shine(pattern: Pattern, t: number, seed: number, braking: number): number {
  switch (pattern) {
    case 'beacon': {
      if (LIGHTS_SHOW.flash) return 1;
      // A double flash every 1.3 seconds, as an aircraft's anti-collision light.
      const p = (t / 1.3 + seed) % 1;
      return Math.max(flash(p * 1.3, 0), flash(p * 1.3, 0.2));
    }
    case 'strobe': {
      if (LIGHTS_SHOW.flash) return 1.4;
      const p = (t / 1.3 + seed + 0.5) % 1;
      return flash(p * 1.3, 0) * 1.4;
    }
    case 'brake':
      return 0.45 + braking;
    default:
      return 1;
  }
}

const MAX = 128;

/** The parts of a vehicle's rig a light can sit on. */
export interface LightRig {
  root: THREE.Object3D;
  body: THREE.Object3D;
  turret?: THREE.Object3D;
}

export class VehicleLights {
  readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos = new Float32Array(MAX * 3);
  private readonly tint = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly material: THREE.ShaderMaterial;
  private count = 0;
  /** Each vehicle's speed when last seen and how hard it brakes now (eased), for the tail lights. */
  private readonly brakes = new WeakMap<object, { speed: number; braking: number; level: number; seed: number }>();
  private readonly v = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute vec3 tint;
        attribute float size;
        uniform float scale;
        varying vec3 vTint;
        void main() {
          vTint = tint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Drawn a little toward the camera, so the lamp's own glass does not hide its glow.
          mv.xyz += normalize(-mv.xyz) * 3.0;
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vTint;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r2 = dot(d, d) * 4.0;
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 45.0);
          float halo = exp(-r2 * 5.0) * (1.0 - r2);
          // A white-hot centre in the colour's halo, as a bright lamp shows on a camera.
          vec3 c = vTint * (core * 1.6 + halo * 0.55) + vec3(core) * 0.9 * max(vTint.r, max(vTint.g, vTint.b));
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** Points are sized in game pixels: on screen a point's size is size * f / depth (as the effects' points). */
  setScale(pixelsPerUnitAtOne: number): void {
    this.material.uniforms.scale!.value = pixelsPerUnitAtOne;
  }

  /**
   * Puts every vehicle's lights where its rig now stands. night is 0 by day and 1 at night; t is seconds. A rig
   * whose transforms were set this frame has its matrices brought up to date here.
   */
  update(rigs: Iterable<[{ kind: VehicleKind; speed: number }, LightRig]>, night: boolean, t: number, dt: number): void {
    this.count = 0;
    for (const [v, rig] of rigs) {
      // Down in a lift's shaft: the glows would show through the ground.
      if (!rig.root.visible || rig.root.position.y < -6) continue;
      let b = this.brakes.get(v);
      if (!b) this.brakes.set(v, (b = { speed: v.speed, braking: 0, level: 0, seed: Math.random() }));
      // Braking: slowing down, or backing up, judged as the speed changes (a tick), not every frame. Brought to a
      // stop, it stays on the brakes until it moves off again.
      if (v.speed !== b.speed) {
        b.braking = Math.abs(v.speed) < Math.abs(b.speed) - 600 || v.speed < 0 ? 1 : 0;
        b.speed = v.speed;
      }
      b.level += (b.braking - b.level) * Math.min(1, dt * (b.braking ? 14 : 4));
      rig.root.updateWorldMatrix(true, true);
      for (const mk of MARKERS[v.kind]) {
        const level = night ? 1 : mk.day ?? 0;
        if (level <= 0 || this.count >= MAX) continue;
        const on = level * shine(mk.pattern ?? 'steady', t, b.seed, b.level);
        if (on < 0.02) continue;
        const part = mk.part === 'turret' && rig.turret ? rig.turret : rig.body;
        this.v.set(mk.at[0], mk.at[2], mk.at[1]).applyMatrix4(part.matrixWorld);
        const i = this.count++;
        this.pos[i * 3] = this.v.x;
        this.pos[i * 3 + 1] = this.v.y;
        this.pos[i * 3 + 2] = this.v.z;
        this.c.setHex(mk.colour);
        this.tint[i * 3] = this.c.r * on;
        this.tint[i * 3 + 1] = this.c.g * on;
        this.tint[i * 3 + 2] = this.c.b * on;
        this.size[i] = mk.size * (mk.pattern === 'brake' ? 0.85 + 0.3 * b.level : 1);
      }
    }
    this.geo.setDrawRange(0, this.count);
    for (const name of ['position', 'tint', 'size']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.points.visible = this.count > 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
