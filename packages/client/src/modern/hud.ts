// The modern view's overlays: the HUD as a machine-vision analysis of the drone's picture (tracking boxes with
// integrity on vehicles, gun towers and flag buildings, the player's fuel and ammunition beside their own vehicle,
// and the radar as a tactical plot over the same span as the retro console's, for the vehicles that have one), the
// drone feed's overlay, and the menus' dark-glass panels for the bunker, messages, chat and scoreboard.

import { BUILDING, GRID, NO_TERRAIN, ONE, UNLIMITED, VEHICLES, WATER_TERRAIN, type Elevator, type Lives, type Match, type Vehicle, type VehicleKind } from '@rfw/sim';
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

/** Where a point of the map shows in the picture (canvas pixels), or null behind the camera. */
export type Projector = (x: number, y: number, z: number) => { x: number; y: number } | null;

const CV_FONT = '600 11px ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
const CV_BIG = '700 12px ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
const OWN = '#f2f6f0';
const FRIEND = '#62e0ff';
const HOSTILE = '#ff5a46';
/** Half the width and the height of what a tracking box frames, in game pixels. */
const SIZE: Record<VehicleKind, [number, number]> = { tank: [11, 10], jeep: [8, 8], asv: [11, 9], heli: [15, 9] };

/** How sound something reads: the integrity's colour and word. */
function condition(frac: number): { css: string; word: string } {
  if (frac > 0.6) return { css: '#7dffa0', word: 'NOMINAL' };
  if (frac > 0.3) return { css: '#ffc44a', word: 'DAMAGED' };
  return { css: '#ff5a46', word: 'CRITICAL' };
}

/** A detector's confidence, drifting a little from frame to frame as a real one does. */
function confidence(seed: number, tick: number): string {
  return (0.9 + 0.08 * (0.5 + 0.5 * Math.sin(tick * 0.05 + seed * 1.7))).toFixed(2);
}

interface Track {
  x: number;
  y: number;
  z: number;
  half: number;
  height: number;
  css: string;
  label: string;
  /** Integrity 0-1, or null for what has none to read. */
  frac: number | null;
  seed: number;
  /** Read-outs beside the box (the player's own vehicle). */
  side?: { text: string; css?: string }[];
}

/**
 * The modern view's HUD, as a machine-vision analysis of the drone's picture: tracking boxes on the player's own
 * vehicle (with its integrity, fuel and ammunition beside it), friendly vehicles, and the opponents' vehicles, gun
 * towers, flag buildings and drones, each with a label, a confidence and its integrity; and the radar as a tactical
 * plot in the same style, for the vehicles whose console has one.
 */
