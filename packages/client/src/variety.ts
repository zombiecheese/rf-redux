// How some buildings vary from tile to tile: the draw and sort callbacks in the building models' chains that pick
// faces, cels and face variants from the tile's scenery entry (sub_42e4c0), the tile's position, or its neighbours.
// Each takes the head model and the variant from the tile's owner (0, 1, or 2 for neutral) and returns what to draw,
// or null when the original skips it.
import { GRID, tileVariety, type World } from '@rfw/sim';
import type { Model } from './assets.js';

const STD_DEST = 51;
const DEST_TENT = 64;
const DEST_FUEL = 77;
const DEST_PLANTER = 83;

/** Face cels for the houses (BLDG) and the factories (FACT): roof, broken wall, then the door and wall pairs. */
const BLDG_CELS = [0x38d, 0x3a3, 0x393, 0x39f, 0x397, 0x39b];
const FACT_CELS = [0x3aa, 0x3c0, 0x3b0, 0x3bc, 0x3b4, 0x3b8];
/** The roof's step by the variety's low three bits (0x452720). */
const ROOF_STEP = [0, 0, 2, 2, 2, 4, 4, 4];
/** STD_DEST's variant by a hash of the tile's position (0x454128). */
const RUBBLE_LOOK = [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 5, 0, 1, 2, 3, 4];

export interface Look {
  model: Model;
  variant: number;
}

/**
 * sub_436aa0 and sub_436b20 hash the tile's centre in pixels, (x + (y >> ((x & 3) + 1))) * -0x4be3 in 32 bits;
 * x is always 16 modulo 32, so the shift is always 1.
 */
function positionHash(i: number): number {
  const x = (i % GRID) * 32 + 16;
  const y = Math.floor(i / GRID) * 32 + 16;
  return Math.imul((y >> 1) + x, -0x4be3);
}

/**
 * sub_436900 for BLDG_N/S/E/W and FACT_N/S/E/W: the roof (face 4) steps by the variety's low bits, and each of the
 * left, right and front walls (faces 1-3) shows its broken cel when the tile beside it holds STD_DEST rubble, the door
 * on the building's door side (model word 4 byte 2: 1 left, 2 right, 3 front) with variety bits 3-4 choosing open
 * or shut, and otherwise the wall the variety's bits 5-6 name or the plain one. The left wall's cels are 2 on.
 */
function house(world: World, i: number, bid: number, model: Model, variant: number): Look {
  const cels = bid >= 27 ? FACT_CELS : BLDG_CELS;
  const v = tileVariety(world, i);
  const door = (bid - 23) & 3;
  // The door side of N, S, E and W from model word 4 byte 2 (0, 3, 2, 1).
  const side = [0, 3, 2, 1][door]!;
  const wall = (k: number, next: number) => {
    if (next >= 0 && next < world.building.length && world.building[next] === STD_DEST) return cels[1]!;
    if (side === k) return (v & 0x18) === 0x18 ? cels[3]! : cels[2]!;
    return ((v & 0x60) >> 5) === k ? cels[5]! : cels[4]!;
  };
  const faces = model.faces.map((f, k) => {
    if (k === 1) return { ...f, cel: wall(1, i - 1) + 2 };
    if (k === 2) return { ...f, cel: wall(2, i + 1) };
    if (k === 3) return { ...f, cel: wall(3, i + GRID) };
    if (k === 4) return { ...f, cel: cels[0]! + ROOF_STEP[v & 7]! };
    return f;
  });
  return { model: { ...model, faces }, variant };
}

/** The head model of the building on tile i as its draw callbacks would draw it. */
export function buildingLook(world: World, i: number, bid: number, model: Model, variant: number): Look | null {
  if (bid >= 23 && bid <= 30) return house(world, i, bid, model, variant);
  const v = tileVariety(world, i);
  const pick = (faces: Model['faces'], look = variant): Look => ({ model: { ...model, faces }, variant: look });
  switch (bid) {
    case STD_DEST:
      // sub_436b20: a look from the position hash, 6 on for any owner bits but 0.
      return { model, variant: RUBBLE_LOOK[(positionHash(i) & 0x1e000) >> 13]! + (variant ? 6 : 0) };
    case DEST_TENT:
      // sub_436aa0: 0, 2, 4 or 6 from the position hash, plus the owner bits.
      return { model, variant: ((positionHash(i) & 0xc000) >> 13) + variant };
    case DEST_FUEL:
      // sub_436860: the owner bits pick a pair of faces, then the variety's low bits are the face variant.
      return pick(model.faces.slice(variant * 2, variant * 2 + 2), v & 3);
    case 78: case 79: case 80: case 81:
      // sub_436820: one of four faces, each the same quad turned a quarter further.
      return pick(model.faces.slice(v & 3, (v & 3) + 1));
    case DEST_PLANTER:
      // sub_4368a0: none on owner bits 1; its variant follows the ground's terrain cel.
      if (variant === 1) return null;
      return { model, variant: (v & 1) + (world.terrain[i]! & 0x7f) * 2 - 0xba };
    case 84: case 85: case 86:
      // sub_4367d0: one of four turned faces from variety bits 1-2, variant from bit 0.
      return pick(model.faces.slice((v >> 1) & 3, ((v >> 1) & 3) + 1), v & 1);
    case 87: case 88: {
      // sub_436760: the second face's corners turned by the variety's low bits; owner bits 1 draw it alone.
      const u = v & 3;
      const top = { ...model.faces[1]!, v: [u, (u + 1) & 3, (u + 2) & 3, (u + 3) & 3] as [number, number, number, number] };
      return pick(variant === 1 ? [top] : [model.faces[0]!, top]);
    }
    default:
      return { model, variant };
  }
}
