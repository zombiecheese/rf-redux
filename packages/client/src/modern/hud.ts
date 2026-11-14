// The modern view's HUD, in the menus' dark-glass theme, drawn over each view: the vehicle's fuel and ammunition
// (the helicopter's picked weapon lit, the jeep's grenades as pips) at the bottom left, and the radar at the bottom
// right. It shows what the retro cockpit shows and nothing more: the same gauges, and a radar over the same span
// of the map (two tiles a dot) for the vehicles that have one.

import { GRID, NO_TERRAIN, ONE, UNLIMITED, VEHICLES, WATER_TERRAIN, type Elevator, type Lives, type Match, type Vehicle, type VehicleKind } from '@rfw/sim';
import { TEAMS } from '../paint.js';
import type { ModernRect } from './layout.js';
import { BAY_AT } from './layout.js';

const PANEL = 'rgba(16, 19, 15, 0.78)';
const LINE = 'rgba(255, 255, 255, 0.14)';
const TEXT = '#ece7d8';
const MUTED = '#a39f8f';
const ACCENT = '#e3a33b';
const GOOD = '#7cc46a';
const BAD = '#e0644c';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const NAMES: Record<VehicleKind, string> = { tank: 'Tank', jeep: 'Jeep', asv: 'ASV', heli: 'Helicopter' };
const WEAPONS: Record<VehicleKind, string[]> = { tank: ['Shells'], jeep: ['Grenades'], asv: ['Missiles', 'Mines'], heli: ['Gun', 'Missiles'] };
/** The radar's span in tiles across and down, as each retro console's window (two tiles a dot). */
const RADAR: Partial<Record<VehicleKind, { w: number; h: number; round: boolean }>> = {
  tank: { w: 64, h: 64, round: false },
  asv: { w: 78, h: 68, round: false },
  heli: { w: 66, h: 64, round: true },
};

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A map of land and sea, one pixel a tile, kept until the terrain changes. */
let radarMap: { canvas: HTMLCanvasElement; terrain: Uint8Array } | null = null;

