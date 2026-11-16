// The modern view's overlays: the HUD as a machine-vision analysis of the drone's picture (tracking boxes with
// integrity on vehicles, gun towers and flag buildings, the player's fuel and ammunition beside their own vehicle,
// and the radar as a tactical plot over the same span as the retro console's, for the vehicles that have one), the
// drone feed's overlay, and the menus' dark-glass panels for the bunker, messages, chat and scoreboard.

import { BUILDING, GRID, NO_TERRAIN, ONE, UNLIMITED, VEHICLES, WATER_TERRAIN, type Elevator, type Lives, type Match, type Vehicle, type VehicleKind } from '@rfw/sim';
import { TEAMS } from '../paint.js';
import type { ModernRect } from './layout.js';
import { BAY_AT } from './layout.js';
import type { LoadingState } from '../loading.js';

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

const CV_MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * The HUD on a phone or tablet. The modern picture is drawn at 1280×720 and shrunk to fit the screen, so on a phone
 * its text would be a few pixels tall: there every read-out is drawn larger (`text`, 1 on a desktop), and the parts
 * the on-screen controls would cover move clear of them: the tactical plot goes to the top right (the turret and
 * weapon buttons are at the bottom right), and the messages, notes and chat start below the buttons along the top.
 */
const touchHud = { on: false, text: 1 };

/**
 * Sets the HUD for touch: `shown` is how many screen pixels one pixel of the modern picture takes (under 1 on a
 * phone). The text is made big enough to read there, up to 1.8 times its desktop size.
 */
export function setTouchHud(on: boolean, shown = 1): void {
  touchHud.on = on;
  touchHud.text = on ? Math.min(1.8, Math.max(1, 10 / (11 * shown))) : 1;
}

/** A read-out font, its size grown on a phone. */
const cv = (weight: number, px: number) => `${weight} ${Math.round(px * touchHud.text)}px ${CV_MONO}`;
/** Where the top-of-screen read-outs start: below the on-screen buttons on a touch screen. */
const TOUCH_TOP = 84;
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
  if (v) guides(g, m, rect, v, team, teamOf, project);

  const scale = Math.min(1, rect.w / 900);
  g.save();
  g.translate(rect.x, rect.y);
  g.scale(scale, scale);
  const r = v && RADAR[v.kind];
  // On a touch screen the turret and weapon buttons cover the bottom right: the plot goes to the top right instead,
  // under the feed's clock (its label above it, so it starts a little lower).
  if (v && r) radar(g, m, v, r, rect.w / scale - 26, touchHud.on ? 30 + 78 * touchHud.text + (170 * r.h) / r.w : rect.h / scale - 26, team, teamOf);
  g.restore();
}

/**
 * Arrows at the edge of the view towards where the flags may be, in each rival base's colour: every standing flag
 * building of a rival (which one hides the flag is not given away), a rival flag once it lies in the open, and the
 * way home while the player's jeep carries one. What is already in view has its tracking box instead.
 */
