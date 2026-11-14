// The modern view's HUD, in the menus' dark-glass theme, drawn over each view: the vehicle's fuel and ammunition
// (the helicopter's picked weapon lit, the jeep's grenades as pips) at the bottom left, and the radar at the bottom
// right. It shows what the retro cockpit shows and nothing more: the same gauges, and a radar over the same span
// of the map (two tiles a dot) for the vehicles that have one.

import { GRID, NO_TERRAIN, VEHICLES, WATER_TERRAIN, type Match, type Vehicle, type VehicleKind } from '@rfw/sim';
import { TEAMS } from '../paint.js';
import type { ModernRect } from './layout.js';

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
