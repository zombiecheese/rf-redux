// Collision between shape lists, ported from the original (sub_41e4c0 and the pair tests it calls).
//
// Every model carries a list of collision shapes sorted by height: points, boxes, polygons and a moving shot's line. Two objects
// touch when some pair of their shapes overlaps in height and in plan, and the pair's layers allow it: byte 10
// of a shape is its layer and byte 11 the layers it collides with. Boxes never turn; polygons turn with the
// object's heading, in whole heading steps. A shape's offset from the object is not turned either.
//
// All arithmetic is integer: positions are 16.16 pixels and the rotation uses the sine table, so every client
// agrees on every contact.

import { FIXED_SHIFT, cos, mul, sin } from './fixed.js';

export const POINT = 1;
export const BOX = 2;
export const POLYGON = 3;
/** A moving shot's line (type 4): from where it was to where it is, set up afresh for each move (sub_41e5f0). */
export const SEGMENT = 4;

/** One collision shape, as exported by tools/convert_assets.py (raw 16.16 words). */
export interface Shape {
  /** 1 point, 2 box, 3 polygon (word 0). */
  type: number;
  /**
   * Bytes 8-11: [pad, pad kind, layer, mask]. Byte 8 bit 2 marks a pad (a depot's, a gate's trigger zone), byte 9
   * says which kind (1 fuel, 2 ammo, 3 gate), byte 10 is the shape's layer and byte 11 the layers it hits.
   */
  flags: readonly number[];
  /** Height range above the object (words 3-4). */
  z: readonly number[];
  /** Offset from the object (words 5-6), not turned with it. */
  offset: readonly number[];
  /** Left, top, right, bottom around the shape's centre (words 7-10). */
  bounds: readonly number[];
  /** Polygon only: corners around the shape's centre, x and y. */
  verts?: readonly (readonly number[])[];
  /** Polygon only: the corner index of each edge, in order. An edge runs from the previous corner to this one. */
  edges?: readonly number[];
}