function guides(
  g: CanvasRenderingContext2D, m: Match, rect: ModernRect, v: Vehicle, team: number, teamOf: (base: number) => number, project: Projector,
): void {
  const w = m.world;
  const goals: { x: number; y: number; css: string; label: string; strong: boolean }[] = [];
  const carrying = m.flags.find((f) => f.carrier === v.player);
  if (carrying) {
    const home = w.bases[v.base]?.start;
    if (home) goals.push({ x: home.tx * 32 + 16, y: home.ty * 32 + 16, css: TEAMS[v.base]?.css ?? OWN, label: 'HOME', strong: true });
  } else {
    for (const f of m.flags) {
      if (teamOf(f.base) === team || f.carrier >= 0) continue;
      const css = TEAMS[f.base]?.css ?? HOSTILE;
      if (f.revealed) {
        goals.push({ x: f.x / ONE, y: f.y / ONE, css, label: 'ENEMY FLAG', strong: true });
        continue;
      }
      for (const s of w.bases[f.base]?.flagSites ?? []) {
        const i = s.ty * GRID + s.tx;
        const bid = w.building[i];
        if (bid !== BUILDING.FLAG && bid !== BUILDING.DMG_FLAG) continue;
        goals.push({ x: s.tx * 32 + 16, y: s.ty * 32 + 16, css, label: 'POSSIBLE FLAG', strong: false });
      }
    }
  }
  const vx = v.x / ONE;
  const vy = v.y / ONE;
  const pad = 46;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const near = goals.map((t) => ({ ...t, d: Math.hypot(t.x - vx, t.y - vy) })).sort((a, b) => a.d - b.d).slice(0, 6);
  const T = touchHud.text;
  g.save();
  g.font = cv(600, 11);
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0, 0, 0, 0.7)';
  g.shadowBlur = 2;
  // One label per goal and side: the nearest of a base's possible flag sites carries the name and distance, the others
  // just their arrows; a label that would land on one already drawn moves along until it is clear.
  const named = new Set<string>();
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (const t of near) {
    const p = project(t.x, t.y, 0);
    if (p && p.x > rect.x + pad && p.x < rect.x + rect.w - pad && p.y > rect.y + pad && p.y < rect.y + rect.h - pad) continue;
    // Point the way it lies on the map (north up), from the middle of the view to its edge.
    const a = Math.atan2(t.y - vy, t.x - vx);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const k = Math.min((rect.w / 2 - pad) / Math.max(1e-6, Math.abs(dx)), (rect.h / 2 - pad) / Math.max(1e-6, Math.abs(dy)));
    const ax = cx + dx * k;
    const ay = cy + dy * k;
    g.save();
    g.translate(ax, ay);
    g.rotate(a);
    g.fillStyle = t.css;
    g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(14, 0);
    g.lineTo(-6, -9);
    g.lineTo(-2, 0);
    g.lineTo(-6, 9);
    g.closePath();
    g.globalAlpha = t.strong ? 1 : 0.8 + 0.2 * Math.sin(m.tick * 0.2);
    g.fill();
    g.stroke();
    g.restore();
    // Its label beside the arrow, on the side towards the middle.
    const key = `${t.label}:${t.css}`;
    if (named.has(key)) continue;
    named.add(key);
    const text = `${t.label} ${Math.round(t.d / 3.2)}M`;
    const tw = g.measureText(text).width;
    const lx = Math.max(rect.x + 6, Math.min(rect.x + rect.w - tw - 14, ax - dx * 26 - tw / 2 - 4));
    let ly = Math.max(rect.y + 10, Math.min(rect.y + rect.h - 10, ay - dy * 22));
    const h = 14 * T;
    const hits = (y: number) => placed.some((r) => lx < r.x + r.w && r.x < lx + tw + 8 && y - h / 2 < r.y + r.h && r.y < y + h / 2);
    // Step away from the middle of the edge it sits on, up or down, until it is clear.
    const step = (ly < cy ? -1 : 1) * (h + 2);
    for (let n = 0; n < 6 && hits(ly); n++) ly += step;
    ly = Math.max(rect.y + 10, Math.min(rect.y + rect.h - 10, ly));
    placed.push({ x: lx, y: ly - h / 2, w: tw + 8, h });
    g.fillStyle = 'rgba(6, 10, 12, 0.6)';
    g.fillRect(lx, ly - 7 * T, tw + 8, 14 * T);
    g.fillStyle = t.css;
    g.textAlign = 'left';
    g.fillText(text, lx + 4, ly);
  }
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
  const T = touchHud.text;
  const lh = 13 * T;
  g.font = cv(600, 11);
  g.textBaseline = 'bottom';
  g.textAlign = 'left';
  const head = `${t.label} ${confidence(t.seed, tick)}`;
  const c = t.frac === null ? null : condition(t.frac);
  const state = c ? `INTEGRITY ${Math.round(t.frac! * 100)}% ${c.word}` : '';
  const lines = c ? 2 : 1;
  g.fillStyle = 'rgba(6, 10, 12, 0.6)';
  g.fillRect(x0, y0 - 2 - lines * lh, Math.max(g.measureText(head).width, g.measureText(state).width) + 8, lines * lh);
  g.fillStyle = t.css;
  g.fillText(head, x0 + 4, y0 - 2 - (lines - 1) * lh);
  if (c) {
    g.fillStyle = c.css;
    g.fillText(state, x0 + 4, y0 - 2);
  }
  if (t.side) {
    g.font = cv(700, 12);
    g.textBaseline = 'top';
    const sx = x1 + 8;
    const sh = 15 * T;
    t.side.forEach((r, i) => {
      g.fillStyle = 'rgba(6, 10, 12, 0.55)';
      g.fillRect(sx - 3, y0 + i * sh, g.measureText(r.text).width + 6, sh);
      g.fillStyle = r.css ?? OWN;
      g.fillText(r.text, sx, y0 + 1 + i * sh);
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
  g.font = cv(600, 11);
  g.fillStyle = 'rgba(98, 224, 255, 0.85)';
  g.textBaseline = 'bottom';
  // Lined up on the plot's right edge, so a label grown for a phone stays on screen.
  g.textAlign = 'right';
  g.fillText(`TACTICAL  ${contacts} HOSTILE`, x + sw, y - 4);
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
  const T = touchHud.text;
  g.font = `700 ${Math.round(14 * T)}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  const w = g.measureText(name).width + 14;
  rounded(g, x - w / 2, y - 22 * T, w, 20 * T, 10 * T);
  g.fillStyle = 'rgba(16, 19, 15, 0.7)';
  g.fill();
  g.fillStyle = css;
  g.fillText(name, x, y - 5);
  g.restore();
}

/** The modern screen's point for a bunker point, from the renderer. */
export type BunkerPoint = (rect: ModernRect, x: number, y: number, z?: number) => { x: number; y: number };

/** What the bunker's camera shows: the side's vehicles and the lift, and how the player chooses. */
export interface BunkerFeed {
  lives: Lives;
  selected: VehicleKind;
  elevator: Elevator | null;
  base: number;
  /** A touch screen: the help says tap. */
  touch: boolean;
  /** Night: the camera has switched to its infrared, black and white. */
  night: boolean;
  /** For the clock and the live read-outs. */
  now: Date;
}

/** What a parked vehicle takes up in its bay, in the bunker's units: half its length across, its height, half its depth. */
const PARKED: Record<VehicleKind, [number, number, number]> = { heli: [24, 17, 9], tank: [19, 13, 9], asv: [17, 12, 9], jeep: [12, 12, 8] };
/** The middle of a bay's depth, where the models are parked. */
const PARK_Z = -19;
const BAY_NO: Record<VehicleKind, string> = { heli: 'B1', tank: 'B2', asv: 'B3', jeep: 'B4' };

/** The analysis' brief on each vehicle: what it is for, what it fears, and ratings the numbers don't give. */
const BRIEF: Record<VehicleKind, { cls: string; role: string; terrain: string; vuln: string; fire: number; arms: string }> = {
  tank: { cls: 'MAIN BATTLE TANK', role: 'ASSAULT / ANTI-ARMOR', terrain: 'LAND', vuln: 'AIR, MINES', fire: 0.75, arms: 'SHELLS' },
  jeep: { cls: 'LIGHT RECON', role: 'FLAG RETRIEVAL ONLY UNIT', terrain: 'LAND + WATER', vuln: 'ALL FIRE', fire: 0.35, arms: 'GRENADES' },
  asv: { cls: 'ARMORED SUPPORT', role: 'SIEGE / MINE LAYER', terrain: 'LAND', vuln: 'AIR, SLOW', fire: 0.9, arms: 'MISSILES, MINES' },
  heli: { cls: 'ATTACK HELICOPTER', role: 'AIR STRIKE / RECON', terrain: 'AIR', vuln: 'ASV, TOWERS', fire: 0.8, arms: 'GUN, MISSILES' },
};

/** A vehicle's ratings from its definition: tank shells to destroy it, top speed, and fuel. */
function ratings(kind: VehicleKind): { hits: number; kph: number; fuel: number } {
  const d = VEHICLES[kind];
  return {
    hits: Math.ceil(d.health / Math.max(ONE / 16, ONE - d.armour)),
    kph: Math.round((d.maxForward / ONE) * 40),
    fuel: Math.round(d.fuel / ONE),
  };
}
const MOST = (() => {
  const all = (Object.keys(VEHICLES) as VehicleKind[]).map(ratings);
  return { hits: Math.max(...all.map((r) => r.hits)), kph: Math.max(...all.map((r) => r.kph)), fuel: Math.max(...all.map((r) => r.fuel)) };
})();

/** A smooth wander between -1 and 1, for the feed's live read-outs. */
function wander(t: number, seed: number): number {
  return 0.6 * Math.sin(t * 0.9 + seed * 2.1) + 0.4 * Math.sin(t * 2.3 + seed * 5.3);
}

let scan: { canvas: HTMLCanvasElement; pattern: CanvasPattern | null } | null = null;

/**
 * Over the security camera's picture: scanlines, a rolling bar and a dark rim. Its colour (washed out by day, black and
 * white infrared by night) is the renderer's (look.ts), since this draws on a see-through canvas over the picture,
 * where a blending mode has nothing to blend with and would paint the view over in grey.
 */
function cctv(g: CanvasRenderingContext2D, rect: ModernRect, t: number): void {
  g.save();
  if (!scan) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 3;
    const s = c.getContext('2d')!;
    s.fillStyle = 'rgba(0, 0, 0, 0.18)';
    s.fillRect(0, 0, 4, 1);
    scan = { canvas: c, pattern: g.createPattern(c, 'repeat') };
  }
  if (scan.pattern) {
    g.fillStyle = scan.pattern;
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  // The rolling bar of a camera on a long cable.
  const span = rect.h + 160;
  const y = rect.y - 80 + ((t * 70) % span);
  const bar = g.createLinearGradient(0, y - 60, 0, y + 60);
  bar.addColorStop(0, 'rgba(255, 255, 255, 0)');
  bar.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
  bar.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = bar;
  g.fillRect(rect.x, y - 60, rect.w, 120);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const rim = g.createRadialGradient(cx, cy, Math.min(rect.w, rect.h) * 0.35, cx, cy, Math.hypot(rect.w, rect.h) * 0.62);
  rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rim.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
  g.fillStyle = rim;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.restore();
}

/** A row of a vehicle's card: a name and a value, with a rating bar between them when it has one. */
interface CardRow {
  k: string;
  v: string;
  bar?: number;
  css?: string;
}

/** The analysis' card on a vehicle, for choosing what to launch: what it is, its ratings, its arms and how many are left. */
function cardRows(kind: VehicleKind, n: number, mine: boolean, elevator: Elevator | null, tick: number): CardRow[] {
  const b = BRIEF[kind];
  const r = ratings(kind);
  const d = VEHICLES[kind];
  const ammo = d.weapons.map((w) => (w.ammo === UNLIMITED ? '--' : String(w.ammo))).join('/');
  const units = n === UNLIMITED ? 'UNLIMITED' : n === 0 ? '0  DEPLETED' : `${n}  READY`;
  const status = elevator && mine
    ? (elevator.lift < ELEVATOR_REST_PX * ONE ? `LAUNCHING ${Math.round(Math.min(100, (100 * (ELEVATOR_REST_PX * ONE - elevator.lift)) / (ELEVATOR_REST_PX * ONE)))}%` : 'LOADING LIFT')
    : n === 0 && !mine ? 'UNAVAILABLE' : mine ? ((tick >> 4) & 1 ? 'SELECTED  > LAUNCH' : 'SELECTED') : 'STANDBY';
  return [
    { k: 'CLASS', v: b.cls },
    { k: 'ROLE', v: b.role, css: kind === 'jeep' ? AMBER : undefined },
    { k: 'ARMOR', v: `${r.hits} HITS`, bar: r.hits / MOST.hits },
    { k: 'SPEED', v: `${r.kph} KPH`, bar: r.kph / MOST.kph },
    { k: 'FIRE', v: b.fire >= 0.8 ? 'HEAVY' : b.fire >= 0.6 ? 'MEDIUM' : 'LIGHT', bar: b.fire },
    { k: 'FUEL', v: `${r.fuel} U`, bar: r.fuel / MOST.fuel },
    { k: 'ARMS', v: `${b.arms} ${ammo}` },
    { k: 'TERRAIN', v: b.terrain },
    { k: 'VULN', v: b.vuln, css: HOSTILE },
    { k: 'UNITS', v: units, css: n === 0 ? HOSTILE : n === UNLIMITED || n > 2 ? '#7dffa0' : AMBER },
    { k: 'STATUS', v: status, css: mine ? AMBER : n === 0 ? HOSTILE : undefined },
  ];
}
const ELEVATOR_REST_PX = 110;

/** Draws a vehicle's card with its top left at x, y in the given scale; returns nothing. */
function card(g: CanvasRenderingContext2D, x: number, y: number, w: number, s: number, head: string, rows: readonly CardRow[], css: string, dim: boolean): void {
  const rh = 12 * s;
  const h = (rows.length + 1) * rh + 12 * s;
  g.save();
  g.globalAlpha = dim ? 0.62 : 1;
  readout(g, x, y, w, h, 'ANALYSIS', css);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `700 ${Math.round(12 * s)}px ${MONO}`;
  g.fillStyle = css;
  g.fillText(head, x + 8 * s, y + 6 * s + rh / 2 + 2 * s, w - 16 * s);
  g.fillStyle = 'rgba(236, 242, 232, 0.25)';
  g.fillRect(x + 8 * s, y + 6 * s + rh + 2 * s, w - 16 * s, 1);
  const keyW = 62 * s;
  rows.forEach((r, i) => {
    const ry = y + 6 * s + (i + 1) * rh + rh / 2 + 4 * s;
    g.font = `600 ${Math.round(10 * s)}px ${MONO}`;
    g.fillStyle = MUTED;
    g.fillText(r.k, x + 8 * s, ry);
    let vx = x + 8 * s + keyW;
    if (r.bar !== undefined) {
      const segs = 8;
      const sw = 6 * s;
      const lit = Math.max(1, Math.round(r.bar * segs));
      for (let k = 0; k < segs; k++) {
        g.fillStyle = k < lit ? (r.css ?? css) : 'rgba(236, 242, 232, 0.16)';
        g.fillRect(vx + k * (sw + 1.5 * s), ry - 3.5 * s, sw, 7 * s);
      }
      vx += segs * (sw + 1.5 * s) + 6 * s;
    }
    g.font = `600 ${Math.round(11 * s)}px ${MONO}`;
    g.fillStyle = r.css ?? INK;
    g.fillText(r.v, vx, ry, x + w - 8 * s - vx);
  });
  g.restore();
}

/**
 * The bunker as a security camera's feed analysed by the machine vision: the picture washed out (black and white
 * infrared at night), a detection box on each bay's vehicle with its class and confidence, a card beside it with the
 * vehicle's ratings for choosing what to launch, and the camera's live read-outs: its clock and REC, the link, and
 * the lift's state.
 */
export function drawBunkerPanel(g: CanvasRenderingContext2D, rect: ModernRect, at: BunkerPoint, f: BunkerFeed): void {
  const { lives, selected, elevator, base } = f;
  const t = f.now.getTime() / 1000;
  const tick = Math.floor(t * 30);
  g.save();
  g.beginPath();
  g.rect(rect.x, rect.y, rect.w, rect.h);
  g.clip();
  cctv(g, rect, t);
  const s = Math.min(1, rect.w / 900);
  const chosen = elevator?.kind ?? selected;
  // Room beside the bays for the cards; on a narrow view only the chosen vehicle's card shows, below the bays.
  // On a phone or tablet the cards are too small to read at the view's scale: only the chosen vehicle's shows, larger.
  const cs = f.touch ? Math.max(s, 1.45 * Math.min(1, rect.w / 1280)) : s;
  const bayL = at(rect, -72, -72, 0).x;
  const cardW = 236 * cs;
  const roomy = bayL - rect.x - 8 >= cardW;
  // The chosen vehicle's card is the one that matters, so it is drawn larger where there is room; the others shrink
  // to their name and how many are left.
  const big = roomy && !f.touch ? Math.max(1, Math.min(1.3, (bayL - rect.x - 8) / cardW)) : 1;
  for (const kind of Object.keys(BAY_AT) as VehicleKind[]) {
    if (elevator && kind !== chosen) continue;
    const b = BAY_AT[kind];
    const n = lives[kind];
    const mine = kind === chosen;
    const [hl, ht, hd] = PARKED[kind];
    const dx = mine && elevator ? elevator.dx / ONE : 0;
    const dy = mine && elevator ? elevator.dy / ONE : 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const ex of [-hl, hl]) {
      for (const ey of [0, ht]) {
        for (const ez of [-hd, hd]) {
          const p = at(rect, b.x + dx + ex, b.floor - dy + ey, PARK_Z + ez);
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x);
          y1 = Math.max(y1, p.y);
        }
      }
    }
    // The detector trails a little and its box breathes.
    const jit = Math.sin(t * 7 + b.x) * 1.2;
    x0 -= jit;
    x1 += jit;
    const empty = n === 0 && !mine;
    const css = mine ? AMBER : empty ? 'rgba(236, 242, 232, 0.45)' : FRIEND;
    const l = Math.max(6, Math.min(16, (x1 - x0) / 5));
    g.strokeStyle = css;
    g.lineWidth = mine ? 2 : 1.5;
    if (empty) {
      g.setLineDash([4, 4]);
      g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      g.setLineDash([]);
    } else {
      g.beginPath();
      for (const [x, y, ddx, ddy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
        g.moveTo(x, y + ddy * l);
        g.lineTo(x, y);
        g.lineTo(x + ddx * l, y);
      }
      g.stroke();
      g.fillStyle = mine ? 'rgba(255, 196, 74, 0.08)' : 'rgba(98, 224, 255, 0.06)';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // The class and confidence over the box.
    g.font = `600 ${Math.round(11 * Math.max(0.8, s))}px ${MONO}`;
    g.textBaseline = 'bottom';
    g.textAlign = 'left';
    const tag = empty ? `${BAY_NO[kind]} BAY EMPTY 0.99` : `${NAMES[kind].toUpperCase()} ${confidence(Object.keys(BAY_AT).indexOf(kind) * 3 + base, tick)}`;
    const tw = g.measureText(tag).width + 8;
    g.fillStyle = 'rgba(6, 10, 12, 0.66)';
    g.fillRect(x0, y0 - 15, tw, 14);
    g.fillStyle = css;
    g.fillText(tag, x0 + 4, y0 - 2);
    if ((!roomy || f.touch) && !mine) continue;
    // The card: beside the bay, out from the shaft (upper bays rise from their floor, lower ones hang from their ceiling).
    const full = cardRows(kind, n, mine, elevator, tick);
    const rows = mine || !roomy || f.touch ? full : full.filter((r) => r.k === 'UNITS');
    const ks = mine ? cs * big : cs;
    const cw = mine ? cardW * big : cardW;
    const h = (rows.length + 1) * 12 * ks + 12 * ks;
    // Large cards all stand on their bay's floor, clear of the controls along the bottom.
    const top = b.floor > -100 || f.touch;
    let cx: number;
    let cy: number;
    if (roomy) {
      const edge = at(rect, b.left ? -72 : 72, b.floor + (top ? 0 : 28), 0);
      cx = b.left ? edge.x - 14 * cs - cw : edge.x + 14 * cs;
      cy = top ? edge.y - h : edge.y;
    } else {
      cx = rect.x + (rect.w - cardW) / 2;
      cy = rect.y + rect.h - h - 96 * s;
    }
    cx = Math.max(rect.x + 8, Math.min(rect.x + rect.w - cw - 8, cx));
    cy = Math.max(rect.y + 56 * s, cy);
    // A leader from the box to its card.
    if (roomy) {
      g.strokeStyle = css;
      g.lineWidth = 1;
      g.globalAlpha = 0.6;
      g.beginPath();
      const fromX = b.left ? x0 : x1;
      const toX = b.left ? cx + cw : cx;
      const midY = (y0 + y1) / 2;
      g.moveTo(fromX, midY);
      g.lineTo(toX, Math.max(cy + 8, Math.min(cy + h - 8, midY)));
      g.stroke();
      g.globalAlpha = 1;
    }
    const head = `${NAMES[kind].toUpperCase()}  ${BAY_NO[kind]}  UID ${base + 1}${kind[0]!.toUpperCase()}-${String(n === UNLIMITED ? 99 : n).padStart(2, '0')}`;
    card(g, cx, cy, cw, ks, head, rows, css, empty || !mine);
  }
  // The camera's own overlay: brackets, its name, the clock and REC.
  drawFeed(g, rect, { name: `CAM-0${base + 1}  BUNKER`, mode: f.night ? 'IR  B/W  NIGHT' : 'CCTV  COLOR  DAY', lines: [], now: f.now });
  // The link's read-outs, ticking, at the bottom right.
  const ms = Math.floor(t * 25);
  const link = [
    `SIG   ${(-52 + 3 * wander(t, 1)).toFixed(0)} dBm`,
    `BIT   ${(4.6 + 0.5 * wander(t, 2)).toFixed(2)} Mb/s`,
    `FPS   ${(25 - Math.max(0, 0.4 * wander(t * 3, 3))).toFixed(1)}`,
    `LAT   ${Math.round(112 + 18 * wander(t * 2, 4))} ms`,
    `LOSS  ${Math.max(0, 0.2 + 0.25 * wander(t * 1.5, 5)).toFixed(2)}%`,
    `FRM   ${String(ms % 10000000).padStart(7, '0')}`,
  ];
  const lift = elevator
    ? [
      `LIFT  ${elevator.lift < ELEVATOR_REST_PX * ONE ? 'RAISING' : 'LOADING'}`,
      `POS   ${Math.max(0, Math.round(elevator.lift / ONE))} / ${ELEVATOR_REST_PX}`,
      `DOORS ${elevator.lift < 60 * ONE ? 'OPEN' : 'SEALED'}`,
      `UNIT  ${NAMES[chosen].toUpperCase()}`,
    ]
    : ['LIFT  STANDBY', `POS   ${ELEVATOR_REST_PX} / ${ELEVATOR_REST_PX}`, 'DOORS SEALED', `PWR   ${(48 + 0.6 * wander(t, 6)).toFixed(1)} V`];
  const block = (lines: readonly string[], tag: string, x: number, align: 'left' | 'right', above = 0) => {
    g.font = `600 ${Math.round(11 * s)}px ${MONO}`;
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 20 * s;
    const h = lines.length * 14 * s + 12 * s;
    const bx = align === 'left' ? x : x - w;
    const by = rect.y + rect.h - (h + 22 * s) * (above + 1);
    readout(g, bx, by, w, h, tag);
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, bx + 10 * s, by + 6 * s + 7 * s + i * 14 * s));
    return w;
  };
  const wide = rect.w >= 800;
  if (wide) block(lift, 'LIFT', rect.x + 22 * s, 'left');
  // On a touch screen the Launch button covers the bottom right, so the link read-out sits above the lift's.
  if (f.touch) block(link, 'LINK', rect.x + 22 * s, 'left', wide ? 1 : 0);
  else block(link, 'LINK', rect.x + rect.w - 22 * s, 'right');
  if (!elevator) {
    // What to do, at the bottom middle.
    const side = TEAMS[base];
    const title = `AWAITING UNIT SELECTION${side ? `  /  ${side.name.toUpperCase()} BASE` : ''}`;
    const help = f.touch ? 'TAP A BAY TO SELECT, TAP AGAIN TO LAUNCH' : 'ARROWS OR CLICK TO SELECT, FIRE OR CLICK AGAIN TO LAUNCH';
    g.font = `700 ${Math.round(13 * s)}px ${MONO}`;
    const tw = g.measureText(title).width;
    g.font = `500 ${Math.round(11 * s)}px ${MONO}`;
    const hw = g.measureText(help).width;
    const w = Math.max(tw, hw) + 36 * s;
    const h = 46 * s;
    const x = wide ? rect.x + (rect.w - w) / 2 : rect.x + 22 * s;
    const y = rect.y + rect.h - h - 22 * s;
    readout(g, x, y, w, h, 'SYS', AMBER);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(13 * s)}px ${MONO}`;
    g.fillStyle = AMBER;
    g.fillText(title, x + 18 * s, y + 17 * s);
    if (side) {
      g.fillStyle = side.css;
      g.fillRect(x + 7 * s, y + 13 * s, 7 * s, 7 * s);
    }
    g.font = `500 ${Math.round(11 * s)}px ${MONO}`;
    g.fillStyle = INK;
    g.fillText(help, x + 18 * s, y + 33 * s);
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

const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
const INK = '#ecf2e8';
const AMBER = '#ffc44a';

/**
 * A computer-vision read-out frame: dark glass, a thin off-white outline with brighter corner ticks, and a small tag
 * at its top left (STATUS, EVENT...), as the analysis labels what it shows.
 */
function readout(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tag: string, css = INK): void {
  g.fillStyle = 'rgba(6, 10, 12, 0.66)';
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(236, 242, 232, 0.35)';
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const l = Math.min(10, w / 4, h / 2);
  g.strokeStyle = css;
  g.lineWidth = 1.5;
  g.beginPath();
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
    g.moveTo(cx, cy + dy * l);
    g.lineTo(cx, cy);
    g.lineTo(cx + dx * l, cy);
  }
  g.stroke();
  if (tag) {
    g.save();
    g.font = `700 9px ${MONO}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const tw = g.measureText(tag).width + 8;
    g.fillStyle = css;
    g.fillRect(x + l + 4, y - 5, tw, 10);
    g.fillStyle = '#0b0f10';
    g.fillText(tag, x + l + 8, y);
    g.restore();
  }
}

/** A short note at the top left of a view ("Get the flag home!", "Watching ..."), below the page's buttons. */
export function drawNote(g: CanvasRenderingContext2D, rect: ModernRect, text: string): void {
  const scale = Math.min(1, rect.w / 900) * touchHud.text;
  g.save();
  g.font = `700 ${Math.round(14 * scale)}px ${MONO}`;
  const t = text.toUpperCase();
  const w = g.measureText(t).width + 28 * scale;
  const h = 30 * scale;
  const x = rect.x + 20 * scale;
  // On a touch screen, under the messages (which start below the on-screen buttons).
  // Clear of the menu button in the corner, however small the view.
  const y = rect.y + (touchHud.on ? TOUCH_TOP + 2 * 38 * touchHud.text : Math.max(64 * scale, 60));
  readout(g, x, y, w, h, 'STATUS', AMBER);
  g.fillStyle = AMBER;
  g.textBaseline = 'middle';
  g.fillText(t, x + 14 * scale, y + h / 2 + 1);
  g.restore();
}

/** The latest match messages, newest last, stacked at the top middle. */
export function drawLog(g: CanvasRenderingContext2D, lines: readonly string[], width: number): void {
  const T = touchHud.text;
  g.save();
  g.font = `600 ${Math.round(13 * T)}px ${MONO}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((text, i) => {
    const t = text.toUpperCase();
    const w = Math.min(width - 40, g.measureText(t).width + 32);
    const h = 28 * T;
    const x = (width - w) / 2;
    const y = (touchHud.on ? TOUCH_TOP : 22) + i * 38 * T;
    readout(g, x, y, w, h, i === lines.length - 1 ? 'EVENT' : '');
    g.fillStyle = INK;
    g.fillText(t, width / 2, y + h / 2 + 1, w - 24);
  });
  g.restore();
}

/** A big centred message: who won, or the server's pause. */
export function drawBanner(g: CanvasRenderingContext2D, text: string, width: number, y: number, size = 44): void {
  g.save();
  const s = Math.round(size * 0.8);
  g.font = `800 ${s}px ${MONO}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const t = text.toUpperCase();
  const w = g.measureText(t).width + s * 1.6;
  const h = s * 2;
  readout(g, (width - w) / 2, y - h / 2, w, h, 'ANALYSIS', AMBER);
  g.fillStyle = INK;
  g.fillText(t, width / 2, y + 2);
  g.restore();
}

/** A run of coloured text pieces on one line. */
export interface TextRun {
  text: string;
  css: string;
}

/** Chat lines in a read-out frame at the top left, under the view's note. */
export function drawChatLines(g: CanvasRenderingContext2D, rect: ModernRect, lines: readonly TextRun[][]): void {
  if (!lines.length) return;
  const scale = Math.min(1, rect.w / 900) * touchHud.text;
  g.save();
  g.font = `500 ${Math.round(13 * scale)}px ${MONO}`;
  const lh = 22 * scale;
  const w = Math.min(rect.w - 40 * scale, 520 * scale);
  const x = rect.x + 20 * scale;
  const y = rect.y + (touchHud.on ? TOUCH_TOP + 2 * 38 * touchHud.text : 58 * scale);
  readout(g, x, y, w, lines.length * lh + 14 * scale, 'COMMS');
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

/** The scoreboard as a read-out table in the middle of the screen. */
export function drawScoreTable(g: CanvasRenderingContext2D, width: number, head: readonly string[], rows: readonly { cells: string[]; css: string }[]): void {
  g.save();
  const cols = [24, 64, 330, 400, 470];
  const w = 600;
  const rh = 32;
  const h = 56 + rows.length * rh;
  const x = (width - w) / 2;
  const y = 90;
  readout(g, x, y, w, h, 'SCORES');
  g.fillStyle = 'rgba(6, 10, 12, 0.3)';
  g.fillRect(x, y, w, h);
  g.textBaseline = 'middle';
  g.font = `700 12px ${MONO}`;
  g.fillStyle = MUTED;
  head.forEach((t, i) => g.fillText(t.toUpperCase(), x + cols[i]!, y + 26));
  rows.forEach((r, k) => {
    const ry = y + 52 + k * rh;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x + 16, ry - 4, w - 32, 1);
    r.cells.forEach((t, i) => {
      g.font = `${i === 1 ? 700 : 500} 14px ${MONO}`;
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
  /** Nothing of the page's sits over the picture (the win scene): all four corner brackets. */
  full?: boolean;
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
    // The page's menu and thermal buttons sit in the picture's top left corner, in place of its bracket.
    if (!f.full && rect.x === 0 && rect.y === 0 && dx > 0 && dy > 0) continue;
    g.moveTo(x, y + dy * l);
    g.lineTo(x, y);
    g.lineTo(x + dx * l, y);
  }
  g.stroke();

  const T = touchHud.text;
  g.font = T === 1 ? FEED_FONT : cv(600, 13);
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
  g.fillText(clock, right, m + 8 + 18 * T);
  g.fillText(f.mode, right, m + 8 + 36 * T);
  // Read-outs down the left edge, clear of the note at the top and the gauges at the bottom.
  g.textAlign = 'left';
  f.lines.forEach((t, i) => g.fillText(t, m + 8, h / 2 - (f.lines.length * 18 * T) / 2 + i * 18 * T));
  g.restore();
}

/** What the win scene's analysis says, and how far through it is. */
export interface Verdict {
  /** The winner's name, in its colour. */
  name: string;
  css: string;
  /** ms since the scene began. */
  t: number;
  /** The read-out lines under the verdict (bases out, time, captures...). */
  lines: readonly string[];
  /** The winning base on screen, to box, or null. */
  target: { x: number; y: number; w: number; h: number } | null;
  /** 0-1: the feed cutting out at the end. */
  lost: number;
}

/** Text typed out a character every few ms from `from`, with a block cursor while it types. */
function typed(text: string, t: number, from: number, every = 38): string {
  const n = Math.floor((t - from) / every);
  if (n <= 0) return '';
  return n >= text.length ? text : `${text.slice(0, n)}\u2588`;
}

/**
 * The win scene's computer-vision analysis over the drone's last pass: a lock on the winning base, then the verdict
 * typed out in a read-out, and SIGNAL LOST as the feed cuts.
 */
export function drawVerdict(g: CanvasRenderingContext2D, width: number, height: number, v: Verdict): void {
  g.save();
  g.textBaseline = 'middle';
  // The lock: a box that closes in on the base, then holds with its tag.
  if (v.target && v.lost < 0.6) {
    const close = Math.min(1, Math.max(0, (v.t - 300) / 700));
    const grow = 1 + (1 - close) * 1.6;
    const w = v.target.w * grow;
    const h = v.target.h * grow;
    const x = v.target.x - w / 2;
    const y = v.target.y - h / 2;
    if (close > 0 || Math.floor(v.t / 120) % 2) {
      g.strokeStyle = v.css;
      g.lineWidth = 2;
      const l = Math.min(18, w / 4);
      g.beginPath();
      for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
        g.moveTo(cx, cy + dy * l);
        g.lineTo(cx, cy);
        g.lineTo(cx + dx * l, cy);
      }
      g.stroke();
      if (close >= 1) {
        g.font = `700 12px ${MONO}`;
        g.textAlign = 'left';
        const tag = `VICTOR // ${v.name.toUpperCase()}  CONF ${(97 + ((v.t / 997) % 1) * 2.9).toFixed(1)}%`;
        const tw = g.measureText(tag).width + 12;
        g.fillStyle = v.css;
        g.fillRect(x, y - 20, tw, 18);
        g.fillStyle = '#0b0f10';
        g.fillText(tag, x + 6, y - 10);
      }
    }
  }
  // The verdict, at the bottom middle.
  if (v.t > 1200 && v.lost < 1) {
    const head = 'MISSION ASSESSMENT';
    const big = `${v.name} wins`.toUpperCase();
    g.font = `800 40px ${MONO}`;
    const bw = g.measureText(big).width;
    g.font = `600 14px ${MONO}`;
    const lw = Math.max(...v.lines.map((l) => g.measureText(l).width), g.measureText(head).width);
    const w = Math.min(width - 60, Math.max(bw, lw) + 64);
    const h = 86 + v.lines.length * 22;
    const x = (width - w) / 2;
    const y = height - h - 60;
    g.globalAlpha = 1 - v.lost;
    readout(g, x, y, w, h, 'ANALYSIS', v.css);
    g.textAlign = 'left';
    g.font = `600 13px ${MONO}`;
    g.fillStyle = INK;
    g.fillText(typed(head, v.t, 1400, 30), x + 24, y + 22);
    g.font = `800 40px ${MONO}`;
    g.fillStyle = v.css;
    g.fillText(typed(big, v.t, 2000, 70), x + 24, y + 54, w - 48);
    g.font = `600 14px ${MONO}`;
    g.fillStyle = INK;
    v.lines.forEach((l, i) => g.fillText(typed(l, v.t, 3000 + i * 700, 22), x + 24, y + 92 + i * 22, w - 48));
    g.globalAlpha = 1;
  }
  // The feed cutting out.
  if (v.lost > 0.5) {
    g.fillStyle = `rgba(0, 0, 0, ${Math.min(0.85, (v.lost - 0.5) * 1.7)})`;
    g.fillRect(0, 0, width, height);
    if (Math.floor(v.t / 260) % 4 !== 3) {
      g.font = `800 30px ${MONO}`;
      g.textAlign = 'center';
      const t = 'SIGNAL LOST';
      const w = g.measureText(t).width + 60;
      readout(g, (width - w) / 2, height / 2 - 34, w, 68, 'UAV-1', AMBER);
      g.fillStyle = AMBER;
      g.fillText(t, width / 2, height / 2 + 1);
    }
  }
  g.restore();
}