function landMap(m: Match): HTMLCanvasElement {
  const t = m.world.terrain;
  if (radarMap && radarMap.terrain.length === t.length && radarMap.terrain.every((v, i) => v === t[i])) return radarMap.canvas;
  const canvas = radarMap?.canvas ?? document.createElement('canvas');
  canvas.width = GRID;
  canvas.height = GRID;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(GRID, GRID);
  for (let i = 0; i < GRID * GRID; i++) {
    const v = t[i]!;
    const sea = v === NO_TERRAIN || WATER_TERRAIN.has(v & 127);
    const road = !sea && (v & 127) >= 73 && (v & 127) <= 92;
    const [r, gg, b] = sea ? [22, 66, 96] : road ? [120, 128, 120] : [92, 128, 70];
    img.data.set([r, gg, b, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  radarMap = { canvas, terrain: new Uint8Array(t) };
  return canvas;
}

export function drawModernHud(g: CanvasRenderingContext2D, m: Match, rect: ModernRect, player: number): void {
  const pl = m.players[player];
  const v = pl?.vehicle;
  if (!v) return;
  const scale = Math.min(1, rect.w / 900);
  g.save();
  g.translate(rect.x, rect.y);
  g.scale(scale, scale);
  const w = rect.w / scale;
  const h = rect.h / scale;
  gauges(g, m, v, 24, h - 24);
  const r = RADAR[v.kind];
  if (r) radar(g, m, v, r, w - 24, h - 24);
  g.restore();
}

function gauges(g: CanvasRenderingContext2D, m: Match, v: Vehicle, left: number, bottom: number): void {
  const def = VEHICLES[v.kind];
  const names = WEAPONS[v.kind];
  const rows: { label: string; value: number; max: number; lit: boolean; count?: number }[] = [
    { label: 'Fuel', value: Math.max(0, v.fuel), max: def.fuel, lit: true },
  ];
  def.weapons.forEach((wpn, i) => {
    if (v.kind === 'jeep') return;
    rows.push({ label: names[i] ?? `Weapon ${i + 1}`, value: v.ammo[i] ?? 0, max: wpn.ammo, lit: v.kind !== 'heli' || v.weapon === i, count: v.ammo[i] ?? 0 });
  });
  const barW = 220;
  const rowH = 30;
  const panelW = barW + 40;
  const extra = v.kind === 'jeep' ? 40 : 0;
  const panelH = 44 + rows.length * rowH + extra;
  const x = left;
  const y = bottom - panelH;
  rounded(g, x, y, panelW, panelH, 12);
  g.fillStyle = PANEL;
  g.fill();
  g.strokeStyle = LINE;
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = TEXT;
  g.font = `700 17px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillText(NAMES[v.kind], x + 20, y + 22);
  const side = TEAMS[v.base];
  if (side) {
    g.fillStyle = side.css;
    g.beginPath();
    g.arc(x + panelW - 24, y + 22, 7, 0, Math.PI * 2);
    g.fill();
  }
  rows.forEach((row, i) => {
    const ry = y + 44 + i * rowH;
    const frac = row.max > 0 ? Math.max(0, Math.min(1, row.value / row.max)) : 0;
    g.font = `600 12px ${FONT}`;
    g.fillStyle = row.lit ? MUTED : 'rgba(163, 159, 143, 0.45)';
    g.fillText(row.label.toUpperCase(), x + 20, ry + 4);
    if (row.count !== undefined) {
      g.textAlign = 'right';
      g.fillText(String(row.count), x + 20 + barW, ry + 4);
      g.textAlign = 'left';
    }
    rounded(g, x + 20, ry + 12, barW, 8, 4);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fill();
    if (frac > 0) {
      const low = frac < 1 / 8;
      const flash = row.label === 'Fuel' && frac < 1 / 16 && (m.tick & 0x20) !== 0;
      rounded(g, x + 20, ry + 12, Math.max(8, barW * frac), 8, 4);
      g.fillStyle = flash ? '#5a2018' : low ? BAD : frac < 1 / 4 ? ACCENT : row.lit ? GOOD : 'rgba(124, 196, 106, 0.4)';
      g.fill();
    }
  });
  if (v.kind === 'jeep') {
    const ry = y + 44 + rows.length * rowH;
    g.font = `600 12px ${FONT}`;
    g.fillStyle = MUTED;
    g.fillText('GRENADES', x + 20, ry + 4);
    const n = Math.min(16, v.ammo[0] ?? 0);
    for (let i = 0; i < 16; i++) {
      g.beginPath();
      g.arc(x + 26 + i * 13.5, ry + 22, 4.5, 0, Math.PI * 2);
      g.fillStyle = i < n ? GOOD : 'rgba(255,255,255,0.1)';
      g.fill();
    }
  }
}

function radar(g: CanvasRenderingContext2D, m: Match, v: Vehicle, r: { w: number; h: number; round: boolean }, right: number, bottom: number): void {
  const size = 170;
  const sw = size;
  const sh = (size * r.h) / r.w;
  const x = right - sw - 12;
  const y = bottom - sh - 12;
  rounded(g, x - 12, y - 12, sw + 24, sh + 24, 14);
  g.fillStyle = PANEL;
  g.fill();
  g.strokeStyle = LINE;
  g.stroke();
  g.save();
  if (r.round) {
    g.beginPath();
    g.ellipse(x + sw / 2, y + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
  } else rounded(g, x, y, sw, sh, 8);
  g.clip();
  g.fillStyle = 'rgb(22, 66, 96)';
  g.fillRect(x, y, sw, sh);
  const cx = v.x / 65536 / 32;
  const cy = v.y / 65536 / 32;
  const k = sw / r.w;
  g.imageSmoothingEnabled = false;
  g.drawImage(landMap(m), x + sw / 2 - cx * k, y + sh / 2 - cy * k, GRID * k, GRID * k);
  // A faint grid, as the console's.
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.beginPath();
  for (let i = 1; i < 4; i++) {
    g.moveTo(x + (sw * i) / 4, y);
    g.lineTo(x + (sw * i) / 4, y + sh);
    g.moveTo(x, y + (sh * i) / 4);
    g.lineTo(x + sw, y + (sh * i) / 4);
  }
  g.stroke();
  for (const p of m.players) {
    const o = p.vehicle;
    if (!o || o === v) continue;
    const ox = x + sw / 2 + (o.x / 65536 / 32 - cx) * k;
    const oy = y + sh / 2 + (o.y / 65536 / 32 - cy) * k;
    g.fillStyle = m.world.bases.length > 2 ? TEAMS[o.base]?.css ?? GOOD : '#5fd03a';
    g.beginPath();
    g.arc(ox, oy, 4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffe2c8';
  g.beginPath();
  g.arc(x + sw / 2, y + sh / 2, 4.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.stroke();
  g.restore();
}

/** A player's name over their vehicle, online (as the retro view's drawNames). */
export function drawName(g: CanvasRenderingContext2D, name: string, x: number, y: number, css: string): void {
  g.save();
  g.font = `700 14px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  const w = g.measureText(name).width + 14;
  rounded(g, x - w / 2, y - 22, w, 20, 10);
  g.fillStyle = 'rgba(16, 19, 15, 0.7)';
  g.fill();
  g.fillStyle = css;
  g.fillText(name, x, y - 5);
  g.restore();
}

/** The modern screen's point for a bunker point, from the renderer. */
export type BunkerPoint = (rect: ModernRect, x: number, y: number, z?: number) => { x: number; y: number };

/** The bunker's labels: each bay's vehicle and lives over its ceiling, the chosen one lit, and how to choose. */
export function drawBunkerPanel(
  g: CanvasRenderingContext2D, rect: ModernRect, at: BunkerPoint, lives: Lives, selected: VehicleKind, elevator: Elevator | null, base: number, touch: boolean,
): void {
  g.save();
  g.beginPath();
  g.rect(rect.x, rect.y, rect.w, rect.h);
  g.clip();
  const scale = Math.min(1, rect.w / 900);
  const chosen = elevator?.kind ?? selected;
  for (const kind of Object.keys(BAY_AT) as VehicleKind[]) {
    if (elevator && kind !== chosen) continue;
    const b = BAY_AT[kind];
    // Upper bays are named above their ceilings, lower bays below their floors.
    const top = b.floor > -100;
    const p = at(rect, b.x, top ? b.floor + 31 : b.floor - 3, 0);
    const n = lives[kind];
    const mine = kind === chosen;
    const count = n === UNLIMITED ? 'Unlimited' : n === 0 ? 'None left' : `${n} left`;
    g.font = `700 ${Math.round(16 * scale)}px ${FONT}`;
    const nameW = g.measureText(NAMES[kind]).width;
    g.font = `600 ${Math.round(12 * scale)}px ${FONT}`;
    const countW = g.measureText(count).width;
    const w = nameW + countW + 34 * scale;
    const h = 30 * scale;
    const x = p.x - w / 2;
    const y = top ? p.y - h - 4 * scale : p.y + 4 * scale;
    rounded(g, x, y, w, h, h / 2);
    g.fillStyle = mine ? 'rgba(46, 34, 12, 0.88)' : PANEL;
    g.fill();
    g.strokeStyle = mine ? ACCENT : LINE;
    g.lineWidth = mine ? 2 : 1;
    g.stroke();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = `700 ${Math.round(16 * scale)}px ${FONT}`;
    g.fillStyle = n === 0 && !mine ? MUTED : mine ? '#ffd58a' : TEXT;
    g.fillText(NAMES[kind], x + 13 * scale, y + h / 2 + 1);
    g.font = `600 ${Math.round(12 * scale)}px ${FONT}`;
    g.fillStyle = n === 0 ? BAD : MUTED;
    g.fillText(count, x + 21 * scale + nameW, y + h / 2 + 1);
  }
  if (!elevator) {
    // The heading and the help along the bottom.
    const side = TEAMS[base];
    const title = 'Choose your vehicle';
    const help = touch ? 'Tap a bay to choose it, tap it again to launch' : 'Arrows or click to choose, fire or click again to launch';
    g.font = `700 ${Math.round(20 * scale)}px ${FONT}`;
    const tw = g.measureText(title).width;
    g.font = `500 ${Math.round(13 * scale)}px ${FONT}`;
    const hw = g.measureText(help).width;
    const w = Math.max(tw, hw) + 56 * scale;
    const h = 64 * scale;
    const x = rect.x + (rect.w - w) / 2;
    const y = rect.y + rect.h - h - 20 * scale;
    rounded(g, x, y, w, h, 14 * scale);
    g.fillStyle = PANEL;
    g.fill();
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(20 * scale)}px ${FONT}`;
    g.fillStyle = TEXT;
    g.fillText(title, x + w / 2, y + 22 * scale);
    if (side) {
      g.fillStyle = side.css;
      g.beginPath();
      g.arc(x + w / 2 - tw / 2 - 14 * scale, y + 22 * scale, 6 * scale, 0, Math.PI * 2);
      g.fill();
    }
    g.font = `500 ${Math.round(13 * scale)}px ${FONT}`;
    g.fillStyle = MUTED;
    g.fillText(help, x + w / 2, y + 45 * scale);
  }
  g.restore();
}

/** Which bay a point on the modern screen is over, if any: the four bays and the floor in front of them. */
export function bunkerBayAt(rect: ModernRect, at: BunkerPoint, px: number, py: number): VehicleKind | null {
  for (const kind of Object.keys(BAY_AT) as VehicleKind[]) {
    const b = BAY_AT[kind];
    const a = at(rect, b.left ? -72 : 15, b.floor + 34, 0);
    const c = at(rect, b.left ? -15 : 72, b.floor - 6, 0);
    if (px >= Math.min(a.x, c.x) && px <= Math.max(a.x, c.x) && py >= Math.min(a.y, c.y) && py <= Math.max(a.y, c.y)) return kind;
  }
  return null;
}

/** Darkens a view: the fade to and from the map, or the skull's fade out. level is how lit it is, 0 to ONE. */
export function dimView(g: CanvasRenderingContext2D, rect: ModernRect, level: number): void {
  if (level >= ONE) return;
  g.fillStyle = `rgba(0,0,0,${1 - Math.max(0, level) / ONE})`;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
}

/** A short note in a chip at the top left of a view ("Get the flag home!", "Watching ..."). */
export function drawNote(g: CanvasRenderingContext2D, rect: ModernRect, text: string): void {
  const scale = Math.min(1, rect.w / 900);
  g.save();
  g.font = `700 ${Math.round(15 * scale)}px ${FONT}`;
  const w = g.measureText(text).width + 28 * scale;
  const h = 30 * scale;
  const x = rect.x + 20 * scale;
  const y = rect.y + 18 * scale;
  rounded(g, x, y, w, h, h / 2);
  g.fillStyle = PANEL;
  g.fill();
  g.strokeStyle = ACCENT;
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = '#ffd58a';
  g.textBaseline = 'middle';
  g.fillText(text, x + 14 * scale, y + h / 2 + 1);
  g.restore();
}

/** The latest match messages, newest last, stacked at the top middle. */
export function drawLog(g: CanvasRenderingContext2D, lines: readonly string[], width: number): void {
  g.save();
  g.font = `600 15px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((text, i) => {
    const w = Math.min(width - 40, g.measureText(text).width + 32);
    const h = 30;
    const x = (width - w) / 2;
    const y = 18 + i * 36;
    rounded(g, x, y, w, h, 10);
    g.fillStyle = PANEL;
    g.fill();
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = TEXT;
    g.fillText(text, width / 2, y + h / 2 + 1, w - 24);
  });
  g.restore();
}

/** A big centred message: who won, or the server's pause. */
export function drawBanner(g: CanvasRenderingContext2D, text: string, width: number, y: number, size = 44): void {
  g.save();
  g.font = `800 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = g.measureText(text).width + size * 1.6;
  const h = size * 1.9;
  rounded(g, (width - w) / 2, y - h / 2, w, h, 18);
  g.fillStyle = PANEL;
  g.fill();
  g.strokeStyle = ACCENT;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = TEXT;
  g.fillText(text, width / 2, y + 2);
  g.restore();
}

/** A run of coloured text pieces on one line. */
export interface TextRun {
  text: string;
  css: string;
}

/** Chat lines in a glass panel at the top left, under the view's note. */
export function drawChatLines(g: CanvasRenderingContext2D, rect: ModernRect, lines: readonly TextRun[][]): void {
  if (!lines.length) return;
  const scale = Math.min(1, rect.w / 900);
  g.save();
  g.font = `500 ${Math.round(14 * scale)}px ${FONT}`;
  const lh = 22 * scale;
  const w = Math.min(rect.w - 40 * scale, 520 * scale);
  const x = rect.x + 20 * scale;
  const y = rect.y + 58 * scale;
  rounded(g, x, y, w, lines.length * lh + 14 * scale, 10);
  g.fillStyle = 'rgba(16, 19, 15, 0.6)';
  g.fill();
  g.textBaseline = 'middle';
  lines.forEach((runs, i) => {
    let cx = x + 12 * scale;
    const cy = y + 7 * scale + lh * (i + 0.5);
    for (const r of runs) {
      const room = x + w - 12 * scale - cx;
      if (room <= 0) break;
      g.fillStyle = r.css;
      g.fillText(r.text, cx, cy, room);
      cx += Math.min(room, g.measureText(r.text).width);
    }
  });
  g.restore();
}

/** The scoreboard as a glass table in the middle of the screen. */
export function drawScoreTable(g: CanvasRenderingContext2D, width: number, head: readonly string[], rows: readonly { cells: string[]; css: string }[]): void {
  g.save();
  const cols = [24, 64, 330, 400, 470];
  const w = 600;
  const rh = 32;
  const h = 56 + rows.length * rh;
  const x = (width - w) / 2;
  const y = 90;
  rounded(g, x, y, w, h, 16);
  g.fillStyle = 'rgba(16, 19, 15, 0.86)';
  g.fill();
  g.strokeStyle = LINE;
  g.lineWidth = 1;
  g.stroke();
  g.textBaseline = 'middle';
  g.font = `700 12px ${FONT}`;
  g.fillStyle = MUTED;
  head.forEach((t, i) => g.fillText(t.toUpperCase(), x + cols[i]!, y + 26));
  rows.forEach((r, k) => {
    const ry = y + 52 + k * rh;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x + 16, ry - 4, w - 32, 1);
    r.cells.forEach((t, i) => {
      g.font = `${i === 1 ? 700 : 500} 15px ${FONT}`;
      g.fillStyle = i <= 1 ? r.css : TEXT;
      g.fillText(t, x + cols[i]!, ry + rh / 2 - 2, (cols[i + 1] ?? w - 16) - cols[i]! - 10);
    });
  });
  g.restore();
}

/** What the drone's feed shows over a view. */
export interface Feed {
  /** The drone's call sign: UAV-1, UAV-2. */
  name: string;
  /** The camera: EO DAY, EO NIGHT, IR WHT. */
  mode: string;
  /** Read-outs down the left edge: ALT, HDG, GRID... */
  lines: readonly string[];
  /** For the clock and the blinking REC. */
  now: Date;
}

const FEED_FONT = '600 13px ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
const FEED_INK = 'rgba(236, 242, 232, 0.86)';

/** The drone feed's overlay: corner brackets, the clock and REC, and its read-outs. */
export function drawFeed(g: CanvasRenderingContext2D, rect: ModernRect, f: Feed): void {
  const scale = Math.min(1, rect.w / 900);
  g.save();
  g.translate(rect.x, rect.y);
  g.scale(scale, scale);
  const w = rect.w / scale;
  const h = rect.h / scale;
  g.strokeStyle = FEED_INK;
  g.fillStyle = FEED_INK;
  g.shadowColor = 'rgba(0, 0, 0, 0.6)';
  g.shadowBlur = 3;
  g.lineWidth = 2;
  // Corner brackets.
  const m = 22;
  const l = 30;
  g.beginPath();
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]] as const) {
    g.moveTo(x, y + dy * l);
    g.lineTo(x, y);
    g.lineTo(x + dx * l, y);
  }
  g.stroke();

  g.font = FEED_FONT;
  g.textBaseline = 'top';
  // The clock, REC and the camera at the top right.
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = f.now;
  const clock = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
  const right = w - m - 8;
  g.textAlign = 'right';
  g.fillText(`${f.name}   REC`, right, m + 8);
  const recW = g.measureText('REC').width;
  if (d.getMilliseconds() < 600) {
    g.fillStyle = '#ff4a3a';
    g.beginPath();
    g.arc(right - recW - 10, m + 15, 4.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = FEED_INK;
  }
  g.fillText(clock, right, m + 26);
  g.fillText(f.mode, right, m + 44);
  // Read-outs down the left edge, clear of the note at the top and the gauges at the bottom.
  g.textAlign = 'left';
  f.lines.forEach((t, i) => g.fillText(t, m + 8, h / 2 - (f.lines.length * 18) / 2 + i * 18));
  g.restore();
}