/** Where an object is: 16.16 pixels and a 16.16 heading in 64 steps. */
export interface Body {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface Contact {
  /** Both shapes' layers ORed together (the return value of sub_41e4c0). */
  layers: number;
  /** The two shapes that touched (DAT_0047c914 and DAT_0047c918). */
  a: Shape;
  b: Shape;
}

const LAYER = 2;
const MASK = 3;

/**
 * Whether segments a-b and c-d cross (sub_41d670): cross products of the whole-pixel offsets, with the original's
 * handling of parallel segments (overlapping collinear segments count as crossing).
 */
export function crosses(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const ex = (dx - cx) >> FIXED_SHIFT;
  const ey = (dy - cy) >> FIXED_SHIFT;
  const fx = (bx - ax) >> FIXED_SHIFT;
  const fy = (by - ay) >> FIXED_SHIFT;
  const gx = (cx - ax) >> FIXED_SHIFT;
  const gy = (cy - ay) >> FIXED_SHIFT;
  const den = Math.imul(ey, fx) - Math.imul(fy, ex);
  const s = Math.imul(fy, gx) - Math.imul(gy, fx);
  const t = Math.imul(ey, gx) - Math.imul(gy, ex);
  if (den === 0) {
    if (s !== 0) return false;
    if (bx !== cx) return Math.min(dx, cx) <= Math.max(ax, bx) && Math.min(ax, bx) <= Math.max(dx, cx);
    return Math.min(dy, cy) <= Math.max(ay, by) && Math.min(ay, by) <= Math.max(dy, cy);
  }
  if (den > 0) return s >= 0 && s <= den && t >= 0 && t <= den;
  return s <= 0 && den <= s && t <= 0 && den <= t;
}

/**
 * A polygon's corners in the world (sub_41d860): turned by the heading's whole step with the rotation matrix the
 * original builds from the sine table (sub_410c60), then moved to the shape's centre (sub_409b10).
 */
function corners(s: Shape, cx: number, cy: number, heading: number): number[] {
  const verts = s.verts ?? [];
  const out = new Array<number>(verts.length * 2);
  const turned = (heading & ~0xffff) !== 0;
  const c = cos(heading);
  const n = sin(heading);
  verts.forEach(([x = 0, y = 0], i) => {
    out[i * 2] = (turned ? mul(x, c) + mul(y, -n) : x) + cx;
    out[i * 2 + 1] = (turned ? mul(x, n) + mul(y, c) : y) + cy;
  });
  return out;
}

/** Whether segment p-q crosses any edge of a placed polygon (sub_41d800). */
function crossesEdge(px: number, py: number, qx: number, qy: number, s: Shape, v: readonly number[]): boolean {
  const edges = s.edges ?? [];
  let prev = edges.length - 1;
  for (const i of edges) {
    if (crosses(px, py, qx, qy, v[i * 2]!, v[i * 2 + 1]!, v[prev * 2]!, v[prev * 2 + 1]!)) return true;
    prev = i;
  }
  return false;
}

/** Point p within bounds b around centre c (sub_41d5b0). */
function within(px: number, py: number, cx: number, cy: number, b: readonly number[]): boolean {
  const dx = px - cx;
  const dy = py - cy;
  return b[0]! <= dx && dx <= b[2]! && b[1]! <= dy && dy <= b[3]!;
}

/** Two bounds around two centres overlap (sub_41d5f0, also the first step of the box and polygon tests). */
function boundsMeet(ax: number, ay: number, a: readonly number[], bx: number, by: number, b: readonly number[]): boolean {
  const dx = ax - bx;
  if (dx < 0 ? a[2]! - b[0]! + dx < 0 : b[2]! - a[0]! - dx < 0) return false;
  const dy = ay - by;
  if (dy < 0 ? a[3]! - b[1]! + dy < 0 : b[3]! - a[1]! - dy < 0) return false;
  return true;
}

/**
 * A box against a polygon (sub_41d8d0): their bounds must meet; then they touch if the polygon's centre is in the
 * box, if an edge of the box crosses an edge of the polygon, or if the box's centre is inside the polygon (the line
 * between the centres crosses none of its edges).
 */
function boxPolygon(bx: number, by: number, box: readonly number[], px: number, py: number, heading: number, p: Shape): boolean {
  if (!boundsMeet(bx, by, box, px, py, p.bounds)) return false;
  if (within(px, py, bx, by, box)) return true;
  const v = corners(p, px, py, heading);
  const l = box[0]! + bx;
  const t = box[1]! + by;
  const r = box[2]! + bx;
  const b = box[3]! + by;
  if (crossesEdge(l, t, r, t, p, v) || crossesEdge(r, b, r, t, p, v) || crossesEdge(r, b, l, b, p, v) || crossesEdge(l, b, l, t, p, v)) {
    return true;
  }
  return !crossesEdge(bx, by, px, py, p, v);
}

/**
 * Two polygons (sub_41dc10): their bounds must meet; then they touch if any edges cross, or if the line between
 * their centres leaves one of them without crossing the other's edges.
 */
function polygons(ax: number, ay: number, ah: number, a: Shape, bx: number, by: number, bh: number, b: Shape): boolean {
  if (!boundsMeet(ax, ay, a.bounds, bx, by, b.bounds)) return false;
  const va = corners(a, ax, ay, ah);
  const vb = corners(b, bx, by, bh);
  const ea = a.edges ?? [];
  let prev = ea.length - 1;
  for (const i of ea) {
    if (crossesEdge(va[i * 2]!, va[i * 2 + 1]!, va[prev * 2]!, va[prev * 2 + 1]!, b, vb)) return true;
    prev = i;
  }
  if (!crossesEdge(ax, ay, bx, by, a, va)) return true;
  return !crossesEdge(ax, ay, bx, by, b, vb);
}

/**
 * A shot's line against a box (sub_41deb0): their bounds must meet; then they touch if the shot's end is in the box
 * or its line crosses one of the box's sides.
 */
function segmentBox(ax: number, ay: number, a: Shape, bx: number, by: number, box: readonly number[]): boolean {
  if (!boundsMeet(ax, ay, a.bounds, bx, by, box)) return false;
  if (within(ax, ay, bx, by, box)) return true;
  const [[px = 0, py = 0] = [], [qx = 0, qy = 0] = []] = a.verts ?? [];
  const sx = px + ax;
  const sy = py + ay;
  const ex = qx + ax;
  const ey = qy + ay;
  const l = box[0]! + bx;
  const t = box[1]! + by;
  const r = box[2]! + bx;
  const b = box[3]! + by;
  return crosses(sx, sy, ex, ey, l, t, r, t) || crosses(sx, sy, ex, ey, r, t, r, b)
    || crosses(sx, sy, ex, ey, r, b, l, b) || crosses(sx, sy, ex, ey, l, b, l, t);
}

/**
 * A shot's line against a polygon (sub_41e060, case 4 against 3): their bounds must meet; then the line is tested
 * against the polygon's edges, but the original passes the line's corners unplaced (relative to the shot) while the
 * polygon's are placed in the world, so in practice it is the end of the line inside the polygon that counts.
 */
function segmentPolygon(ax: number, ay: number, a: Shape, bx: number, by: number, heading: number, p: Shape): boolean {
  if (!boundsMeet(ax, ay, a.bounds, bx, by, p.bounds)) return false;
  const v = corners(p, bx, by, heading);
  const [[px = 0, py = 0] = [], [qx = 0, qy = 0] = []] = a.verts ?? [];
  if (crossesEdge(px, py, qx, qy, p, v)) return true;
  return !crossesEdge(ax, ay, bx, by, p, v);
}

/**
 * The line a shot sweeps in one move (sub_41e5f0), as a shape placed at where it is now: its corners are where it
 * was and where it is, its bounds take in both, and its height runs from 0 by the change in height. Layer 4,
 * colliding with layers 1, 2 and 64 (the shot model's shape at 0x454310).
 */
export function sweep(from: readonly [number, number, number], x: number, y: number, z: number): Shape {
  const dx = from[0] - x;
  const dy = from[1] - y;
  const dz = z - from[2];
  return {
    type: SEGMENT, flags: [0, 0, 4, 67], z: dz < 0 ? [dz, 0] : [0, dz], offset: [0, 0],
    bounds: [Math.min(dx, 0), Math.min(dy, 0), Math.max(dx, 0), Math.max(dy, 0)], verts: [[dx, dy], [0, 0]],
  };
}

/** One pair of shapes (sub_41e060). Each shape sits at its object's position plus its offset. */
function pair(pa: Body, a: Shape, pb: Body, b: Shape): boolean {
  const ax = pa.x + a.offset[0]!;
  const ay = pa.y + a.offset[1]!;
  const bx = pb.x + b.offset[0]!;
  const by = pb.y + b.offset[1]!;
  if (a.type === SEGMENT) {
    if (b.type === BOX) return segmentBox(ax, ay, a, bx, by, b.bounds);
    if (b.type === POLYGON) return segmentPolygon(ax, ay, a, bx, by, pb.heading, b);
    return false;
  }
  if (a.type === BOX) {
    if (b.type === POINT || b.type === SEGMENT) return within(bx, by, ax, ay, a.bounds);
    if (b.type === BOX) return boundsMeet(ax, ay, a.bounds, bx, by, b.bounds);
    if (b.type === POLYGON) return boxPolygon(ax, ay, a.bounds, bx, by, pb.heading, b);
    return false;
  }
  if (a.type === POLYGON) {
    if (b.type === POINT || b.type === SEGMENT) return pointInPolygon(bx, by, ax, ay, pa.heading, a);
    if (b.type === BOX) return boxPolygon(bx, by, b.bounds, ax, ay, pa.heading, a);
    if (b.type === POLYGON) return polygons(ax, ay, pa.heading, a, bx, by, pb.heading, b);
    return false;
  }
  if (a.type === POINT) {
    if (b.type === BOX) return within(ax, ay, bx, by, b.bounds);
    if (b.type === POLYGON) return pointInPolygon(ax, ay, bx, by, pb.heading, b);
  }
  return false;
}

/** A point in a polygon: within its bounds, and the line to its centre crosses none of its edges. */
function pointInPolygon(x: number, y: number, cx: number, cy: number, heading: number, p: Shape): boolean {
  if (!within(x, y, cx, cy, p.bounds)) return false;
  return !crossesEdge(x, y, cx, cy, p, corners(p, cx, cy, heading));
}

/**
 * Whether two objects' shape lists touch (sub_41e4c0). The first shapes' mask and layer must agree before
 * anything is tested. Then both lists are walked together by height: a shape wholly below the other is skipped,
 * and overlapping pairs whose layers agree are tested. The first pair that touches is the contact.
 */
export function touch(pa: Body, listA: readonly Shape[], pb: Body, listB: readonly Shape[]): Contact | null {
  if (!listA.length || !listB.length) return null;
  if (!(listA[0]!.flags[MASK]! & listB[0]!.flags[LAYER]!)) return null;
  let i = 0;
  let j = 0;
  let layers = 0;
  while (i < listA.length && j < listB.length) {
    const a = listA[i]!;
    const b = listB[j]!;
    if (b.z[1]! + pb.z < a.z[0]! + pa.z) {
      j++;
    } else if (a.z[1]! + pa.z < b.z[0]! + pb.z) {
      i++;
    } else {
      if (b.flags[LAYER]! & a.flags[MASK]! && pair(pa, a, pb, b)) {
        layers |= a.flags[LAYER]! | b.flags[LAYER]!;
        if (layers) return { layers, a, b };
      }
      const moreA = i + 1 < listA.length;
      const moreB = j + 1 < listB.length;
      if (!moreA) {
        if (moreB) j++;
        else i++;
      } else if (moreB && !(pa.z + a.z[0]! < pb.z + b.z[0]!)) {
        j++;
      } else {
        i++;
      }
    }
  }
  return null;
}
