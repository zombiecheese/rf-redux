// The cockpit under the views: the RFA panel bitmap (1PBSCRL or 2PBSCRL), one console cel per player for the
// vehicle it drives (or the bunker console), and the live parts drawn into the console: gauges, radar, the jeep's
// grenade rack, the helicopter's weapon lights and the bunker's counters. Gauges come from the vehicle definitions
// (sub_412cd0 sets them up per vehicle); the radar and bunker positions are measured from screenshots of the
// original at 640 x 480, halved to the 320 x 240 frame.

import { GRID, NO_TERRAIN, ONE, liftOf, UNLIMITED, VEHICLES, WATER_TERRAIN, type Match, type Vehicle, type VehicleKind } from '@rfw/sim';
import type { Cel, GameAssets } from './assets.js';
import { type Frame, SCREEN_H, SCREEN_W, rgb } from './raster.js';
import { BASE_COLOURS } from './view.js';

/** Console cels: 1943 plus the vehicle's index (sub_411b70), plus the bunker's frame and its joypad grid. */
const CONSOLE: Record<VehicleKind, number> = { tank: 1943, jeep: 1944, asv: 1945, heli: 1946 };
const BUNKER_FRAME = 1940;
const BUNKER_PAD = 1942;
/** Console top left: below the single view, and under each half of the split screen. */
const PANEL_1P = { y: 152, consoles: [{ x: 87, y: 168 }] };
const PANEL_2P = { y: 148, consoles: [{ x: 14, y: 162 }, { x: 165, y: 162 }] };
/** The bunker frame sits 3 pixels up and left of a vehicle console. */
const BUNKER_FRAME_AT = { dx: -3, dy: -2 };
const BUNKER_PAD_AT = { dx: 9, dy: 2 };
/** The split-screen divider: the left half of 2PMSCR (drawn for 640 x 480) at half size, between the views. */
const DIVIDER_X = 156;
const DIVIDER_W = 8;

/** RGB555 as the frame's colour word. */
const rgb555 = (c: number) => {
  const five = (n: number) => ((n << 3) | (n >> 2)) & 0xff;
  return rgb(five((c >> 10) & 31), five((c >> 5) & 31), five(c & 31));
};
/** A gauge's unfilled part (DAT_00446758). */
const BAR_OFF = rgb555(0x0884);
/** Filled colours by level, and the dimmed set for the helicopter's weapon not picked (DAT_00446760, DAT_00446778). */
const LEVEL = [0x7c00, 0x7d20, 0x7e20, 0x7f40].map(rgb555);
const LEVEL_DIM = [0x4000, 0x40a0, 0x4100, 0x41a0].map(rgb555);
/** An almost empty fuel gauge flashes between red and this every 32 ticks. */
const FUEL_FLASH = rgb555(0x4000);
/** Gauges move toward their value by 0.6 pixels a tick (the descriptors' word 11, 0x9999). */
const GAUGE_RATE = 0x9999;
/** A count rounds up (0xe666 is added both to the target and to the drawn length). */
const ROUND_UP = 0xe666;

/**
 * A bar gauge, from the vehicle definitions' gauge descriptors (definition words 0x65, 0x72 and 0x7f): its rows and
 * columns, inclusive. Ammo bars are drawn by sub_411da0, fuel bars by sub_411f80.
 */
