// The pitch-only perspective camera (sub_416cb0, sub_416fa0, sub_416420), with the projection of sub_413d00.
// Numbers are from the render doc. The camera only changes what a player sees, never the game state, so it
// lives in the client and may use floats.

import { VEHICLES, type Vehicle, type VehicleKind } from '@rfw/sim';

/** Focal length D (g_443000). */
export const FOCAL = 300;
/** Starting camera distance Z (view +0x20). */
const START_Z = 270;
/** Pitch in 256ths of a turn (view +0x24): 45 degrees at rest, 70.3 degrees while moving (def +0x2d4). */
const PITCH_STOPPED = 32;
const PITCH_MOVING = 50;
/**
 * Z targets while moving (def +0x2cc) and while stopped. The stopped target is the vehicle's own copy of def +0x130
 * (its record is copied from def +0x8 when it is made, sub_40b700, and sub_416420 reads the copy at +0x128): nothing
 * for the ground vehicles, so a parked one is drawn at 1:1, and 60 for the helicopter.
 */
const Z_MOVING: Record<VehicleKind, number> = { tank: 100, jeep: 250, asv: 100, heli: 200 };
const Z_STOPPED: Record<VehicleKind, number> = { tank: 0, jeep: 0, asv: 0, heli: 60 };
/** A vehicle counts as moving when its speed stays above 0.2 px a tick for 30 ticks. */
const MOVING_SPEED = 0x3333;
const MOVING_TICKS = 30;
/** Easing limits (sub_416fa0, def +0x2c0): acceleration, deceleration and top speed per tick. */
const EASE_ACCEL = 0.08;
const EASE_DECEL = 0.04;
const EASE_MAX = 1;

/** A player's view rectangle in the 320 x 240 frame, and where the player sits in it. */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Offset of the followed vehicle from the view centre. */
  dx: number;
  dy: number;
  /** The look-ahead stays inside this box (sub_416ab0). */
  boxW: number;
  boxH: number;
}

/** View layouts (sub_409420, sub_4096f0): one 320 x 152 view, or two 156 x 149 views side by side. */
export function layout(players: number): ViewRect[] {
  if (players === 1) return [{ x: 0, y: 0, w: 320, h: 152, dx: 0, dy: 12, boxW: 288, boxH: 140 }];
  return [
    { x: 0, y: 0, w: 156, h: 149, dx: 8, dy: 12, boxW: 148, boxH: 137 },
    { x: 164, y: 0, w: 156, h: 149, dx: -8, dy: 12, boxW: 148, boxH: 137 },
  ];
}

/** Approach a target with capped acceleration, deceleration and speed (sub_417420). */
class Eased {
  vel = 0;
  constructor(public value: number) {}

  step(target: number): void {
    const dist = target - this.value;
    const dir = Math.sign(dist);
    if (dir === 0 && this.vel === 0) return;
    const stopping = (this.vel * this.vel) / (2 * EASE_DECEL);
    if (Math.sign(this.vel) === dir && Math.abs(dist) <= stopping) {
      this.vel -= Math.sign(this.vel) * Math.min(EASE_DECEL, Math.abs(this.vel));
    } else {
      this.vel = Math.max(-EASE_MAX, Math.min(EASE_MAX, this.vel + dir * EASE_ACCEL));
    }
    this.value += this.vel;
    if ((target - this.value) * dir < 0 || Math.abs(target - this.value) < 0.01) {
      this.value = target;
      this.vel = 0;
    }
  }
}

export interface Projected {
  x: number;
  y: number;
  /** Camera-space y' and z', used for the draw-order key. */
  yc: number;
  zc: number;
}

export class Camera {
  /** The ground point the camera follows, in pixels. */
  x = 0;
  y = 0;
  private z = new Eased(START_Z);
  private pitch = new Eased(PITCH_STOPPED);
  private leadX = new Eased(0);
  private leadY = new Eased(0);
  private movingFor = 0;
  private sin = 0;
  private cos = 0;
  private cx = 0;
  private cy = 0;

  constructor(readonly view: ViewRect) {}