export function drawModernHud(g: CanvasRenderingContext2D, m: Match, rect: ModernRect, player: number, project: Projector): void {
  const pl = m.players[player];
  const v = pl?.vehicle;
  if (!pl) return;
  const team = pl.team;
  const teamOf = (base: number) => m.players.find((p) => p.base === base)?.team ?? base;
  const tracks: Track[] = [];
  for (const p of m.players) {
    const o = p.vehicle;
    if (!o || o.z < -8 * ONE) continue;
    const def = VEHICLES[o.kind];
    const [half, height] = SIZE[o.kind];
    const frac = Math.max(0, o.health / def.health);
    const own = o === v;
    const t: Track = {
      x: o.x / ONE, y: o.y / ONE, z: Math.max(0, o.z / ONE), half, height, frac, seed: p.id,
      css: own ? OWN : p.team === team ? FRIEND : HOSTILE,
      label: `${own ? 'OWN' : p.team === team ? 'FRIENDLY' : 'HOSTILE'} ${NAMES[o.kind].toUpperCase()}`,
    };
    if (own) t.side = readouts(m, o);
    tracks.push(t);
  }
  const w = m.world;
  const cols = GRID;
  for (let i = 0; i < w.building.length; i++) {
    const bid = w.building[i]!;
    const tower = bid === 49 || bid === 50;
    const flag = bid === BUILDING.FLAG || bid === BUILDING.DMG_FLAG;
    if ((!tower && !flag) || !w.hp[i]) continue;
    const owner = w.owner[i]!;
    if (owner < 0 || teamOf(owner) === team) continue;
    const max = w.defs[bid]?.hp || 7;
    tracks.push({
      x: (i % cols) * 32 + 16, y: Math.floor(i / cols) * 32 + 16, z: 0, half: 13, height: tower ? (bid === 50 ? 34 : 28) : 18,
      css: HOSTILE, label: tower ? (bid === 50 ? 'HOSTILE GUN TOWER L' : 'HOSTILE GUN TOWER') : 'FLAG BUILDING', frac: Math.min(1, w.hp[i]! / max), seed: i,
    });
  }
  for (const f of m.flags) {
    if (!f.revealed || f.carrier >= 0 || teamOf(f.base) === team) continue;
    tracks.push({ x: f.x / ONE, y: f.y / ONE, z: 0, half: 6, height: 14, css: '#ffe14a', label: 'ENEMY FLAG', frac: null, seed: 900 + f.base });
  }
  for (const d of m.drones) {
    if (d.dead || d.targetTeam !== team) continue;
    tracks.push({ x: d.x / ONE, y: d.y / ONE, z: Math.max(0, d.z / ONE), half: 7, height: 6, css: HOSTILE, label: 'HOSTILE DRONE', frac: null, seed: 500 + d.id });
  }

  g.save();
  g.beginPath();
  g.rect(rect.x, rect.y, rect.w, rect.h);
  g.clip();
  g.shadowColor = 'rgba(0, 0, 0, 0.7)';
  g.shadowBlur = 2;
  for (const t of lagged(player, tracks)) box(g, rect, t, project, m.tick);
  g.restore();

  const scale = Math.min(1, rect.w / 900);
  g.save();
  g.translate(rect.x, rect.y);
  g.scale(scale, scale);
  const r = v && RADAR[v.kind];
  if (v && r) radar(g, m, v, r, rect.w / scale - 26, rect.h / scale - 26, team, teamOf);
  g.restore();
}

/** The tracks of each view's last few frames, newest last: the analysis runs a little behind the picture. */
const seen = new Map<number, Map<string, Track>[]>();
/** How many frames behind each track is drawn (3-5), changing now and then as the detector's load does. */
const lagOf = new Map<string, number>();
const KEEP = 6;

/** What the detector has caught up to: each track as it was 3 to 5 frames ago, so the boxes trail what they mark. */
function lagged(view: number, tracks: readonly Track[]): Track[] {
  const frames = seen.get(view) ?? [];
  seen.set(view, frames);
  frames.push(new Map(tracks.map((t) => [`${t.label}:${t.seed}`, t])));
  if (frames.length > KEEP) frames.shift();
  const keys = new Set(frames.flatMap((f) => [...f.keys()]));
  const out: Track[] = [];
  for (const key of keys) {
    let lag = lagOf.get(key);
    if (lag === undefined || Math.random() < 1 / 12) lagOf.set(key, (lag = 3 + Math.floor(Math.random() * 3)));
    const t = frames[Math.max(0, frames.length - 1 - lag)]!.get(key);
    if (t) out.push(t);
  }
  if (lagOf.size > 512) lagOf.clear();
  return out;
}

/** The player's own vehicle's state, beside its box. */
function readouts(m: Match, v: Vehicle): { text: string; css?: string }[] {
  const def = VEHICLES[v.kind];
  const pct = (a: number, b: number) => `${Math.round((100 * Math.max(0, a)) / b)}%`;
  const fuel = Math.max(0, v.fuel) / def.fuel;
  const out: { text: string; css?: string }[] = [
    { text: `FUEL  ${pct(v.fuel, def.fuel)}`, css: fuel < 1 / 16 && (m.tick & 0x20) ? '#ff5a46' : fuel < 1 / 8 ? '#ff5a46' : fuel < 1 / 4 ? '#ffc44a' : undefined },
  ];
  const names = WEAPONS[v.kind];
  def.weapons.forEach((wpn, i) => {
    const n = v.ammo[i] ?? 0;
    const unlimited = wpn.ammo === UNLIMITED;
    const picked = v.kind === 'heli' && v.weapon === i;
    const low = !unlimited && n < wpn.ammo / 8;
    out.push({ text: `${picked ? '>' : ' '}${(names[i] ?? `Weapon ${i + 1}`).toUpperCase().padEnd(9)}${unlimited ? '--' : n}`, css: low ? '#ff5a46' : undefined });
  });
  return out;
}