interface Gauge {
  kind: 'ammo' | 'fuel';
  slot: number;
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

const GAUGES: Record<VehicleKind, Gauge[]> = {
  tank: [
    { kind: 'ammo', slot: 0, y0: 31, y1: 34, x0: 76, x1: 115 },
    { kind: 'fuel', slot: 0, y0: 12, y1: 15, x0: 88, x1: 127 },
  ],
  // The jeep's grenades are a rack of pips (sub_4127b0), drawn by drawGrenades.
  jeep: [{ kind: 'fuel', slot: 0, y0: 10, y1: 12, x0: 15, x1: 50 }],
  asv: [
    { kind: 'ammo', slot: 0, y0: 11, y1: 13, x0: 29, x1: 73 },
    { kind: 'ammo', slot: 1, y0: 41, y1: 43, x0: 29, x1: 73 },
    { kind: 'fuel', slot: 0, y0: 26, y1: 28, x0: 19, x1: 63 },
  ],
  heli: [
    { kind: 'ammo', slot: 0, y0: 45, y1: 47, x0: 55, x1: 103 },
    { kind: 'ammo', slot: 1, y0: 25, y1: 27, x0: 110, x1: 135 },
    { kind: 'fuel', slot: 0, y0: 25, y1: 27, x0: 9, x1: 33 },
  ],
};

/**
 * The helicopter's weapon lights (sub_412a00): missiles at (91, 20) and gun at (36, 36), each lit (1977, 1979) when
 * picked and dark (1978, 1980) when not.
 */
const HELI_LIGHTS = [
  { x: 36, y: 36, lit: 1979, dark: 1980 },
  { x: 91, y: 20, lit: 1977, dark: 1978 },
];

/** What each local player's gauges show, moving toward their values a tick at a time. */
const shown: { kind: VehicleKind | null; tick: number; values: number[] }[] = [];

/** Radar windows; only console pixels of the window's dark colour are painted, which gives the helicopter its round one. */
const RADAR: Partial<Record<VehicleKind, { x: number; y: number; w: number; h: number }>> = {
  tank: { x: 19, y: 11, w: 32, h: 32 },
  asv: { x: 89, y: 9, w: 39, h: 34 },
  heli: { x: 54, y: 4, w: 33, h: 32 },
};
const RADAR_GRID = 1963;
/** Radar colours sampled from the screenshots. */
const RADAR_WATER = rgb(4, 97, 152);
const RADAR_LAND = rgb(18, 78, 131);
const RADAR_SELF = rgb(225, 174, 140);
const RADAR_OTHER = rgb(61, 153, 14);
/** Tiles per radar pixel (inferred: the screenshots show about a quarter of the map). */
const RADAR_SCALE = 2;

/** The jeep's rack: two rows of eight grenades (cel 1968; DAT_00446798, measured one pixel further in). */
const GRENADE = 1968;
const GRENADE_SLOTS = Array.from({ length: 16 }, (_, i) => ({ x: 63 + (i % 8) * 8, y: i < 8 ? 22 : 39 }));

/** Bunker console counters: the chosen vehicle's icon and lives, then its weapon icon and rounds. */
const VEHICLE_ICON: Record<VehicleKind, number> = { jeep: 2161, heli: 2162, tank: 2163, asv: 2164 };
const WEAPON_ICON: Record<VehicleKind, number> = { jeep: 2156, asv: 2157, heli: 2159, tank: 2160 };
const DIGIT = 2146;
const BUNKER_ICON_AT = { dx: 21, dy: 6 };
const BUNKER_LIVES_AT = { dx: 44, dy: 8 };
const BUNKER_WEAPON_AT = { dx: 21, dy: 31 };
const BUNKER_ROUNDS_AT = { dx: 32, dy: 33 };

/** viewers: the player each view shows, left to right (one view, or two side by side). */
export function drawHud(frame: Frame, m: Match, assets: GameAssets, viewers: readonly number[], selected: readonly VehicleKind[]): void {
  const players = viewers.length;
  frame.setClip(0, 0, SCREEN_W, SCREEN_H);
  const panel = players === 1 ? PANEL_1P : PANEL_2P;
  if (players > 1) drawDivider(frame, assets.screens['2pmscr'], panel.y);
  frame.blit(players === 1 ? assets.screens['1pbscrl'] : assets.screens['2pbscrl'], 0, panel.y);
  panel.consoles.forEach((at, i) => {
    const p = viewers[i]!;
    const pl = m.players[p];
    if (!pl) return;
    const v = pl.vehicle;
    if (!v) {
      // On the lift, going up or coming down, the console shows that vehicle's bay.
      drawBunkerConsole(frame, assets, at.x, at.y, pl.elevator?.kind ?? liftOf(m, p)?.vehicle.kind ?? selected[i] ?? 'tank', pl.lives);
      return;
    }
    const console = assets.cel(CONSOLE[v.kind]);
    if (!console) return;
    frame.blit(console, at.x, at.y);
    const values = gaugeValues(m, p, v);
    GAUGES[v.kind].forEach((g, i) => drawGauge(frame, at.x, at.y, g, values[i]!, m.tick, v.kind === 'heli' && g.kind === 'ammo' && g.slot !== v.weapon));
    const radar = RADAR[v.kind];
    if (radar) drawRadar(frame, m, assets, console, at.x, at.y, radar, v);
    if (v.kind === 'jeep') drawGrenades(frame, assets, at.x, at.y, values[GAUGES.jeep.length]!);
    if (v.kind === 'heli') {
      HELI_LIGHTS.forEach((l, slot) => {
        const c = assets.cel(slot === v.weapon ? l.lit : l.dark);
        if (c) frame.blit(c, at.x + l.x, at.y + l.y);
      });
    }
  });
}

function drawDivider(frame: Frame, bitmap: Cel, bottom: number): void {
  for (let y = 0; y < bottom; y++) {
    for (let x = 0; x < DIVIDER_W; x++) {
      frame.px[y * SCREEN_W + DIVIDER_X + x] = bitmap.px[Math.min(bitmap.h - 1, y * 2) * bitmap.w + x * 2]!;
    }
  }
}

/** Each gauge's target in 16.16 pixels (the jeep's grenade count last), moved toward from what was shown. */
function gaugeValues(m: Match, p: number, v: Vehicle): number[] {
  const targets = GAUGES[v.kind].map((g) => {
    const w = g.x1 - g.x0 + 1;
    if (g.kind === 'fuel') return Math.floor((Math.max(0, v.fuel) * w) / VEHICLES[v.kind].fuel * ONE);
    const max = VEHICLES[v.kind].weapons[g.slot]!.ammo;
    // sub_411d70: each round is worth the gauge's width over the full load.
    return Math.floor((w * ONE) / max) * (v.ammo[g.slot] ?? 0) + ROUND_UP;
  });
  if (v.kind === 'jeep') targets.push((v.ammo[0] ?? 0) * ONE);
  const s = shown[p];
  if (!s || s.kind !== v.kind || s.values.length !== targets.length) {
    shown[p] = { kind: v.kind, tick: m.tick, values: targets };
    return targets;
  }
  const step = Math.max(0, m.tick - s.tick) * GAUGE_RATE;
  s.tick = m.tick;
  s.values = s.values.map((c, i) => {
    const t = targets[i]!;
    return c < t ? Math.min(t, c + step) : Math.max(t, c - step);
  });
  return s.values;
}

/** Draws a bar gauge, its colour by how full it is. */
function drawGauge(frame: Frame, cx: number, cy: number, g: Gauge, value: number, tick: number, dim: boolean): void {
  const filled = ((value + ROUND_UP) >> 16) << 16;
  const span = (g.x1 - g.x0) << 16;
  let colour: number;
  if (g.kind === 'ammo') {
    const level = filled < span >> 2 ? (filled < span >> 4 ? 0 : 1) : 3;
    colour = (dim ? LEVEL_DIM : LEVEL)[level]!;
  } else if (filled < span >> 4) {
    colour = tick & 0x20 ? LEVEL[0]! : FUEL_FLASH;
  } else {
    colour = LEVEL[filled < span >> 3 ? 0 : filled < span >> 2 ? 1 : filled < (span >> 3) * 3 ? 2 : 3]!;
  }
  const length = filled >> 16;
  for (let y = g.y0; y <= g.y1; y++) {
    for (let x = g.x0; x <= g.x1; x++) frame.px[(cy + y) * SCREEN_W + cx + x] = x - g.x0 < length ? colour : BAR_OFF;
  }
}

function drawRadar(
  frame: Frame, m: Match, assets: GameAssets, console: Cel, cx: number, cy: number,
  r: { x: number; y: number; w: number; h: number }, v: Vehicle,
): void {
  const dark = console.px[(r.y + (r.h >> 1)) * console.w + r.x + (r.w >> 1)]!;
  const tx0 = (v.x >> 21) - (r.w >> 1) * RADAR_SCALE;
  const ty0 = (v.y >> 21) - (r.h >> 1) * RADAR_SCALE;
  const grid = assets.cel(RADAR_GRID);
  const plot = (px: number, py: number, colour: number) => {
    if (px < 0 || py < 0 || px >= r.w || py >= r.h) return;
    if (console.px[(r.y + py) * console.w + r.x + px] !== dark) return;
    frame.px[(cy + r.y + py) * SCREEN_W + cx + r.x + px] = colour;
  };
  for (let py = 0; py < r.h; py++) {
    for (let px = 0; px < r.w; px++) {
      const tx = tx0 + px * RADAR_SCALE;
      const ty = ty0 + py * RADAR_SCALE;
      const inside = tx >= 0 && ty >= 0 && tx < GRID && ty < GRID;
      const t = inside ? m.world.terrain[ty * GRID + tx]! : NO_TERRAIN;
      let colour = t === NO_TERRAIN || WATER_TERRAIN.has(t & 127) ? RADAR_WATER : RADAR_LAND;
      const g = grid?.px[(py % grid.h) * grid.w + (px % grid.w)];
      if (g !== undefined && g >>> 24) colour = average(colour, g);
      plot(px, py, colour);
    }
  }
  for (const p of m.players) {
    const o = p.vehicle;
    if (!o || o === v) continue;
    // With three or four bases, each side shows in its base's colour (mp-hud); two-base games keep the original's.
    const colour = m.world.bases.length > 2 ? BASE_COLOURS[o.base] ?? RADAR_OTHER : RADAR_OTHER;
    plot(Math.floor(((o.x >> 21) - tx0) / RADAR_SCALE), Math.floor(((o.y >> 21) - ty0) / RADAR_SCALE), colour);
  }
  const sx = r.w >> 1;
  const sy = r.h >> 1;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) plot(sx + dx, sy + dy, RADAR_SELF);
}