  /** One tick of camera movement, following a vehicle (or its wreck) or resting on the bunker. */
  update(v: Pick<Vehicle, 'kind' | 'x' | 'y' | 'heading' | 'speed'> | null, homeX: number, homeY: number): void {
    if (!v) {
      this.movingFor = 0;
      this.x = homeX;
      this.y = homeY;
      this.leadX.step(0);
      this.leadY.step(0);
      this.z.step(0);
      this.pitch.step(PITCH_STOPPED);
      return;
    }
    this.movingFor = Math.abs(v.speed) > MOVING_SPEED ? this.movingFor + 1 : 0;
    const moving = this.movingFor >= MOVING_TICKS;
    this.z.step(moving ? Z_MOVING[v.kind] : Z_STOPPED[v.kind]);
    this.pitch.step(moving ? PITCH_MOVING : PITCH_STOPPED);
    // Inferred: the lead grows with speed, along the heading, up to half the look-ahead box.
    const h = (v.heading / 65536 / 64) * Math.PI * 2;
    const f = Math.min(1, Math.abs(v.speed) / VEHICLES[v.kind].maxForward) * Math.sign(v.speed);
    this.leadX.step(Math.sin(h) * f * (this.view.boxW / 2 - 16));
    this.leadY.step(-Math.cos(h) * f * (this.view.boxH / 2 - 16));
    this.x = v.x / 65536;
    this.y = v.y / 65536;
  }

  /** Sets up the projection for a frame. */
  begin(): void {
    const a = (this.pitch.value / 256) * Math.PI * 2;
    this.sin = Math.sin(a);
    this.cos = Math.cos(a);
    const v = this.view;
    this.cx = v.x + v.w / 2 + v.dx;
    this.cy = v.y + v.h / 2 + v.dy;
  }

  /** Projects a world point in pixels (z up). Returns null behind the camera. */
  project(px: number, py: number, pz: number): Projected | null {
    const x = px - this.x - this.leadX.value;
    const y = py - this.y - this.leadY.value;
    const yc = y * this.sin - pz * this.cos;
    const zc = y * this.cos + pz * this.sin;
    const depth = FOCAL + this.z.value - zc;
    if (depth < 1) return null;
    const s = FOCAL / depth;
    return { x: this.cx + s * x, y: this.cy + s * yc, yc, zc };
  }

  /** The ground rows (world y in pixels) visible from the top to the bottom of the view. */
  groundRange(): { top: number; bottom: number; halfWidth: number } {
    const v = this.view;
    const ground = (sy: number) => {
      const k = (sy - this.cy) / FOCAL;
      const den = this.sin + k * this.cos;
      return den <= 0.01 ? -4096 : (k * (FOCAL + this.z.value)) / den;
    };
    const top = ground(v.y) + this.y + this.leadY.value;
    const bottom = ground(v.y + v.h) + this.y + this.leadY.value;
    const far = this.project(this.x, top, 0);
    const scale = far ? FOCAL / (FOCAL + this.z.value - far.zc) : 0.3;
    return { top, bottom, halfWidth: (v.w / 2 + Math.abs(v.dx)) / scale + 64 };
  }

  /** Holds the camera still over a ground point at a height and pitch (256ths of a turn): the level editor's view. */
  fix(x: number, y: number, z: number, pitch: number): void {
    this.x = x;
    this.y = y;
    for (const [e, v] of [[this.z, z], [this.pitch, pitch], [this.leadX, 0], [this.leadY, 0]] as const) {
      e.value = v;
      e.vel = 0;
    }
  }

  /** The ground point (z = 0) under a point of the view, or null at or above the horizon. Call after begin(). */
  unproject(sx: number, sy: number): { x: number; y: number } | null {
    const k = (sy - this.cy) / FOCAL;
    const den = this.sin + k * this.cos;
    if (den <= 0.001) return null;
    const y = (k * (FOCAL + this.z.value)) / den;
    const depth = FOCAL + this.z.value - y * this.cos;
    return { x: ((sx - this.cx) * depth) / FOCAL + this.x + this.leadX.value, y: y + this.y + this.leadY.value };
  }

  /**
   * For the modern view (modern/renderer.ts): the ground point the view centres on, the camera's distance Z beyond
   * the focal length and its pitch in radians, so a 3D camera can stand where this one projects from.
   */
  pose(): { x: number; y: number; z: number; pitch: number } {
    return { x: this.x + this.leadX.value, y: this.y + this.leadY.value, z: this.z.value, pitch: (this.pitch.value / 256) * Math.PI * 2 };
  }

  get centreX(): number {
    return this.x + this.leadX.value;
  }
}