/** One tracking box: corner marks round what it frames, its label and integrity above, read-outs beside. */
function box(g: CanvasRenderingContext2D, rect: ModernRect, t: Track, project: Projector, tick: number): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const dx of [-t.half, t.half]) {
    for (const dy of [-t.half, t.half]) {
      for (const dz of [0, t.height]) {
        const p = project(t.x + dx, t.y + dy, t.z + dz);
        if (!p) return;
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    }
  }
  if (x1 < rect.x || x0 > rect.x + rect.w || y1 < rect.y || y0 > rect.y + rect.h) return;
  x0 -= 3;
  y0 -= 3;
  x1 += 3;
  y1 += 3;
  const l = Math.max(5, Math.min(12, (x1 - x0) / 4));
  g.strokeStyle = t.css;
  g.lineWidth = 1.5;
  g.beginPath();
  for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
    g.moveTo(x, y + dy * l);
    g.lineTo(x, y);
    g.lineTo(x + dx * l, y);
  }
  g.stroke();
  // A faint fill marks the detection.
  g.fillStyle = t.css === OWN ? 'rgba(242, 246, 240, 0.05)' : t.css === FRIEND ? 'rgba(98, 224, 255, 0.06)' : 'rgba(255, 90, 70, 0.07)';
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.font = CV_FONT;
  g.textBaseline = 'bottom';
  g.textAlign = 'left';
  const head = `${t.label} ${confidence(t.seed, tick)}`;
  const c = t.frac === null ? null : condition(t.frac);
  const state = c ? `INTEGRITY ${Math.round(t.frac! * 100)}% ${c.word}` : '';
  const lines = c ? 2 : 1;
  g.fillStyle = 'rgba(6, 10, 12, 0.6)';
  g.fillRect(x0, y0 - 2 - lines * 13, Math.max(g.measureText(head).width, g.measureText(state).width) + 8, lines * 13);
  g.fillStyle = t.css;
  g.fillText(head, x0 + 4, y0 - 2 - (lines - 1) * 13);
  if (c) {
    g.fillStyle = c.css;
    g.fillText(state, x0 + 4, y0 - 2);
  }
  if (t.side) {
    g.font = CV_BIG;
    g.textBaseline = 'top';
    const sx = x1 + 8;
    t.side.forEach((r, i) => {
      g.fillStyle = 'rgba(6, 10, 12, 0.55)';
      g.fillRect(sx - 3, y0 + i * 15, g.measureText(r.text).width + 6, 15);
      g.fillStyle = r.css ?? OWN;
      g.fillText(r.text, sx, y0 + 1 + i * 15);
    });
  }
}

