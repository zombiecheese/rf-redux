// The bunker lift screen shown while a player is in the bunker: sky and clouds, the ground cut away to show the
// lift shaft and its four bays, a parked vehicle in each bay that still has lives, the lift standing in the shaft,
// and a spotlight and running lights on the chosen bay (sub_417d60). The sky and ground are measured from a
// screenshot of the original (halved to 320 x 240) and laid out from the view's centre so the split-screen views get
// the same scene; the bays, lift and lights are placed from the shaft as the original does (table 0x4491c0).
//
// While a vehicle is launched the lift comes to its bay's row, the vehicle slides onto it and the two rise up the
// shaft (the elevator, sim lift.ts), and the screen fades out to the map.

import { ONE, type Elevator, type Lives, type VehicleKind } from '@rfw/sim';
import type { GameAssets } from './assets.js';
import type { ViewRect } from './camera.js';
import { artSide, paintOf, paintedCel } from './paint.js';
import { type Frame, rgb } from './raster.js';

const SKY = rgb(87, 168, 179);
const CLOUD = [2088, 2087];
const HORIZON = 2085;
const LIFT_DOOR = 2084;
const DIRT = [2080, 2081, 2082, 2083];
const SHAFT = 2075;
/** The shaft cel's top left, from the view's centre and top. */
const SHAFT_AT = { dx: -65, y: 23 };
/** The lift: its platform (cel 2076) on a column of cel 2079 stretched to the bottom of the view, 51.5 px in. */
const LIFT_TOP = 2076;
const LIFT_COLUMN = 2079;
const LIFT_X = 51.5;
const SPOTLIGHT = 2077;
/** The dark doorway behind the chosen bay's vehicle, and its running lights (three frames, 16 ticks each). */
const DOORWAY = 2078;
const RUNNING_LIGHTS = 2091;
/** Side views of each vehicle on its lift platform: team 0 then team 1. */
const PARKED: Record<VehicleKind, number> = { tank: 2094, jeep: 2096, asv: 2098, heli: 2100 };
/**
 * Each bay, from the shaft's top left (0x4491c0, 40 bytes a bay): where its vehicle's half-size side view goes (its
 * top left, less 2 and 3 px), its running lights, its spotlight and its doorway.
 */
const BAY: Record<VehicleKind, { vehicle: [number, number]; lights: [number, number]; spot: [number, number]; door: [number, number] }> = {
  tank: { vehicle: [85, 54], lights: [87, 73], spot: [85, 52], door: [87, 45] },
  jeep: { vehicle: [85, 92], lights: [87, 112], spot: [85, 90], door: [87, 83] },
  asv: { vehicle: [13, 92], lights: [12, 112], spot: [13, 90], door: [15, 83] },
  heli: { vehicle: [13, 54], lights: [12, 73], spot: [13, 52], door: [15, 45] },
};
/** Bays in screen order, for moving the choice between them: top left, top right, bottom left, bottom right. */
export const BAYS: { kind: VehicleKind }[] = [{ kind: 'heli' }, { kind: 'tank' }, { kind: 'asv' }, { kind: 'jeep' }];
/** The bay sprites are drawn at half size (the CCB's scale halved). */
const PARKED_SCALE = 0.5;
/** The lift's height in the shaft when no vehicle is going up: level with the lower bays. */
const LIFT_REST = 110;

/**
 * Draws the bunker. selected is the chosen bay; elevator, while one is going up, moves the lift and that vehicle.
 * fade (0 to ONE) is how lit the screen is.
 */
export function drawBunker(
  frame: Frame, view: ViewRect, assets: GameAssets, base: number, lives: Lives, selected: VehicleKind,
  elevator: Elevator | null, tick: number, fade = ONE,
): void {
  frame.setClip(view.x, view.y, view.w, view.h);
  frame.fill(SKY);
  const cx = view.x + view.w / 2;
  const put = (cel: number, x: number, y: number) => {
    const c = assets.cel(cel);
    if (c) frame.blit(c, Math.round(x), Math.round(view.y + y));
  };
  // Tiles run in 64-pixel strips from the view centre so the lift door stays centred.
  const left = cx - 31 - 64 * Math.ceil((cx - 31 - view.x) / 64);
  for (let x = left, k = 0; x < view.x + view.w; x += 64, k++) {
    put(CLOUD[k % 4 === 0 ? 0 : 1]!, x, 5);
    put(Math.abs(x - (cx - 31)) < 1 ? LIFT_DOOR : HORIZON, x, 17);
  }
  for (let y = 43, j = 0; y < view.h; y += 32, j++) {
    for (let x = left, k = 0; x < view.x + view.w; x += 32, k++) put(DIRT[(j * 3 + k * 7 + ((j * k) >> 1)) & 3]!, x, y);
  }
  const ox = cx + SHAFT_AT.dx;
  const oy = SHAFT_AT.y;
  put(SHAFT, ox, oy);
  const chosen = elevator?.kind ?? selected;
  for (const kind of ['tank', 'jeep', 'asv', 'heli'] as const) {
    const bay = BAY[kind];
    const mine = kind === chosen;
    if (mine) put(DOORWAY, ox + bay.door[0], oy + bay.door[1]);
    if (mine || lives[kind] > 0) {
      // Brown's side view, Green's one cel on; bases 3 and 4 repaint Brown's (paint.ts).
      const cel = artSide(base) ? assets.cel(PARKED[kind] + 1) : paintedCel(assets.cel, PARKED[kind], 1, paintOf(base));
      if (cel) {
        const dx = mine && elevator ? elevator.dx / ONE : 0;
        const dy = mine && elevator ? elevator.dy / ONE : 0;
        const x = ox + bay.vehicle[0] + 2 + dx;
        const top = view.y + oy + bay.vehicle[1] + 3 + dy;
        const w = cel.w * PARKED_SCALE;
        const h = cel.h * PARKED_SCALE;
        frame.quad([{ x, y: top }, { x: x + w, y: top }, { x: x + w, y: top + h }, { x, y: top + h }], cel);
      }
    }
    if (!mine) continue;
    // The running lights, mirrored on the right-hand bays.
    const lights = assets.cel(RUNNING_LIGHTS + ((tick >> 4) % 3));
    if (lights) {
      const x = ox + bay.lights[0] + 0.4;
      const y = view.y + oy + bay.lights[1] + 1;
      const [l, r] = bay.lights[0] > 60 ? [x + lights.w + 1, x + 1] : [x, x + lights.w];
      frame.quad([{ x: l, y }, { x: r, y }, { x: r, y: y + lights.h }, { x: l, y: y + lights.h }], lights);
    }
    put(SPOTLIGHT, ox + bay.spot[0], oy + bay.spot[1]);
  }
  // The lift: its column from the platform down past the bottom of the view, then the platform on top.
  const lift = view.y + oy + (elevator ? elevator.lift / ONE : LIFT_REST);
  const column = assets.cel(LIFT_COLUMN);
  if (column) {
    const x0 = ox + LIFT_X;
    const x1 = x0 + column.w;
    const bottom = view.y + view.h + 2;
    frame.quad([{ x: x0, y: lift }, { x: x1, y: lift }, { x: x1, y: bottom }, { x: x0, y: bottom }], column);
  }
  const top = assets.cel(LIFT_TOP);
  if (top) frame.quad([{ x: ox + LIFT_X, y: lift }, { x: ox + LIFT_X + top.w, y: lift }, { x: ox + LIFT_X + top.w, y: lift + top.h }, { x: ox + LIFT_X, y: lift + top.h }], top);
  if (fade < ONE) frame.dim(fade / ONE);
}