/** The jeep's grenade rack: one pip per grenade, up to 16 (sub_4127b0). */
function drawGrenades(frame: Frame, assets: GameAssets, cx: number, cy: number, value: number): void {
  const pip = assets.cel(GRENADE);
  if (!pip) return;
  const n = Math.min(GRENADE_SLOTS.length, value >> 16);
  GRENADE_SLOTS.slice(0, n).forEach((s) => frame.blit(pip, cx + s.x, cy + s.y));
}

function drawBunkerConsole(
  frame: Frame, assets: GameAssets, cx: number, cy: number, kind: VehicleKind, lives: Record<VehicleKind, number>,
): void {
  const put = (cel: number, at: { dx: number; dy: number }) => {
    const c = assets.cel(cel);
    if (c) frame.blit(c, cx + at.dx, cy + at.dy);
  };
  put(BUNKER_FRAME, BUNKER_FRAME_AT);
  put(BUNKER_PAD, BUNKER_PAD_AT);
  put(VEHICLE_ICON[kind], BUNKER_ICON_AT);
  put(WEAPON_ICON[kind], BUNKER_WEAPON_AT);
  const left = lives[kind];
  drawNumber(frame, assets, cx + BUNKER_LIVES_AT.dx, cy + BUNKER_LIVES_AT.dy, left === UNLIMITED ? 99 : left);
  drawNumber(frame, assets, cx + BUNKER_ROUNDS_AT.dx, cy + BUNKER_ROUNDS_AT.dy, VEHICLES[kind].weapons[0]!.ammo);
}

/** Red digits 2146-2155. Each advances 8 pixels, except the narrow 1, which advances 6. */
function drawNumber(frame: Frame, assets: GameAssets, x: number, y: number, n: number): void {
  for (const ch of String(n)) {
    const d = Number(ch);
    const cel = assets.cel(DIGIT + d);
    if (cel) frame.blit(cel, x, y);
    x += d === 1 ? 6 : 8;
  }
}

function average(a: number, b: number): number {
  return (0xff000000 | ((((a & 0xfefefe) >>> 1) + ((b & 0xfefefe) >>> 1)) & 0xffffff)) >>> 0;
}
