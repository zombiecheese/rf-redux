// What the editor learns from the game data when it loads: each terrain tile's average colour (for the minimap),
// which tile each one becomes when mirrored or turned (matched in the sim), the building palette and its icons,
// and the lift tile the original maps put under a base's start.

import { matchTileTransforms, transformType, type BuildingDef, type ShorePainter, type Transform } from '@rfw/sim';
import type { GameAssets, GameData } from '../assets.js';
import { Camera } from '../camera.js';
import { Frame } from '../raster.js';
import { drawBuilding } from '../view.js';

/** The average colour of each terrain tile, as CSS-ready RGB triples. */
export function tileColours(data: GameData): [number, number, number][] {
  return Array.from({ length: 128 }, (_, t) => {
    const cel = data.cel(t);
    if (!cel) return [0, 0, 0];
    let r = 0;
    let g = 0;
    let b = 0;
    for (const c of cel.px) {
      r += c & 255;
      g += (c >> 8) & 255;
      b += (c >> 16) & 255;
    }
    const n = cel.px.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

/**
 * Which terrain each terrain becomes under each transform (tileTransforms in the sim), from the tile pictures.
 */
export function tileTransforms(data: GameData, painter: ShorePainter): Record<Transform, Uint8Array> {
  return matchTileTransforms((t) => data.cel(t) ?? null, painter);
}

export type PaletteGroup = 'Scenery' | 'Defences' | 'Buildings';

export interface PaletteEntry {
  def: BuildingDef;
  group: PaletteGroup;
  /** Whether it is usually owned by a base (turrets, bunkers, depots) or neutral (scenery). */
  owned: boolean;
}

/** Buildings shown by other means: nothing, the flag (placed as flag sites) and bridge decks (laid between ends). */
const HIDDEN = new Set(['NOTHING', 'FLAG', 'BRIGE_H', 'BRIGE_V']);

/**
 * The buildings a map can place: every one with a model, except what a building turns into when destroyed (those
 * only appear in a match) and the pieces placed by other tools.
 */
export function palette(data: GameData): PaletteEntry[] {
  const ruins = new Set<number>();
  for (const d of data.defs) if (d.becomes) ruins.add(d.becomes);
  const out: PaletteEntry[] = [];
  for (const def of data.defs) {
    if (!def.id || HIDDEN.has(def.name) || ruins.has(def.id) || /DEST|DMG/.test(def.name)) continue;
    if (!data.parts[def.id]?.some((p) => p.model)) continue;
    const scenery = def.jitter || def.contact === 'rock' || def.contact === 'scenery';
    const defence = /TOWER|GUN|TURRET|WALL|GATE|FENCE/.test(def.name);
    out.push({ def, group: scenery ? 'Scenery' : defence ? 'Defences' : 'Buildings', owned: !scenery });
  }
  return out;
}

const ICON = 40;

/** A building drawn as the game shows it in an owner's colours (-1 neutral), on a transparent square, for the palette. */
export function buildingIcon(assets: GameAssets, id: number, owner: number): HTMLCanvasElement {
  const frame = new Frame(ICON, ICON);
  frame.fill(0);
  const cam = new Camera({ x: 0, y: 0, w: ICON, h: ICON, dx: 0, dy: 6, boxW: ICON, boxH: ICON });
  cam.fix(16, 16, 80, 32);
  cam.begin();
  drawBuilding(frame, cam, assets, id, 16, 16, owner);
  const canvas = document.createElement('canvas');
  canvas.width = ICON;
  canvas.height = ICON;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.px.buffer), ICON, ICON), 0, 0);
  return canvas;
}

/** A terrain tile's picture, for the tile palette. */
export function tileIcon(data: GameData, t: number, size = 32): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const cel = data.cel(t);
  if (!cel) return canvas;
  const small = document.createElement('canvas');
  small.width = cel.w;
  small.height = cel.h;
  const px = new Uint32Array(cel.px);
  for (let i = 0; i < px.length; i++) px[i]! |= 0xff000000;
  small.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), cel.w, cel.h), 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, size, size);
  return canvas;
}

/** A building name with its facing turned, if the table has that piece. */
export function turnedType(t: Transform, name: string, defs: readonly BuildingDef[]): string {
  return transformType(t, name, new Set(defs.map((d) => d.name)));
}
