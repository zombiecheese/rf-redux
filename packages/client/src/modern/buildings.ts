// The modern view's buildings and scenery, made by name from the building table (buildings.json), each sized to the
// art pack's model for that building so it fills the same tiles the sim gives it. Tiles vary their look (roof
// colour, tree size, rock shapes) by a seed from the tile, so a town is not one house repeated.

import type { BuildingDef } from '@rfw/sim';
import * as THREE from 'three';
import { Kit, seeded } from './kit.js';

const CONCRETE = 0xb4b2aa;
const CONCRETE_DARK = 0x8d8b84;
const STONE = 0x9a958a;
const ROCK = 0x8b8780;
const WOOD = 0x8a5a33;
const WOOD_DARK = 0x5d3c22;
const LEAF = 0x4f9a3a;
const LEAF_DARK = 0x3b7a2c;
const LEAF_LIGHT = 0x76b94a;
const TRUNK = 0x7a5532;
const METAL = 0x6c7178;
const GUNMETAL = 0x41454b;
const HAZARD = 0xe0b81c;
/** Burnt, melted plastic: soot black, scorched brown, and the toy's own colours gone dark. */
const CHAR = [0x2a2522, 0x3e3530, 0x54453a, 0x6b5a4a];
const WALLS = [0xe9dcc2, 0xd9c7a3, 0xf0e6d6, 0xc9b28a];
const ROOFS = [0xb5523b, 0x9c4632, 0x6f7f8f, 0xc06a3e];

/** What a building's model is, from its name. */
export type Look =
  | 'bush' | 'palm' | 'tree' | 'cactus' | 'rock' | 'planter' | 'ammo' | 'prison' | 'flag' | 'house' | 'factory' | 'hq'
  | 'outpost' | 'hospital' | 'fuel' | 'gate' | 'wall' | 'wallBroken' | 'tent' | 'tower' | 'towerBase' | 'towerBroken'
  | 'watchtower' | 'rubble' | 'stump' | 'bridge' | 'light' | 'flagBroken' | 'none';

export function lookOf(name: string): Look {
  const n = name.toUpperCase();
  if (n === 'NOTHING' || n === '') return 'none';
  if (n.startsWith('DEST_TREE')) return 'stump';
  if (n.startsWith('DEST_BUSH')) return 'stump';
  if (n === 'DMG_FLAG' || n === 'DEST_FLAG') return 'flagBroken';
  if (n === 'DMG_TOWER') return 'towerBroken';
  if (n.includes('DMG_WALL')) return 'wallBroken';
  if (n.startsWith('DEST') || n === 'STD_DEST' || n === 'DESTROYED_TOWER') return 'rubble';
  if (n.startsWith('BUSH')) return 'bush';
  if (n.startsWith('PALM')) return 'palm';
  if (n.startsWith('TREE')) return 'tree';
  if (n === 'CACTUS') return 'cactus';
  if (n.startsWith('ROCK')) return 'rock';
  if (n.startsWith('PLANTER')) return 'planter';
  if (n === 'AMMO') return 'ammo';
  if (n.startsWith('PRISON')) return 'prison';
  if (n === 'FLAG') return 'flag';
  if (n.startsWith('BLDG')) return 'house';
  if (n.startsWith('FACT')) return 'factory';
  if (n.startsWith('BNKR')) return 'hq';
  if (n === 'OUTPOST') return 'outpost';
  if (n.startsWith('HOSP')) return 'hospital';
  if (n.startsWith('FUEL')) return 'fuel';
  if (n.startsWith('GATE')) return 'gate';
  if (n.startsWith('WALL')) return 'wall';
  if (n.startsWith('TENT')) return 'tent';
  if (n === 'TOWER' || n === 'LARGE_TOWER') return 'tower';
  if (n === 'READY_TOWER' || n === 'ACTIVE_TOWER') return 'towerBase';
  if (n.startsWith('WTOWER') || n.startsWith('WATCHTOWER')) return 'watchtower';
  if (n.startsWith('BRIGE') || n.startsWith('BRIDGE')) return 'bridge';
  if (n === 'STORAGE_LIGHT') return 'light';
  return 'none';
}