/**
 * The modern view's link-up screen, shown while its renderer is still loading as a match starts: the loading screen
 * (drawLoadingFeed) carried on from the loading of the match, or the bare feed linking up when there was none, so a
 * modern match never opens on the classic picture.
 */
export function drawLinkUp(g: CanvasRenderingContext2D, width: number, height: number, ms: number, s: LoadingState | null = null): void {
  drawLoadingFeed(g, width, height, ms, s ?? { kind: 'match', map: '', mode: '', night: false, steps: [{ label: 'DRONE FEED', plain: '', done: false }], since: 0, tip: '' }, false);
}

let backdrop: { from: CanvasImageSource; canvas: OffscreenCanvas } | null = null;

/** The loading screen's backdrop made once from its picture: filling the screen, blurred, washed out and dark. */
function backdropOf(from: CanvasImageSource, width: number, height: number): OffscreenCanvas {
  if (backdrop?.from === from) return backdrop.canvas;
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d')!;
  const img = from as CanvasImageSource & { width: number; height: number };
  // Zoomed past its edges, so the blur has no dark rim and the picture's own read-outs are mostly out of frame.
  const fit = Math.max(width / img.width, height / img.height) * 1.25;
  g.fillStyle = '#05080a';
  g.fillRect(0, 0, width, height);
  g.filter = 'blur(7px)';
  g.drawImage(img, (width - img.width * fit) / 2, (height - img.height * fit) / 2, img.width * fit, img.height * fit);
  g.filter = 'none';
  g.globalCompositeOperation = 'saturation';
  g.fillStyle = 'rgba(128, 128, 128, 0.8)';
  g.fillRect(0, 0, width, height);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(5, 8, 10, 0.72)';
  g.fillRect(0, 0, width, height);
  backdrop = { from, canvas };
  return canvas;
}

