// The garden's small things, scattered on the ground at the real scale of the toys: sun-bleached pebbles, tufts of grass, fallen leaves and twigs. Each lies where the ground suits it (pebbles on sand and soil, grass
// on the lawn and the odd tuft in the sand, leaves and twigs under the beds), never on a road, in the water or under a
// building. They are made once per patch of the map, from a seed of each spot, so they stay put as the patch is
// rebuilt, and drawn as instances: one draw for each kind in a patch.

import * as THREE from 'three';
import { ART } from './art.js';
import { lump } from './buildings.js';
import { Kit, seeded } from './kit.js';

/** Smooth value noise, 0 to 1, with features about a unit apart. */
function noise(x: number, y: number): number {
  const hash = (i: number, j: number) => {
    const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * u;
  const b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * u;
  return a + (b - a) * v;
}

/** What the ground is at a point, in game units: its sand, darker sand and lawn, each 0 to 1. */
export type Cover = (x: number, y: number) => [number, number, number];

interface Kind {
  /** The shapes: one draw for each in a patch, so one is usually enough (each is turned and sized at random). */
  shapes: THREE.BufferGeometry[];
  /** How many fall on a game unit squared of each of sand, darker sand and lawn, at full density. */
  per: [number, number, number];
  /** Its size range, as a scale of the shape. */
  size: [number, number];
  /** Its colours, one picked for each. */
  colours: number[];
  stone: boolean;
  /** Whether it throws a shadow (the pebbles; the rest are too thin to matter). */
  shadow: boolean;
  /** Turned to lie flat at random (leaves, twigs), not only about the up axis. */
  tumble: number;
}

let kinds: Kind[] | null = null;

/** A tuft of grass: thin, tapered blades leaning out from a point, dark at the root and lighter at the tip. */
function tuft(seed: number): THREE.BufferGeometry {
  const r = seeded(seed);
  const k = new Kit();
  const n = 5 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    const h = 3.5 + r() * 3;
    const lean = 0.3 + r() * 0.5;
    const x = Math.cos(a) * 0.4;
    const y = Math.sin(a) * 0.4;
    // A blade: three-sided, wide at the root, to a point.
    k.cyl(x, y, 0, 0, 0.38, h, i & 1 ? 0x6a8a3c : 0x7f9a4a, 3, { turn: a + Math.PI / 2, tilt: lean });
  }
  return k.build();
}

/** A fallen leaf: a thin, pointed oval with a little curl. */
function leaf(): THREE.BufferGeometry {
  const k = new Kit();
  k.ball(0, 0, 0.05, 1, 0xffffff, 1, 0.08);
  const g = k.build();
  g.scale(1, 1, 1.8);
  return g;
}

/** A twig: a thin stick with a fork near one end. */
function twig(seed: number): THREE.BufferGeometry {
  const r = seeded(seed);
  const k = new Kit();
  const len = 5 + r() * 4;
  k.cyl(0, 0, 0.15, 0.12, 0.2, len, 0xffffff, 5, { tilt: Math.PI / 2 });
  k.cyl(0, -len * 0.6, 0.15, 0.06, 0.12, len * 0.35, 0xffffff, 4, { tilt: Math.PI / 2, turn: 0.6 });
  return k.build();
}

/** A pebble: a small lumpy stone, flat underneath. */
function pebble(seed: number): THREE.BufferGeometry {
  const k = new Kit();
  k.add(lump(1, 0.55, seed), 0, 0, 0.15, 0xffffff);
  return k.build();
}