/** Which way a building's front (door, pumps) faces, from its name's _N/_S/_E/_W, as a turn from north. */
function facing(name: string): number {
  const m = /_(N|S|E|W)$/.exec(name.toUpperCase());
  return m ? { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 }[m[1] as 'N' | 'E' | 'S' | 'W'] : 0;
}

/** A model's footprint and height from its vertices: the tallest of the building's parts, which is its body. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  h: number;
  /** Where the body stands from the tile's middle (the part's offset). */
  ox: number;
  oy: number;
  oz: number;
}

/**
 * The man-made things and the plants, which are moulded plastic playset pieces like the toys that fight over them.
 * Rocks are real stone (the garden's own, not the toy box's).
 */
const PLAYSET = new Set<Look>([
  'ammo', 'prison', 'flag', 'flagBroken', 'house', 'factory', 'hq', 'outpost', 'hospital', 'fuel', 'gate', 'wall',
  'wallBroken', 'tent', 'tower', 'towerBase', 'towerBroken', 'watchtower', 'rubble', 'bridge', 'light',
  'bush', 'palm', 'tree', 'cactus', 'stump', 'planter',
]);

/**
 * A rock about r across (squashed by sz up): a ball pushed in and out at random, so it is lumpy like a real stone,
 * and the same at every shared corner (the push is a function of the point), so it has no cracks.
 */
function lump(r: number, sz: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.618) * 43758.5453;
    const f = 0.82 + (h - Math.floor(h)) * 0.32;
    // A flatter bottom, so it sits on the ground rather than on a point.
    pos.setXYZ(i, x * f * r, Math.max(y * f, -0.35) * r * sz, z * f * r * 1.1);
  }
  return g;
}

/** Whether a building by this name is a plastic playset piece (its kit is a toy kit). */
export function playset(name: string): boolean {
  return PLAYSET.has(lookOf(name));
}

/**
 * A puddle of melted plastic at (x, y), about s across: a thin spread pool with slumped lumps on it, scorched dark,
 * with a little of the piece's own colour (tint) left in it.
 */
function melt(k: Kit, x: number, y: number, s: number, r: () => number, tint: number): void {
  // The pool: a few flat, overlapping spills, so its edge is ragged rather than a ring.
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : s * (0.12 + r() * 0.14);
    const rr = s * (i === 0 ? 0.3 : 0.14 + r() * 0.1);
    k.cyl(x + Math.cos(a) * d, y + Math.sin(a) * d, 0, rr, rr * 1.08, 0.5 + i * 0.05, i & 1 ? CHAR[1]! : darken(tint, 0.3), 12);
  }
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * s * 0.3;
    const big = s * (0.16 + r() * 0.14);
    const c = i === 0 ? darken(tint, 0.55) : i === 1 ? darken(tint, 0.35) : CHAR[1 + (i % 3)]!;
    k.ball(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.2, big, c, 1, 0.16 + r() * 0.14, { turn: r() * 6 });
  }
  // A drip run: a bent strip that sagged as it melted.
  const a = r() * Math.PI * 2;
  k.box(x + Math.cos(a) * s * 0.2, y + Math.sin(a) * s * 0.2, 0.4, s * 0.12, s * 0.42, 0.9, darken(tint, 0.45), { turn: a, tilt: 0.25 });
}

function darken(c: number, f: number): number {
  return new THREE.Color(c).multiplyScalar(f).getHex();
}