const LOADING_HEAD: Record<LoadingState['kind'], string> = {
  match: 'ACQUIRING DRONE FEED',
  replay: 'DECODING FLIGHT RECORDING',
  online: 'JOINING OPERATION',
  boot: 'SYSTEM START',
};

/**
 * The modern view's loading screen, as the drone's feed linking up: the last picture it had (the backdrop) dark and
 * washed out under static, a search grid sweeping it, the link's progress in the middle, the mission's details and the
 * system's log of what has loaded below, and an intel line (a tip) along the bottom. full: nothing of the page's sits
 * over the top left corner (in a match the menu button does, so its corner bracket is left out).
 */
export function drawLoadingFeed(g: CanvasRenderingContext2D, width: number, height: number, ms: number, s: LoadingState, full = true): void {
  const t = ms - s.since;
  g.save();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#05080a';
  g.fillRect(0, 0, width, height);
  if (s.backdrop) {
    // The feed's last picture, out of focus, dark and nearly black and white, drifting in slowly.
    const img = backdropOf(s.backdrop, width, height);
    const zoom = 1 + 0.05 * Math.min(1, t / 20000);
    g.globalAlpha = Math.min(1, t / 600);
    g.drawImage(img, (width - width * zoom) / 2, (height - height * zoom) / 2, width * zoom, height * zoom);
    g.globalAlpha = 1;
  }
  // Faint static bands drifting down the picture, and a brighter band rolling through.
  let seed = (Math.floor(ms / 60) * 2654435761) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 28; i++) {
    const y = rand() * height;
    g.fillStyle = `rgba(236, 242, 232, ${0.02 + rand() * 0.05})`;
    g.fillRect(0, y, width, 1 + rand() * 3);
  }
  const roll = ((ms / 9) % (height + 120)) - 60;
  g.fillStyle = 'rgba(236, 242, 232, 0.035)';
  g.fillRect(0, roll, width, 60);
  // The search grid, and its sweep.
  g.strokeStyle = 'rgba(98, 224, 255, 0.07)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = (width / 2) % 80; x < width; x += 80) {
    g.moveTo(Math.round(x) + 0.5, 0);
    g.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = (height / 2) % 80; y < height; y += 80) {
    g.moveTo(0, Math.round(y) + 0.5);
    g.lineTo(width, Math.round(y) + 0.5);
  }
  g.stroke();
  const sweep = ((ms / 6) % (width + 300)) - 150;
  const band = g.createLinearGradient(sweep - 150, 0, sweep, 0);
  band.addColorStop(0, 'rgba(98, 224, 255, 0)');
  band.addColorStop(1, 'rgba(98, 224, 255, 0.09)');
  g.fillStyle = band;
  g.fillRect(sweep - 150, 0, 150, height);
  g.fillStyle = 'rgba(98, 224, 255, 0.35)';
  g.fillRect(Math.round(sweep), 0, 1, height);

  const linking = s.steps.some((x) => !x.done);
  drawFeed(g, { x: 0, y: 0, w: width, h: height }, { name: 'UAV-1', mode: linking ? 'NO SIGNAL' : 'SIGNAL OK', lines: [], now: new Date(), full });

  // The link's progress: a share for each step done, and the one under way creeping on.
  const n = s.steps.length || 1;
  const done = s.steps.filter((x) => x.done).length;
  const creep = done < n ? 1 - Math.exp(-t / 1500) : 0;
  const share = Math.min(1, (done + 0.9 * creep) / n);
  const dots = '.'.repeat(1 + (Math.floor(ms / 400) % 3)).padEnd(3, ' ');
  const head = LOADING_HEAD[s.kind];
  const size = 28;
  g.font = `800 ${size}px ${MONO}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const bw = Math.max(g.measureText(`${head}...`).width + size * 1.6, 460);
  const bh = size * 2 + 34;
  const bx = (width - bw) / 2;
  const by = height * 0.42 - bh / 2;
  readout(g, bx, by, bw, bh, 'SYS', AMBER);
  g.fillStyle = INK;
  g.fillText(`${head}${dots}`, width / 2, by + size + 2);
  // The bar, in ticks, and the share in figures.
  const tx = bx + 22;
  const tw = bw - 44 - 64;
  const ty = by + bh - 26;
  const ticks = 40;
  const lit = share * ticks;
  for (let i = 0; i < ticks; i++) {
    const on = i < Math.floor(lit);
    g.fillStyle = on ? AMBER : i < lit ? 'rgba(255, 196, 74, 0.5)' : 'rgba(236, 242, 232, 0.14)';
    g.fillRect(tx + (i * tw) / ticks, ty, tw / ticks - 2, 10);
  }
  g.font = `700 13px ${MONO}`;
  g.textAlign = 'right';
  g.fillStyle = AMBER;
  g.fillText(`${String(Math.floor(share * 100)).padStart(3, '0')}%`, bx + bw - 22, ty + 5);

  // The mission, bottom left; the system's log, bottom right.
  const cardY = by + bh + 40;
  const cardW = 360;
  const row = 20;
  const mission: [string, string][] = [
    ['AO', (s.map || 'UNKNOWN').toUpperCase()],
    ['OPERATION', s.mode || '-'],
    ['CONDITIONS', s.night ? 'NIGHT  /  LOW LIGHT' : 'DAY  /  CLEAR'],
  ];
  const left = width / 2 - cardW - 20;
  const right = width / 2 + 20;
  const logRows = s.steps.length;
  const cardH = Math.max(mission.length, logRows) * row + 26;
  readout(g, left, cardY, cardW, cardH, 'MISSION', FRIEND);
  readout(g, right, cardY, cardW, cardH, 'LOG', FRIEND);
  g.font = `600 13px ${MONO}`;
  g.textBaseline = 'middle';
  mission.forEach(([k, v], i) => {
    const y = cardY + 22 + i * row;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(236, 242, 232, 0.55)';
    g.fillText(k, left + 14, y);
    g.fillStyle = INK;
    g.fillText(v, left + 120, y, cardW - 134);
  });
  let first = true;
  s.steps.forEach((step, i) => {
    const y = cardY + 22 + i * row;
    const now = !step.done && first;
    if (!step.done) first = false;
    g.textAlign = 'left';
    g.fillStyle = step.done ? INK : now ? AMBER : 'rgba(236, 242, 232, 0.4)';
    g.fillText(`> ${step.label}`, right + 14, y);
    g.textAlign = 'right';
    g.fillStyle = step.done ? '#7cf08a' : now ? AMBER : 'rgba(236, 242, 232, 0.4)';
    g.fillText(step.done ? 'OK' : now ? (step.detail ? `AWAIT ${step.detail}` : `SYNC ${'|/-\\'[Math.floor(ms / 120) % 4]}`) : 'STANDBY', right + cardW - 14, y, cardW - 170);
  });

  // The intel line.
  if (s.tip) {
    g.font = `600 14px ${MONO}`;
    g.textAlign = 'center';
    const text = s.tip.toUpperCase();
    const iw = Math.min(width - 120, g.measureText(text).width + 40);
    const iy = height - 92;
    readout(g, (width - iw) / 2, iy, iw, 34, 'INTEL', AMBER);
    g.fillStyle = INK;
    g.fillText(text, width / 2, iy + 18, iw - 30);
  }
  g.restore();
}
