// The modern view's effects, made from the match's events (the same events the retro effects and sounds follow):
// glowing fireballs, sparks and muzzle flashes (added light), smoke and dust (blended), tumbling chunks of debris,
// scorch marks on the ground and short flashes of light on everything near a blast. None of it touches the game.

import * as THREE from 'three';
import { THERMAL } from './look.js';

const MAX_POINTS = 4000;
const MAX_CHUNKS = 600;
const MAX_SCORCH = 48;
const FLASH_LIGHTS = 4;
const GRAVITY = 160;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Seconds lived and to live. */
  age: number; life: number;
  size0: number; size1: number;
  r: number; g: number; b: number;
  alpha: number;
  /** Drag per second (fraction kept), and upward drift for smoke. */
  drag: number; rise: number;
  gravity: number;
}

interface Chunk {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; spin: number; rot: number;
  size: number; age: number; life: number;
  colour: THREE.Color;
}

interface Emitter {
  x: number; y: number; z: number;
  until: number;
  every: number;
  next: number;
  kind: 'smoke' | 'fire';
}

/** A soft round spot texture for the particles. */
function spotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function scorchTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(20,16,12,0.85)');
  grad.addColorStop(0.6, 'rgba(30,24,18,0.5)');
  grad.addColorStop(1, 'rgba(30,24,18,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** One batch of points drawn in one call: positions in three.js axes, a colour, alpha and size each. */
class PointBatch {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX_POINTS * 3);
  private readonly col = new Float32Array(MAX_POINTS * 4);
  private readonly size = new Float32Array(MAX_POINTS);
  private readonly geo = new THREE.BufferGeometry();
  readonly material: THREE.ShaderMaterial;
  count = 0;

  constructor(texture: THREE.Texture, additive: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 400 }, thermal: THERMAL },
      vertexShader: /* glsl */ `
        attribute vec4 tint;
        attribute float size;
        uniform float scale;
        varying vec4 vTint;
        void main() {
          vTint = tint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform float thermal;
        varying vec4 vTint;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vTint.a;
          // Smoke hardly shows on the thermal camera; fire burns white.
          ${additive ? '' : 'a *= 1.0 - thermal * 0.7;'}
          if (a < 0.01) discard;
          gl_FragColor = vec4(vTint.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  reset(): void {
    this.count = 0;
  }

  push(p: Particle, t: number): void {
    if (this.count >= MAX_POINTS) return;
    const i = this.count++;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.z;
    this.pos[i * 3 + 2] = p.y;
    const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    this.col[i * 4] = p.r;
    this.col[i * 4 + 1] = p.g;
    this.col[i * 4 + 2] = p.b;
    this.col[i * 4 + 3] = p.alpha * Math.max(0, Math.min(1, fade));
    this.size[i] = p.size0 + (p.size1 - p.size0) * t;
  }

  commit(): void {
    this.geo.setDrawRange(0, this.count);
    for (const name of ['position', 'tint', 'size']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Fx {
  readonly group = new THREE.Group();
  private readonly glow: PointBatch;
  private readonly smoke: PointBatch;
  private readonly hot: Particle[] = [];
  private readonly soft: Particle[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly chunkMesh: THREE.InstancedMesh;
  private readonly emitters: Emitter[] = [];
  private readonly scorch: THREE.Mesh[] = [];
  private scorchNext = 0;
  private readonly lights: { light: THREE.PointLight; age: number; life: number; power: number }[] = [];
  private lightNext = 0;
  private now = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  constructor() {
    const spot = spotTexture();
    this.glow = new PointBatch(spot, true);
    this.smoke = new PointBatch(spot, false);
    this.group.add(this.smoke.points, this.glow.points);
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.chunkMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAX_CHUNKS);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.castShadow = true;
    this.chunkMesh.count = 0;
    this.chunkMesh.frustumCulled = false;
    this.group.add(this.chunkMesh);
    const scorchMat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let i = 0; i < MAX_SCORCH; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), scorchMat.clone());
      m.rotateX(-Math.PI / 2);
      m.visible = false;
      m.renderOrder = 1;
      this.scorch.push(m);
      this.group.add(m);
    }
    for (let i = 0; i < FLASH_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 160, 1.6);
      this.lights.push({ light, age: 1, life: 1, power: 0 });
      this.group.add(light);
    }
  }

  /** The point batches size their points for the view's height in pixels and its focal length. */
  setScale(pixelsPerUnitAtOne: number): void {
    this.glow.material.uniforms.scale!.value = pixelsPerUnitAtOne;
    this.smoke.material.uniforms.scale!.value = pixelsPerUnitAtOne;
  }

  // ---- What the events make -----------------------------------------------------------------------------------

  muzzle(x: number, y: number, z: number, big: boolean): void {
    this.fire(x, y, z, big ? 7 : 4, 0.08, 1, 0.9, 0.5);
    this.puff(x, y, z, big ? 3 : 1, 0.6, [0.75, 0.75, 0.72], 4, 9);
  }

  explosion(x: number, y: number, z: number, scale: number, opts: { scorch?: boolean; chunks?: THREE.Color[]; smokeFor?: number } = {}): void {
    const n = Math.round(10 * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(10, 40) * scale;
      this.hot.push({
        x: x + rand(-2, 2) * scale, y: y + rand(-2, 2) * scale, z: z + rand(1, 4) * scale,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(10, 45) * scale,
        age: 0, life: rand(0.35, 0.7), size0: rand(6, 10) * scale, size1: rand(14, 22) * scale,
        r: 1, g: rand(0.45, 0.75), b: rand(0.1, 0.25), alpha: 1, drag: 0.15, rise: 10, gravity: 0,
      });
    }
    for (let i = 0; i < n * 1.5; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(40, 120) * Math.sqrt(scale);
      this.hot.push({
        x, y, z: z + 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(30, 110) * Math.sqrt(scale),
        age: 0, life: rand(0.3, 0.8), size0: 2, size1: 0.6, r: 1, g: 0.85, b: 0.4, alpha: 1, drag: 0.5, rise: 0, gravity: GRAVITY,
      });
    }
    this.puff(x, y, z + 3, Math.round(8 * scale), 1.8, [0.28, 0.26, 0.25], 10 * scale, 28 * scale);
    this.flash(x, y, z + 8, 3 * scale);
    if (opts.scorch) this.mark(x, y, 18 * scale);
    if (opts.chunks) this.debris(x, y, z, opts.chunks, Math.round(8 * scale), scale);
    if (opts.smokeFor) this.emitters.push({ x, y, z: z + 4, until: this.now + opts.smokeFor, every: 0.12, next: this.now, kind: 'smoke' });
  }

  dirt(x: number, y: number): void {
    this.puff(x, y, 1, 5, 0.9, [0.62, 0.5, 0.36], 5, 12, 25);
    this.fire(x, y, 2, 4, 0.1, 1, 0.8, 0.4);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      this.soft.push({
        x, y, z: 1, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, vz: rand(40, 80), age: 0, life: 0.7, size0: 2.2, size1: 1.6,
        r: 0.5, g: 0.38, b: 0.25, alpha: 1, drag: 0.6, rise: 0, gravity: GRAVITY,
      });
    }
  }

  splash(x: number, y: number, big: boolean): void {
    const n = big ? 26 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(8, big ? 40 : 22);
      this.soft.push({
        x, y, z: 0, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(40, big ? 120 : 75), age: 0, life: rand(0.6, 1),
        size0: big ? 5 : 3, size1: big ? 8 : 5, r: 0.92, g: 0.97, b: 1, alpha: 0.9, drag: 0.5, rise: 0, gravity: GRAVITY,
      });
    }
    this.puff(x, y, 1, big ? 8 : 3, 1.2, [0.85, 0.93, 0.97], big ? 8 : 4, big ? 26 : 12);
  }

  /** Air rushing out of (or into) the jeep's tyres. */
  tyres(x: number, y: number): void {
    this.puff(x, y, 3, 10, 0.7, [0.95, 0.97, 1], 2, 9, 30);
  }

  sparkle(x: number, y: number, colour: [number, number, number]): void {
    for (let i = 0; i < 14; i++) {
      this.hot.push({
        x: x + rand(-10, 10), y: y + rand(-10, 10), z: rand(0, 6), vx: 0, vy: 0, vz: rand(18, 40), age: 0, life: rand(0.6, 1.1),
        size0: 2.5, size1: 0.5, r: colour[0], g: colour[1], b: colour[2], alpha: 1, drag: 0.8, rise: 0, gravity: 0,
      });
    }
  }

  /** A firework over the winner's base: a flash high up and a shell of sparks in a colour that fall and fade. */
  firework(x: number, y: number, z: number, colour: [number, number, number], scale = 1): void {
    const n = Math.round(46 * scale);
    for (let i = 0; i < n; i++) {
      // Even over a sphere, so the shell reads as round from the drone's height.
      const u = rand(-1, 1);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = rand(52, 70) * scale;
      const white = Math.random() < 0.2;
      this.hot.push({
        x, y, z, vx: Math.cos(a) * r * s, vy: Math.sin(a) * r * s, vz: u * s + 12, age: 0, life: rand(1.1, 1.7),
        size0: rand(3, 4.5) * scale, size1: 0.6, r: white ? 1 : colour[0], g: white ? 1 : colour[1], b: white ? 1 : colour[2],
        alpha: 1, drag: 0.9, rise: 0, gravity: GRAVITY * 0.18,
      });
    }
    this.puff(x, y, z, 2, 2.4, [0.3, 0.3, 0.32], 8 * scale, 22 * scale);
    this.flash(x, y, z, 4 * scale);
  }

  smokeAt(x: number, y: number, z: number): void {
    this.puff(x, y, z, 2, 1.5, [0.85, 0.85, 0.82], 3, 10);
  }

  /** A burning wreck or a damaged vehicle: called each frame, it puts out smoke now and then. */
  trail(x: number, y: number, z: number, heavy: boolean, dt: number): void {
    if (Math.random() > dt * (heavy ? 14 : 5)) return;
    this.soft.push({
      x: x + rand(-2, 2), y: y + rand(-2, 2), z: z + 4, vx: rand(-3, 3), vy: rand(-3, 3), vz: rand(10, 18), age: 0, life: rand(1.4, 2.4),
      size0: heavy ? 6 : 4, size1: heavy ? 22 : 14, r: 0.22, g: 0.21, b: 0.2, alpha: heavy ? 0.7 : 0.45, drag: 0.4, rise: 6, gravity: 0,
    });
    if (heavy && Math.random() < 0.4) this.fire(x + rand(-3, 3), y + rand(-3, 3), z + 3, 4, 0.35, 1, 0.55, 0.15);
  }

  /** A missile's or rocket's exhaust each frame. */
  exhaust(x: number, y: number, z: number, dt: number): void {
    if (Math.random() < dt * 40) {
      this.soft.push({
        x, y, z, vx: 0, vy: 0, vz: 3, age: 0, life: 0.8, size0: 2.5, size1: 7, r: 0.82, g: 0.82, b: 0.8, alpha: 0.55, drag: 0.5, rise: 2, gravity: 0,
      });
    }
    this.fire(x, y, z, 3.2, 0.06, 1, 0.75, 0.3);
  }

  // ---- Parts ---------------------------------------------------------------------------------------------------

  private fire(x: number, y: number, z: number, size: number, life: number, r: number, g: number, b: number): void {
    this.hot.push({ x, y, z, vx: 0, vy: 0, vz: 0, age: 0, life, size0: size, size1: size * 1.3, r, g, b, alpha: 1, drag: 0, rise: 0, gravity: 0 });
  }

  private puff(x: number, y: number, z: number, n: number, life: number, c: [number, number, number], s0: number, s1: number, speed = 12): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * speed;
      const shade = rand(0.85, 1.1);
      this.soft.push({
        x: x + rand(-2, 2), y: y + rand(-2, 2), z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(4, 14), age: 0, life: life * rand(0.7, 1.3),
        size0: s0, size1: s1, r: c[0] * shade, g: c[1] * shade, b: c[2] * shade, alpha: 0.8, drag: 0.35, rise: 4, gravity: 0,
      });
    }
  }

  debris(x: number, y: number, z: number, colours: THREE.Color[], n: number, scale: number): void {
    for (let i = 0; i < n && this.chunks.length < MAX_CHUNKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(20, 70) * Math.sqrt(scale);
      this.chunks.push({
        x: x + rand(-4, 4), y: y + rand(-4, 4), z: z + rand(2, 8), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(50, 140) * Math.sqrt(scale),
        ax: Math.random() * 3, ay: Math.random() * 3, spin: rand(4, 12), rot: 0, size: rand(1.2, 3.5) * Math.sqrt(scale), age: 0, life: rand(2.5, 4),
        colour: colours[i % colours.length]!,
      });
    }
  }

  private mark(x: number, y: number, size: number): void {
    const m = this.scorch[this.scorchNext]!;
    this.scorchNext = (this.scorchNext + 1) % MAX_SCORCH;
    m.position.set(x, 0.15 + this.scorchNext * 0.002, y);
    m.scale.set(size, size, 1);
    m.rotation.z = Math.random() * Math.PI * 2;
    m.visible = true;
    m.userData.born = this.now;
    (m.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  private flash(x: number, y: number, z: number, power: number): void {
    const l = this.lights[this.lightNext]!;
    this.lightNext = (this.lightNext + 1) % FLASH_LIGHTS;
    l.light.position.set(x, z, y);
    l.age = 0;
    l.life = 0.25 + power * 0.04;
    l.power = 900 * power;
  }

  // ---- Each frame ----------------------------------------------------------------------------------------------

  step(dt: number): void {
    this.now += dt;
    for (const e of this.emitters) {
      while (e.next <= this.now && e.next < e.until) {
        e.next += e.every;
        this.soft.push({
          x: e.x + rand(-3, 3), y: e.y + rand(-3, 3), z: e.z, vx: rand(-2, 2), vy: rand(-2, 2), vz: rand(12, 20), age: 0, life: rand(1.8, 2.8),
          size0: 6, size1: 24, r: 0.2, g: 0.19, b: 0.18, alpha: 0.6, drag: 0.4, rise: 6, gravity: 0,
        });
      }
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) if (this.emitters[i]!.until <= this.now) this.emitters.splice(i, 1);
    this.glow.reset();
    this.smoke.reset();
    this.advance(this.hot, this.glow, dt);
    this.advance(this.soft, this.smoke, dt);
    this.glow.commit();
    this.smoke.commit();

    let n = 0;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i]!;
      c.age += dt;
      if (c.age >= c.life) {
        this.chunks.splice(i, 1);
        continue;
      }
      c.vz -= GRAVITY * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      if (c.z < c.size / 2) {
        c.z = c.size / 2;
        c.vz = Math.abs(c.vz) * 0.3;
        c.vx *= 0.6;
        c.vy *= 0.6;
        c.spin *= 0.5;
      }
      c.rot += c.spin * dt;
      const shrink = c.age > c.life - 0.5 ? (c.life - c.age) / 0.5 : 1;
      this.e.set(c.ax * c.rot, c.ay * c.rot, c.rot);
      this.q.setFromEuler(this.e);
      const s = c.size * shrink;
      this.m4.compose(new THREE.Vector3(c.x, c.z, c.y), this.q, new THREE.Vector3(s, s * 0.7, s));
      this.chunkMesh.setMatrixAt(n, this.m4);
      this.chunkMesh.setColorAt(n, c.colour);
      n++;
    }
    this.chunkMesh.count = n;
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;

    for (const m of this.scorch) {
      if (!m.visible) continue;
      const age = this.now - (m.userData.born as number);
      if (age > 30) m.visible = false;
      else if (age > 20) (m.material as THREE.MeshBasicMaterial).opacity = 1 - (age - 20) / 10;
    }
    for (const l of this.lights) {
      l.age += dt;
      l.light.intensity = l.age < l.life ? l.power * (1 - l.age / l.life) ** 2 : 0;
    }
  }

  private advance(list: Particle[], batch: PointBatch, dt: number): void {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        list[i] = list[list.length - 1]!;
        list.pop();
        continue;
      }
      const keep = Math.pow(p.drag, dt);
      p.vx *= keep;
      p.vy *= keep;
      p.vz = p.vz * keep - p.gravity * dt + p.rise * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0 && p.gravity) {
        p.z = 0;
        p.vz = 0;
        p.vx *= 0.5;
        p.vy *= 0.5;
      }
      batch.push(p, p.age / p.life);
    }
  }

  clear(): void {
    this.hot.length = 0;
    this.soft.length = 0;
    this.chunks.length = 0;
    this.emitters.length = 0;
    for (const m of this.scorch) m.visible = false;
  }
}
