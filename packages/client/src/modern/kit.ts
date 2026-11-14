// Building blocks for the modern view's low-poly models. Shapes are placed in the game's own axes (x east, y south,
// z up, in game pixels) and turned into three.js's (x, z, y), so the numbers here read the same as the sim's and the
// art pack's model sizes. Each shape carries one flat colour; a model is merged into one geometry with a colour per
// vertex, so it draws in one call and takes the toy-like flat shading.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A colour, or 'team' for the owner's colour, filled in when the model is made for a side. */
export type Paint = number | 'team' | 'teamDark' | 'teamLight';

export interface Place {
  /** Turn about the up axis, radians, clockwise seen from above (the sim's heading direction). */
  turn?: number;
  /** Tilt about the east axis, radians: nose up for a positive tilt of a model facing north. */
  tilt?: number;
  /** Roll about the north axis, radians. */
  roll?: number;
}

interface Piece {
  geo: THREE.BufferGeometry;
  paint: Paint;
}

const tmp = new THREE.Matrix4();
const euler = new THREE.Euler();
const quat = new THREE.Quaternion();

/** The matrix that puts a shape made about three.js's origin at a game point, turned as asked. */
function placing(x: number, y: number, z: number, p: Place = {}, scale = new THREE.Vector3(1, 1, 1)): THREE.Matrix4 {
  // Game turn clockwise from above = three.js rotation about +Y by -turn; game tilt nose-up (north end rising) is a
  // rotation about +X by +tilt in three.js axes, where north is -Z.
  euler.set(p.tilt ?? 0, -(p.turn ?? 0), p.roll ?? 0, 'YXZ');
  quat.setFromEuler(euler);
  return tmp.compose(new THREE.Vector3(x, z, y), quat, scale);
}

export class Kit {
  private readonly pieces: Piece[] = [];

  /** A box standing on z (its base), centred on (x, y), sized w east-west, d north-south, h up. */
  box(x: number, y: number, z: number, w: number, d: number, h: number, paint: Paint, p?: Place): this {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(g, x, y, z, paint, p);
  }

  /** An upright cylinder (or cone, or prism with few sides) standing on z. */
  cyl(x: number, y: number, z: number, rTop: number, rBottom: number, h: number, paint: Paint, sides = 8, p?: Place): this {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, sides);
    g.translate(0, h / 2, 0);
    return this.add(g, x, y, z, paint, p);
  }

  /** A cylinder lying along the north-south axis, centred on (x, y, z): barrels, tubes, fuel tanks. */
  tube(x: number, y: number, z: number, r: number, len: number, paint: Paint, sides = 8, p?: Place, rEnd = r): this {
    const g = new THREE.CylinderGeometry(rEnd, r, len, sides);
    // Lying along -Z (north) with its rEnd end pointing north.
    g.rotateX(-Math.PI / 2);
    return this.add(g, x, y, z, paint, p);
  }

  /** A cylinder lying along the east-west axis, centred on (x, y, z): wheels and rollers. */
  axle(x: number, y: number, z: number, r: number, len: number, paint: Paint, sides = 10, p?: Place): this {
    const g = new THREE.CylinderGeometry(r, r, len, sides);
    g.rotateZ(Math.PI / 2);
    return this.add(g, x, y, z, paint, p);
  }

  /** A ball (low poly), centred on (x, y, z), squashed by sz up. */
  ball(x: number, y: number, z: number, r: number, paint: Paint, detail = 0, sz = 1, p?: Place): this {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(1, sz, 1);
    return this.add(g, x, y, z, paint, p);
  }

  /** A pitched roof over a w by d footprint at height z, ridge along north-south (or east-west with ridgeEW). */
  roof(x: number, y: number, z: number, w: number, d: number, h: number, paint: Paint, ridgeEW = false, p?: Place): this {
    const shape = new THREE.Shape();
    const span = ridgeEW ? d : w;
    const len = ridgeEW ? w : d;
    shape.moveTo(-span / 2, 0);
    shape.lineTo(span / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    if (ridgeEW) g.rotateY(Math.PI / 2);
    return this.add(g, x, y, z, paint, p);
  }

  /** A wedge: a box whose top slopes from full height at the south side down to low at the north side. */
  wedge(x: number, y: number, z: number, w: number, d: number, hSouth: number, hNorth: number, paint: Paint, p?: Place): this {
    const shape = new THREE.Shape();
    // Side profile in (north-south, up): south is +d/2.
    shape.moveTo(-d / 2, 0);
    shape.lineTo(d / 2, 0);
    shape.lineTo(d / 2, hSouth);
    shape.lineTo(-d / 2, hNorth);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    // Profile x is three.js Z (south), extruded along three.js X.
    g.rotateY(-Math.PI / 2);
    g.translate(w / 2, 0, 0);
    return this.add(g, x, y, z, paint, p);
  }

  /** Any three.js geometry made about the origin in three.js axes, placed at a game point. */
  add(g: THREE.BufferGeometry, x: number, y: number, z: number, paint: Paint, p?: Place): this {
    g.applyMatrix4(placing(x, y, z, p));
    this.pieces.push({ geo: g, paint });
    return this;
  }

  /** Another kit's shapes, moved and turned. */
  merge(other: Kit, x = 0, y = 0, z = 0, p?: Place): this {
    const m = placing(x, y, z, p).clone();
    for (const piece of other.pieces) this.pieces.push({ geo: piece.geo.clone().applyMatrix4(m), paint: piece.paint });
    return this;
  }

  get empty(): boolean {
    return this.pieces.length === 0;
  }

  /** One geometry with flat normals and a colour per vertex, the team paints filled in with the side's colours. */
  build(team: TeamPaint = NEUTRAL): THREE.BufferGeometry {
    const parts = this.pieces.map(({ geo, paint }) => {
      const g = (geo.index ? geo.toNonIndexed() : geo.clone());
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      g.computeVertexNormals();
      const c = new THREE.Color(resolve(paint, team));
      const n = g.getAttribute('position').count;
      const colours = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        colours[i * 3] = c.r;
        colours[i * 3 + 1] = c.g;
        colours[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      return g;
    });
    if (!parts.length) return new THREE.BufferGeometry();
    const out = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    out.computeBoundingSphere();
    return out;
  }
}

/** A side's three tones, as hex colours (linear sRGB conversion is three.js's). */
export interface TeamPaint {
  main: number;
  dark: number;
  light: number;
}

export const NEUTRAL: TeamPaint = { main: 0x8a8f96, dark: 0x5d6168, light: 0xb9bec4 };

function resolve(p: Paint, t: TeamPaint): number {
  if (p === 'team') return t.main;
  if (p === 'teamDark') return t.dark;
  if (p === 'teamLight') return t.light;
  return p;
}

/** A side's paint from its RGB colour: the colour itself, a darker and a lighter tone. */
export function teamPaint(r: number, g: number, b: number): TeamPaint {
  const c = new THREE.Color(r / 255, g / 255, b / 255);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const tone = (dl: number, ds: number) => new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * ds), Math.max(0, Math.min(1, hsl.l + dl))).getHex();
  // A touch bolder than the flat colour, for the painted-toy look.
  return { main: tone(0, 1.2), dark: tone(-0.14, 1.2), light: tone(0.14, 1) };
}

/** A small deterministic random sequence for varying scenery by tile. */
export function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