/** The building a wreck was, by the wreck's name (DEST_HOSP was a hospital), and how tall it stood. */
function wasBefore(name: string): { name: string; h: number } | null {
  const n = name.toUpperCase().replace(/^DEST_/, '');
  if (n === 'STD_DEST') return { name: 'BLDG_N', h: 20 };
  if (n === 'DESTROYED_TOWER' || n === 'TOWER') return { name: 'TOWER', h: 24 };
  if (n === 'JAIL' || n === 'PRISON') return { name: 'PRISON_S', h: 15 };
  if (n === 'HOSP') return { name: 'HOSP_S', h: 18 };
  if (n === 'AMMO') return { name: 'AMMO', h: 10 };
  if (n === 'FUEL') return { name: 'FUEL_N', h: 14 };
  if (n === 'OUTPOST') return { name: 'OUTPOST', h: 12 };
  if (n === 'TENT') return { name: 'TENT_V', h: 9 };
  if (n.startsWith('GATE')) return { name: n, h: 20 };
  if (n.startsWith('WTOWER')) return { name: 'WTOWER_NE', h: 30 };
  return null;
}

/** A building's kit at the tile's middle, its body box from the art pack, varied by seed. */
export function building(def: BuildingDef & { name?: string }, name: string, box: Box | null, seed: number): Kit | null {
  const look = lookOf(name);
  const r = seeded(seed + 17);
  const k = new Kit(PLAYSET.has(look), 2);
  const b = box ?? { x0: -16, x1: 16, y0: -16, y1: 16, h: 12, ox: 0, oy: 0, oz: 0 };
  const w = b.x1 - b.x0;
  const d = b.y1 - b.y0;
  const cx = (b.x0 + b.x1) / 2 + b.ox;
  const cy = (b.y0 + b.y1) / 2 + b.oy;
  const turn = facing(name);
  // A body turned by its facing: built facing north on a footprint of fw by fd, put back in place.
  const turned = (fw: number, fd: number, make: (k: Kit, fw: number, fd: number) => void) => {
    const inner = new Kit(k.toy, k.round);
    const side = Math.abs(Math.sin(turn)) > 0.5;
    make(inner, side ? fd : fw, side ? fw : fd);
    k.merge(inner, cx, cy, 0, { turn });
  };
  switch (look) {
    case 'none':
      return null;
    case 'bush': {
      // A moulded shrub: a few smooth leafy lumps.
      const n = 2 + Math.floor(r() * 2);
      const s = Math.min(w, d) / 2;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        k.ball(cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.3, s * 0.45, s * (0.42 + r() * 0.18), [LEAF, LEAF_DARK, LEAF_LIGHT][i % 3]!, 2, 0.8);
      }
      break;
    }
    case 'palm': {
      const h = b.h * (0.9 + r() * 0.2);
      const lean = (r() - 0.5) * 0.5;
      let x = cx;
      let y = cy;
      const segs = 5;
      for (let i = 0; i < segs; i++) {
        k.cyl(x, y, (i * h) / segs, 1.3 - i * 0.12, 1.6 - i * 0.12, h / segs + 0.3, i & 1 ? TRUNK : 0x8c6640, 6, { roll: lean * 0.4 });
        x += lean * 2;
      }
      const top = h;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + r();
        k.box(x + Math.sin(a) * 5, y - Math.cos(a) * 5, top - 1.5, 3.2, 11, 0.6, i & 1 ? LEAF : LEAF_LIGHT, { turn: a, tilt: -0.45 });
      }
      k.ball(x, y, top, 1.8, 0x6b4a2a, 0);
      break;
    }
    case 'tree': {
      const h = b.h * (0.9 + r() * 0.25);
      // A playset tree: a moulded trunk and a smooth crown of round leafy lumps.
      k.cyl(cx, cy, 0, 1.3, 2.1, h * 0.58, TRUNK, 10);
      k.ball(cx, cy, h * 0.66, 7.5, LEAF_DARK, 2, 0.85);
      k.ball(cx + 2.8, cy - 2, h * 0.84, 5.6, LEAF, 2, 0.85);
      k.ball(cx - 2.6, cy + 1.8, h * 0.8, 5.2, LEAF_LIGHT, 2, 0.85);
      k.ball(cx + 0.4, cy + 0.6, h * 0.98, 4.4, LEAF, 2, 0.85);
      break;
    }
    case 'cactus': {
      const h = Math.max(10, b.h);
      k.cyl(cx, cy, 0, 2, 2.3, h, 0x5a9a4a, 10).ball(cx, cy, h, 2, 0x5a9a4a, 0);
      k.cyl(cx + 3.6, cy, h * 0.4, 1.2, 1.2, h * 0.35, 0x5a9a4a, 6).box(cx + 2, cy, h * 0.4, 3, 2, 2, 0x5a9a4a);
      k.cyl(cx - 3.4, cy, h * 0.55, 1.1, 1.1, h * 0.25, 0x5a9a4a, 6).box(cx - 2, cy, h * 0.55, 3, 2, 1.8, 0x5a9a4a);
      break;
    }
    case 'rock': {
      // Real stones, in the photo-scanned rock: a big one with a smaller one or two leaning on it, and grit around.
      k.stone = true;
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const s = (i === 0 ? 5.5 : 3) + r() * 3.5;
        const x = cx + (i === 0 ? 0 : (r() - 0.5) * 10);
        const y = cy + (i === 0 ? 0 : (r() - 0.5) * 10);
        k.add(lump(s, 0.55 + r() * 0.3, seed + i * 7), x, y, s * 0.15, i & 1 ? STONE : ROCK, { turn: r() * 6, roll: (r() - 0.5) * 0.3 });
      }
      for (let i = 0; i < 4; i++) {
        const a = r() * Math.PI * 2;
        const d = 7 + r() * 5;
        const s = 0.8 + r() * 1;
        k.add(lump(s, 0.6, seed + 40 + i), cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0, i & 1 ? STONE : ROCK, { turn: r() * 6 });
      }
      break;
    }
    case 'planter': {
      k.box(cx, cy, 0, 30, 30, 3, CONCRETE);
      k.box(cx, cy, 0.5, 26, 26, 3, 0x6b4d30);
      if (/BERRY/i.test(name)) {
        for (let i = 0; i < 5; i++) {
          const x = cx + (r() - 0.5) * 18;
          const y = cy + (r() - 0.5) * 18;
          k.ball(x, y, 5, 4, LEAF_DARK, 0, 0.8);
          k.ball(x + 1.5, y - 1.5, 7.3, 0.9, 0xd02a2a, 0);
        }
      } else if (/STONE/i.test(name)) {
        k.ball(cx, cy, 4, 6, ROCK, 0, 0.6).cyl(cx, cy, 3.5, 3, 3.5, 4, 0xa7a59e, 8);
      } else {
        k.ball(cx, cy, 6, 9, LEAF, 1, 0.75);
      }
      break;
    }
    case 'ammo':
      turned(w, d, (t, fw, fd) => {
        t.box(0, 0, 0, fw, fd, 3, CONCRETE_DARK);
        t.add(halfTube(fw * 0.42, fd - 2), 0, 0, 3, 'team');
        t.box(0, -fd / 2 + 0.5, 3, fw * 0.4, 1, 7, 0x3a3d42);
        for (let i = 0; i < 3; i++) t.box(-fw / 2 + 3 + i * 3.6, fd / 2 + 2, 0, 3, 3, 3, WOOD);
      });
      break;
    case 'prison': {
      // The cell block (16 x 24, 15 high) and its watchtower on the north-east corner, as the art pack's parts.
      k.box(-7.5, -3.5, 0, 16, 24, 13, 0xa49c8c).box(-7.5, -3.5, 13, 17, 25, 1.4, 0x7d776b);
      for (let i = -2; i <= 2; i++) k.box(-7.5 + i * 2.6, -15.7, 3, 0.6, 0.6, 7, GUNMETAL);
      k.box(-7.5, -15.6, 0, 4, 0.6, 8, 0x3a3d42);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.box(9.5 + sx * 4.5, -9.5 + sy * 4.5, 0, 1.2, 1.2, 25, WOOD_DARK);
      k.box(9.5, -9.5, 24, 13, 13, 1.2, WOOD).box(9.5, -9.5, 25.2, 13, 13, 1.6, WOOD_DARK).roof(9.5, -9.5, 29.5, 14, 14, 4, 'team');
      k.box(4, 8, 0, 20, 1, 6, GUNMETAL).box(14, 0, 0, 1, 16, 6, GUNMETAL);
      break;
    }
    case 'flag': {
      k.box(cx, cy, 0, 14, 14, 2, CONCRETE).box(cx, cy, 2, 10, 10, 1.5, CONCRETE_DARK);
      k.cyl(cx, cy, 3.5, 0.6, 0.8, 26, METAL, 6).ball(cx, cy, 29.8, 1, HAZARD, 0);
      k.box(cx + 5.5, cy, 21, 10, 0.5, 7, 'team');
      break;
    }
    case 'flagBroken':
      k.box(cx, cy, 0, 14, 14, 2, CONCRETE_DARK);
      k.cyl(cx, cy, 2, 0.6, 0.8, 8, METAL, 6);
      k.cyl(cx + 6, cy + 2, 0.6, 0.6, 0.6, 16, METAL, 6, { roll: Math.PI / 2 - 0.1 });
      break;
    case 'house':
      turned(w, d, (t, fw, fd) => {
        const wall = WALLS[Math.floor(r() * WALLS.length)]!;
        const roof = ROOFS[Math.floor(r() * ROOFS.length)]!;
        const h = b.h * 0.62;
        t.box(0, 0, 0, fw - 2, fd - 2, h, wall);
        t.roof(0, 0, h, fw + 1, fd + 1, b.h - h + 2, roof, r() < 0.5);
        t.box(0, -fd / 2 + 1, 0, 5, 0.6, 6.5, WOOD_DARK);
        for (const s of [-1, 1]) t.box(s * (fw / 4 + 1), -fd / 2 + 1, 4, 4, 0.6, 3.4, 'window');
        t.box(fw / 4, 2, b.h - 1, 2.6, 2.6, 5, 0x8a5a48);
      });
      break;
    case 'factory':
      turned(w, d, (t, fw, fd) => {
        const h = b.h * 0.6;
        t.box(0, 0, 0, fw - 1, fd - 1, h, 0xc2bba8);
        for (let i = 0; i < 3; i++) t.wedge(0, -fd / 2 + fd / 6 + (i * fd) / 3, h, fw - 1, fd / 3, 4.5, 0.5, i & 1 ? 0x8f9aa6 : 0x7f8a96);
        t.cyl(fw / 2 - 5, fd / 2 - 5, h, 2, 2.6, b.h + 6 - h, 0x9c5a44, 8);
        t.box(0, -fd / 2 + 0.2, 0, 10, 0.6, 8, 'team');
        t.box(-fw / 2 + 0.2, 0, 4, 0.6, fd * 0.6, 3, 'window');
      });
      break;
    case 'hq':
      turned(w, d, (t, fw, fd) => {
        t.box(0, 0, 0, fw, fd, b.h * 0.45, CONCRETE);
        t.box(0, 1, b.h * 0.45, fw * 0.72, fd * 0.72, b.h * 0.35, CONCRETE_DARK);
        t.box(0, 1, b.h * 0.8, fw * 0.5, fd * 0.5, 3, 'team');
        t.cyl(fw * 0.2, 4, b.h * 0.8 + 3, 0.4, 0.5, 9, METAL, 5).ball(fw * 0.2, 4, b.h * 0.8 + 12.3, 1, 0xff4433, 0);
        t.box(0, -fd / 2, 0, 9, 1, 7, 0x2e3136);
        t.box(0, -fd / 2 - 0.3, 7, 12, 1, 1.5, 'team');
        for (const sx of [-1, 1]) t.box(sx * fw * 0.3, -fd / 2 - 0.2, 3, fw * 0.18, 0.6, 2.6, 'window');
        t.box(0, 1 - fd * 0.36 - 0.2, b.h * 0.55, fw * 0.5, 0.6, 2.4, 'window');
      });
      break;
    case 'outpost':
      k.box(cx, cy, 0, w, d, b.h * 0.65, 0xb0a07a).box(cx, cy, b.h * 0.65, w + 2, d + 2, 1.2, 'team');
      k.box(cx, cy - d / 2, b.h * 0.3, w * 0.6, 0.5, 3, 'window');
      k.box(cx, cy, b.h * 0.65 + 1.2, w * 0.7, d * 0.7, 4, 0x8a7a5a);
      break;
    case 'hospital':
      turned(w, d, (t, fw, fd) => {
        t.box(0, 0, 0, fw - 1, fd - 1, b.h * 0.85, 0xf2f0ea);
        t.box(0, 0, b.h * 0.85, fw, fd, 1, 0xc9c6bd);
        t.box(0, 0, b.h * 0.85 + 1, 8, 2.4, 0.3, 0xd52b2b).box(0, 0, b.h * 0.85 + 1, 2.4, 8, 0.3, 0xd52b2b);
        t.box(0, -fd / 2 + 0.2, 0, 6, 0.6, 7, 'window');
      });
      break;
    case 'fuel':
      turned(w, d, (t, fw) => {
        for (const s of [-1, 1]) {
          t.tube(s * fw * 0.24, 0, 7, fw * 0.22, d * 0.9, 0xd9d4c4, 12);
          t.box(s * fw * 0.24, 0, 0, fw * 0.3, 3, 3, GUNMETAL);
        }
        t.box(0, 0, 13, fw * 0.12, d * 0.8, 1, 'team');
        t.box(0, -d / 2 - 4, 0, 4, 2, 6, 'team').box(0, -d / 2 - 4, 6, 4.6, 2.6, 1, 0xf0f0f0);
      });
      break;
    case 'gate':
      // The posts; the leaves are the renderer's, as they swing open.
      for (const s of [-1, 1]) {
        const vertical = /_V$/i.test(name);
        const px = vertical ? cx : cx + s * 12;
        const py = vertical ? cy + s * 12 : cy;
        k.box(px, py, 0, 8, 8, 19, CONCRETE).box(px, py, 19, 9, 9, 1.5, 'team');
      }
      break;
    case 'wall':
    case 'wallBroken': {
      // A run of concrete wall in 8 px panels with a coping along the top; a damaged one has panels knocked down.
      const vertical = d > w;
      const len = vertical ? d : w;
      const segs = Math.max(1, Math.round(len / 8));
      const seg = len / segs;
      const at = (t: number, across = 0): [number, number] => (vertical ? [cx + across, cy + t] : [cx + t, cy + across]);
      for (let i = 0; i < segs; i++) {
        const t = -len / 2 + (i + 0.5) * seg;
        if (look === 'wallBroken' && (i === segs >> 1 || (i === (segs >> 1) - 1 && r() < 0.5))) {
          melt(k, ...at(t + (r() - 0.5) * 3, (r() - 0.5) * 3), 12, r, CONCRETE);
          continue;
        }
        const h = b.h - (look === 'wallBroken' ? r() * 6 : 0);
        k.box(...at(t), 0, vertical ? 11 : seg, vertical ? seg : 11, h, CONCRETE);
        k.box(...at(t), h, vertical ? 13 : seg, vertical ? seg : 13, 1.6, CONCRETE_DARK);
        k.box(...at(t - seg / 2), 0, vertical ? 11.4 : 0.6, vertical ? 0.6 : 11.4, h, CONCRETE_DARK);
      }
      break;
    }
    case 'tent':
      k.roof(cx, cy, 0, w, d, b.h, 0x6d7a45, w > d);
      k.box(cx, cy, 0, w * 0.3, d * 0.3, 2.5, 0x3d4428);
      break;
    case 'tower':
    case 'towerBase':
      k.merge(towerBase(b.h, r), cx, cy, 0);
      break;
    case 'towerBroken':
      k.merge(towerBase(b.h * 0.7, r), cx, cy, 0);
      melt(k, cx + (r() - 0.5) * 8, cy + (r() - 0.5) * 8, 30, r, CONCRETE);
      break;
    case 'watchtower': {
      const h = b.h;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.box(cx + sx * 4.5, cy + sy * 4.5, 0, 1.2, 1.2, h - 6, WOOD_DARK);
      k.box(cx, cy, h - 7, 13, 13, 1.2, WOOD);
      k.box(cx, cy, h - 5.8, 13, 13, 1.6, WOOD_DARK);
      k.roof(cx, cy, h - 1.5, 14, 14, 4, 'team');
      // The lamp hangs under the front of the floor, where it lights the ground round the tower (lightOf).
      k.box(cx, cy + 6.2, h - 8.6, 1.8, 1.4, 1.4, 'lamp');
      break;
    }
    case 'rubble': {
      // What's left of a plastic building after the fire: the building itself, melted down into a scorched puddle.
      const was = wasBefore(name);
      const s = Math.max(w, d) * 0.8;
      if (was) {
        Kit.fine = true;
        // A little smaller than the wreck's footprint, as the plastic ran out from under it.
        const f = 0.82;
        const whole = building(def, was.name, { ...b, x0: b.x0 * f, x1: b.x1 * f, y0: b.y0 * f, y1: b.y1 * f, h: Math.max(b.h, was.h) }, seed);
        Kit.fine = false;
        if (whole) k.merge(whole.melt(seed, 0.5));
      }
      melt(k, cx, cy, s, r, was ? CONCRETE : [WALLS[0]!, ROOFS[0]!, CONCRETE][Math.floor(r() * 3)]!);
      k.burnt = true;
      break;
    }
    case 'stump':
      // The stub of the tree's trunk where it snapped off.
      k.cyl(cx, cy, 0, 1.3, 2, 3, TRUNK, 10).ball(cx + 2, cy + 1, 0.5, 2.2, 0x4a3a28, 1, 0.4);
      break;
    case 'bridge': {
      const vertical = /_V$/i.test(name);
      for (let i = 0; i < 8; i++) {
        const t = -14 + i * 4;
        k.box(vertical ? cx : cx + t, vertical ? cy + t : cy, -0.3, vertical ? 30 : 3.6, vertical ? 3.6 : 30, 1, i & 1 ? WOOD : 0x9a6a3e);
      }
      for (const s of [-1, 1]) {
        k.box(vertical ? cx + s * 15 : cx, vertical ? cy : cy + s * 15, 0.7, vertical ? 1 : 33, vertical ? 33 : 1, 2.6, WOOD_DARK);
        for (let i = 0; i < 3; i++) {
          const t = -12 + i * 12;
          k.box(vertical ? cx + s * 15 : cx + t, vertical ? cy + t : cy + s * 15, -6, 2, 2, 7, WOOD_DARK);
        }
      }
      break;
    }
    case 'light':
      k.cyl(cx + 12, cy - 12, 0, 0.5, 0.7, 14, METAL, 5).box(cx + 12, cy - 13.5, 14, 2, 4, 1, 'lamp');
      break;
  }
  return k.empty ? null : k;
}

