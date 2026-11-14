// The laughing skull a player sees after losing a vehicle (sim death.ts; drawn by sub_418510): the skull in the
// middle of the view, growing and spinning in over the map, then laughing on black over a row of the lost
// vehicle's icons, the ones already used crossed out.

import { ONE, UNLIMITED, type Lives, type Player, type SkullLook, type VehicleKind } from '@rfw/sim';
import type { Cel, GameAssets } from './assets.js';
import type { ViewRect } from './camera.js';
import { artSide, paintOf, paintedCel } from './paint.js';
import type { Frame } from './raster.js';

/** The faces, shut (1) to wide open (7), follow this cel: Brown's helmet, then Green's 7 on. */
const SKULL = 2125;
const GREEN = 7;
/** The skull's corners about its middle (0x4492b0), before it is sized and spun. */
const CORNERS = [[-32, -32], [31, -32], [31, 31], [-32, 31]] as const;
/** The cross over a used life (cel 2125, the cel before the faces). */
const CROSS = 2125;
/**
 * The row of lives for each vehicle (0x449308, 28 bytes each): its icon, how far under the skull the first row is,
 * the icons' spacing, the rows' spacing, and where the cross goes on an icon.
 */
const ROW: Record<VehicleKind, { icon: number; y: number; step: number; row: number; cross: [number, number] }> = {
  tank: { icon: 2104, y: 10, step: 19, row: 10, cross: [4, 7] },
  jeep: { icon: 2109, y: 10, step: 16, row: 10, cross: [4, 7] },
  asv: { icon: 2114, y: 10, step: 19, row: 10, cross: [4, 7] },
  heli: { icon: 2120, y: 10, step: 19, row: 10, cross: [4, 7] },
};
/** At most 8 icons show, 4 to a row. */
const MOST = 8;
const PER_ROW = 4;

/**
 * Draws the skull over the view: the map (already drawn, and dimmed by the caller) until it has faded out, black
 * after. start is the player's lives at the start of the match.
 */
export function drawSkull(frame: Frame, view: ViewRect, assets: GameAssets, p: Player, look: SkullLook, start: Lives, rival = p.base ^ 1): void {
  frame.setClip(view.x, view.y, view.w, view.h);
  if (look.map === null) frame.fill(0xff000000);
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  // The other side's helmet: Brown (base 0) is laughed at by Green. With three or four bases it is a rival's (rivalOf
  // in the sim), and bases 3 and 4 wear Brown's helmet repainted (paint.ts).
  const skull = artSide(rival) ? assets.cel(SKULL + look.face + GREEN) : paintedCel(assets.cel, SKULL + look.face, GREEN, paintOf(rival));
  if (skull) {
    const s = look.scale / ONE;
    const a = (look.angle / ONE / 64) * Math.PI * 2;
    const sin = Math.sin(a) * s;
    const cos = Math.cos(a) * s;
    frame.quad(CORNERS.map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos })), skull);
  }
  const kind = p.death?.kind;
  if (look.lives !== null && kind) {
    const row = ROW[kind];
    const icon = assets.cel(row.icon);
    const cross = assets.cel(CROSS);
    const keep = Math.round((look.lives / ONE) * 16);
    const left = p.lives[kind] === UNLIMITED ? Infinity : p.lives[kind];
    let n = start[kind] === UNLIMITED ? MOST : Math.min(MOST, start[kind]);
    let y = cy + (skull ? skull.h / 2 : 32) + row.y;
    // Left to right, top row first, counting down: the icons from the number left on are crossed out.
    for (let i = n; n > 0 && icon && keep > 0; y += row.row) {
      const inRow = Math.min(PER_ROW, n);
      n -= inRow;
      let x = Math.trunc((2 * cx - row.step * inRow) / 2);
      for (let k = 0; k < inRow; k++, x += row.step) {
        i--;
        put(frame, icon, x, y, keep);
        if (cross && i >= left) put(frame, cross, x + row.cross[0], y + row.cross[1], keep);
      }
    }
  }
  if (look.light < ONE) frame.dim(look.light / ONE);
}

function put(frame: Frame, cel: Cel, x: number, y: number, keep: number): void {
  frame.quad([{ x, y }, { x: x + cel.w, y }, { x: x + cel.w, y: y + cel.h }, { x, y: y + cel.h }], cel, false, undefined, Math.min(16, keep));
}