function kindsOf(): Kind[] {
  if (kinds) return kinds;
  kinds = [
    {
      shapes: [pebble(11)],
      per: [0.0014, 0.002, 0.0003],
      size: [0.6, 2.2],
      // Small stones bleached in the sun, too small for the rock scan to show: plain greys and sandy tones.
      colours: [0xb8b2a6, 0xd0c8b8, 0x9a948a, 0xc4bcae, 0x8a8478],
      stone: false,
      shadow: true,
      tumble: 0,
    },
    {
      shapes: [tuft(17)],
      per: [0.0007, 0.0008, 0.006],
      size: [0.8, 1.3],
      colours: [0xffffff, 0xe8f0c8, 0xd8c890, 0xc8d8a8, 0xe0d0a0],
      stone: false,
      shadow: false,
      tumble: 0,
    },
    {
      shapes: [leaf()],
      per: [0.00008, 0.0016, 0.0012],
      size: [1.3, 2.3],
      // Dry leaves: dull browns and a few faded yellows.
      colours: [0x7a6040, 0x8c7048, 0x65553a, 0x9c8a5a, 0x6e4e30],
      stone: false,
      shadow: false,
      tumble: 0.25,
    },
    {
      shapes: [twig(7)],
      per: [0.00008, 0.0005, 0.0002],
      size: [0.6, 1.2],
      colours: [0x6b4a2e, 0x7a5a3a, 0x5a4030],
      stone: false,
      shadow: false,
      tumble: 0.08,
    },
  ];
  return kinds;
}

/**
 * The scatter on the patch [x0, x1) x [y0, y1) (game units) as instanced meshes, in stone (stone) or the plain
 * material (plain). blocked says where nothing may lie (a building's tile).
 */
export function scatterPatch(x0: number, y0: number, x1: number, y1: number, cover: Cover, blocked: (x: number, y: number) => boolean, stone: THREE.Material, plain: THREE.Material): THREE.InstancedMesh[] {
  if (!ART.scatter) return [];
  const out: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  // Spots on a grid of cells, each cell's own seed, so a patch built again comes out the same.
  const CELL = 8;
  kindsOf().forEach((kind, ki) => {
    for (let si = 0; si < kind.shapes.length; si++) {
      const at: THREE.Matrix4[] = [];
      const tint: THREE.Color[] = [];
      for (let cy = Math.floor(y0 / CELL); cy < Math.ceil(y1 / CELL); cy++) {
        for (let cx = Math.floor(x0 / CELL); cx < Math.ceil(x1 / CELL); cx++) {
          const r = seeded(((cy * 4099 + cx) * 7 + ki) * 13 + si + 1);
          r();
          const x = (cx + r()) * CELL;
          const y = (cy + r()) * CELL;
          const [sa, da, la] = cover(x, y);
          // Things lie in drifts, not evenly: thick in some places, bare in others, each kind in its own.
          const n0 = noise(x / 90 + ki * 17.3, y / 90 - ki * 9.1);
          const drift = Math.max(0, (n0 - 0.35) / 0.4) ** 1.5 * 2.2;
          const chance = (kind.per[0] * sa + kind.per[1] * da + kind.per[2] * la) * drift * CELL * CELL * ART.scatterDensity / kind.shapes.length;
          // Up to two in a cell, for the denser lawn grass.
          const n = Math.floor(chance) + (r() < chance % 1 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const px = i === 0 ? x : (cx + r()) * CELL;
            const py = i === 0 ? y : (cy + r()) * CELL;
            if (sa + da + la < 0.6 || blocked(px, py)) continue;
            const size = kind.size[0] + r() * (kind.size[1] - kind.size[0]);
            e.set((r() - 0.5) * kind.tumble * 2, r() * Math.PI * 2, (r() - 0.5) * kind.tumble * 2, 'YXZ');
            q.setFromEuler(e);
            p.set(px, 0, py);
            s.set(size, size, size);
            at.push(new THREE.Matrix4().copy(m.compose(p, q, s)));
            tint.push(c.setHex(kind.colours[Math.floor(r() * kind.colours.length)]!).clone());
          }
        }
      }
      if (!at.length) continue;
      const mesh = new THREE.InstancedMesh(kind.shapes[si]!, kind.stone ? stone : plain, at.length);
      at.forEach((a, i) => {
        mesh.setMatrixAt(i, a);
        mesh.setColorAt(i, tint[i]!);
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = kind.shadow;
      mesh.receiveShadow = true;
      // The shapes are shared by every patch: a patch's disposal leaves them be.
      mesh.userData.shared = true;
      out.push(mesh);
    }
  });
  return out;
}