/** A gun tower's concrete base, height h, with the hatch ring the gun sits on. */
function towerBase(h: number, r: () => number): Kit {
  const k = new Kit(true);
  k.box(0, 0, 0, 30, 30, 3, CONCRETE_DARK);
  k.cyl(0, 0, 3, 11, 13, h - 3, r() < 0.5 ? CONCRETE : 0xa9a69c, 8);
  k.cyl(0, 0, h - 1, 12, 12, 1.2, HAZARD, 8);
  k.cyl(0, 0, h - 0.6, 10, 10, 1.4, GUNMETAL, 8);
  return k;
}

/** A gun tower's head: a turret with twin barrels, turned and pitched by the renderer about (0, 0, 0). */
export function towerGun(large: boolean): { head: Kit; barrels: Kit } {
  const head = new Kit(true);
  const s = large ? 1.25 : 1;
  head.cyl(0, 0, 0, 6 * s, 7.5 * s, 4.5 * s, 'team', 8);
  head.ball(0, 0, 4.5 * s, 5.5 * s, 'teamDark', 0, 0.55);
  const barrels = new Kit(true);
  for (const x of [-2.2, 2.2]) barrels.tube(x * s, -7 * s, 0, 1.1 * s, 12 * s, GUNMETAL, 6);
  barrels.box(0, -1, -1.5 * s, 7 * s, 3, 3 * s, 'teamDark');
  return { head, barrels };
}