/** The radar as a tactical plot: the coast traced in thin lines over a dark glass, and the contacts as marks. */
function radar(
  g: CanvasRenderingContext2D, m: Match, v: Vehicle, r: { w: number; h: number; round: boolean }, right: number, bottom: number,
  team: number, teamOf: (base: number) => number,
): void {
  const sw = 170;
  const sh = (sw * r.h) / r.w;
  const x = right - sw;
  const y = bottom - sh;
  g.save();
  g.fillStyle = 'rgba(4, 10, 12, 0.5)';
  g.strokeStyle = 'rgba(98, 224, 255, 0.55)';
  g.lineWidth = 1;
  g.beginPath();
  if (r.round) g.ellipse(x + sw / 2, y + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
  else g.rect(x, y, sw, sh);
  g.fill();
  g.save();
  g.clip();
  const cx = v.x / ONE / 32;
  const cy = v.y / ONE / 32;
  const k = sw / r.w;
  g.imageSmoothingEnabled = false;
  g.drawImage(coastMap(m), x + sw / 2 - cx * k, y + sh / 2 - cy * k, GRID * k, GRID * k);
  // Range rings and a sweep.
  g.strokeStyle = 'rgba(98, 224, 255, 0.16)';
  g.beginPath();
  for (const f of [0.25, 0.5]) g.ellipse(x + sw / 2, y + sh / 2, sw * f, sh * f, 0, 0, Math.PI * 2);
  g.moveTo(x + sw / 2, y);
  g.lineTo(x + sw / 2, y + sh);
  g.moveTo(x, y + sh / 2);
  g.lineTo(x + sw, y + sh / 2);
  g.stroke();
  const a = (m.tick % 120) / 120 * Math.PI * 2;
  g.strokeStyle = 'rgba(98, 224, 255, 0.4)';
  g.beginPath();
  g.moveTo(x + sw / 2, y + sh / 2);
  g.lineTo(x + sw / 2 + Math.sin(a) * sw, y + sh / 2 - Math.cos(a) * sh);
  g.stroke();
  let contacts = 0;
  for (const p of m.players) {
    const o = p.vehicle;
    if (!o || o === v) continue;
    const ox = x + sw / 2 + (o.x / ONE / 32 - cx) * k;
    const oy = y + sh / 2 + (o.y / ONE / 32 - cy) * k;
    const hostile = teamOf(o.base) !== team;
    if (hostile) contacts++;
    g.strokeStyle = hostile ? HOSTILE : FRIEND;
    g.lineWidth = 1.5;
    if (hostile) {
      g.beginPath();
      g.moveTo(ox, oy - 4.5);
      g.lineTo(ox + 4.5, oy);
      g.lineTo(ox, oy + 4.5);
      g.lineTo(ox - 4.5, oy);
      g.closePath();
      g.stroke();
    } else g.strokeRect(ox - 3.5, oy - 3.5, 7, 7);
  }
  g.restore();
  g.stroke();
  // The player in the middle, pointing where it heads.
  const h = (v.heading / ONE / 64) * Math.PI * 2;
  g.save();
  g.translate(x + sw / 2, y + sh / 2);
  g.rotate(h);
  g.fillStyle = OWN;
  g.beginPath();
  g.moveTo(0, -6);
  g.lineTo(4, 4);
  g.lineTo(-4, 4);
  g.closePath();
  g.fill();
  g.restore();
  g.font = CV_FONT;
  g.fillStyle = 'rgba(98, 224, 255, 0.85)';
  g.textBaseline = 'bottom';
  g.textAlign = 'left';
  g.fillText(`TACTICAL  ${contacts} HOSTILE`, x, y - 4);
  g.restore();
}

let coast: { canvas: HTMLCanvasElement; terrain: Uint8Array } | null = null;

/** The map for the tactical plot: the coastline and roads as thin lines, land faint, the sea clear. */
function coastMap(m: Match): HTMLCanvasElement {
  const t = m.world.terrain;
  if (coast && coast.terrain.length === t.length && coast.terrain.every((v, i) => v === t[i])) return coast.canvas;
  const canvas = coast?.canvas ?? document.createElement('canvas');
  canvas.width = GRID;
  canvas.height = GRID;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(GRID, GRID);
  const sea = (i: number) => {
    const v = t[i];
    return v === undefined || v === NO_TERRAIN || WATER_TERRAIN.has(v & 127);
  };
  for (let i = 0; i < GRID * GRID; i++) {
    if (sea(i)) continue;
    const x = i % GRID;
    const edge = (x > 0 && sea(i - 1)) || (x < GRID - 1 && sea(i + 1)) || sea(i - GRID) || sea(i + GRID);
    const v = t[i]! & 127;
    const road = v >= 73 && v <= 92;
    const [r, gg, b, a] = edge ? [98, 224, 255, 200] : road ? [98, 224, 255, 70] : [98, 224, 255, 22];
    img.data.set([r, gg, b, a], i * 4);
  }
  g.putImageData(img, 0, 0);
  coast = { canvas, terrain: new Uint8Array(t) };
  return canvas;
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