/** A gate's leaf: a barred panel, length len along x, hinged at x = 0 and reaching to +len. */
export function gateLeaf(len: number): Kit {
  const k = new Kit(true);
  k.box(len / 2, 0, 1, len, 1.6, 1.4, 'team');
  k.box(len / 2, 0, 13, len, 1.6, 1.4, 'team');
  for (let i = 0; i <= 3; i++) k.box(0.6 + (i * (len - 1.2)) / 3, 0, 1, 1, 1.2, 13, HAZARD);
  return k;
}

/** A half cylinder lying north-south, radius r, for the ammo store's roof (three.js axes, about the origin). */
function halfTube(r: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, 10, 1, false, -Math.PI / 2, Math.PI);
  g.rotateX(-Math.PI / 2);
  return g;
}

export { METAL, GUNMETAL };

/**
 * Where a lit building's light at night stands (its lamp, or over its door), and how bright it is. Each light sits
 * just clear of its own walls, as a real lamp is fixed to them, so it throws true shadows: the building it hangs on
 * shades what is behind it, and a light never shines out from inside a wall.
 */
export function lightOf(name: string, box: Box | null): { x: number; y: number; z: number; power: number; colour: number } | null {
  const look = lookOf(name);
  const b = box ?? { x0: -16, x1: 16, y0: -16, y1: 16, h: 12, ox: 0, oy: 0, oz: 0 };
  const cx = (b.x0 + b.x1) / 2 + b.ox;
  const cy = (b.y0 + b.y1) / 2 + b.oy;
  // Over the door: out from the middle of the front wall (the side the name faces; houses' walls stand 1 inside
  // their footprint), a little way clear of it.
  const turn = facing(name);
  const fx = Math.sin(turn);
  const fy = -Math.cos(turn);
  const reach = (Math.abs(fx) > 0.5 ? (b.x1 - b.x0) : (b.y1 - b.y0)) / 2 + 4;
  const door = (z: number) => ({ x: cx + fx * reach, y: cy + fy * reach, z });
  switch (look) {
    case 'light': return { x: cx + 12, y: cy - 13.5, z: 12.5, power: 2600, colour: 0xffd890 };
    case 'watchtower': return { x: cx, y: cy + 7.2, z: b.h - 9, power: 1800, colour: 0xffc070 };
    case 'house': case 'outpost': return { ...door(8), power: 650, colour: 0xffc070 };
    case 'hq': case 'factory': case 'hospital': case 'fuel': return { ...door(10), power: 1400, colour: 0xffd090 };
    case 'prison': case 'gate': return { x: cx, y: cy, z: b.h + 6, power: 1400, colour: 0xffe0a8 };
    default: return null;
  }
}
