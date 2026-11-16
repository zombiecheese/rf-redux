// The loading screens, in the look of the view the match will be seen in: the modern view's drone feed linking up
// (modern/hud.ts drawLoadingFeed) or the classic view's pixel screen under its CRT. They show what is loading (the
// map, what kind of match, day or night), each step as it is done, and a tip, from the moment a match, a replay or
// an online match starts loading until its first picture. A modern match keeps the same screen while the modern
// renderer's code arrives (game.ts draws it as its link-up), so the two read as one.

import type { Display } from './display.js';
import { drawText, textWidth } from './font.js';
import { Logo } from './logo.js';
import { drawLoadingFeed } from './modern/hud.js';
import { MODERN_H, MODERN_W } from './modern/layout.js';
import { Frame, SCREEN_H, SCREEN_W } from './raster.js';

export type LoadingStyle = 'modern' | 'retro';

/** One thing being loaded, as the screen lists it. */
export interface LoadingStep {
  /** The step as the modern feed's log names it (upper case, CV style). */
  label: string;
  /** The same step in the classic screen's words. */
  plain: string;
  done: boolean;
}

/** What the loading screens show. */
export interface LoadingState {
  /** What is starting: a match, a replay or an online match, or the game itself. */
  kind: 'match' | 'replay' | 'online' | 'boot';
  /** The map's name, once known. */
  map: string;
  /** What kind of match, in a few words (TRAINING, 4 BASES, 2V2...). */
  mode: string;
  night: boolean;
  steps: LoadingStep[];
  /** performance.now() when it began, for the animation and the tips. */
  since: number;
  /** The tip to show, picked as loading began. */
  tip: string;
  /** The modern screen's backdrop: the feed's last picture (the modern title art), once it has loaded. */
  backdrop?: CanvasImageSource | null;
}

/** Tips shown while loading, taken from Help > How to Play. No apostrophes: the classic font has none. */
export const TIPS: readonly string[] = [
  'Only the jeep can carry a flag. Drive it home to your own base, or to one on your team.',
  'The flag hides under one of the enemy flag buildings: shell them to find it.',
  'A base is out when an enemy jeep takes its flag home, or when it has no jeeps left.',
  'Refuel and rearm on any depot pad, then drive back onto your lift to dock.',
  'The tank turret swings on its own keys. Press both together to centre it.',
  'The ASV lays mines with its third button, and fires up at aircraft with its second.',
  'In the air, only anti-air fire can reach the helicopter. Land it on your lift to dock.',
  'The jeep floats its tyres to cross water: its second button.',
  'From skill 4 up, attack drones come for a vehicle that sits still.',
  'When your base is out you can still watch the players who are in.',
  'With more than two bases, the handicap helps the smaller side of an uneven match.',
];

/** Picks a tip, never the same one twice running. */
let lastTip = -1;
function pickTip(): string {
  let i = Math.floor(Math.random() * TIPS.length);
  if (i === lastTip) i = (i + 1) % TIPS.length;
  lastTip = i;
  return TIPS[i]!;
}

/** Steps a match loads through, in the order they finish. */
export const MATCH_STEPS: readonly [label: string, plain: string][] = [
  ['ASSET PACK', 'Loading sprites'],
  ['TERRAIN MAP', 'Loading map'],
  ['BATTLEFIELD', 'Building battlefield'],
];
/** The modern view's last step: its renderer's code, then building the 3D world. */
export const FEED_STEP: [string, string] = ['DRONE FEED', 'Linking drone feed'];

let current: LoadingState | null = null;

/** The loading screen's state, while there is one (game.ts shows it as the modern link-up). */
export function loadingState(): LoadingState | null {
  return current;
}

/**
 * Draws the loading screen for the given state and keeps it moving until stopped. present puts each picture on the
 * page; the classic picture is the 320 x 240 frame (the CRT goes over it), the modern one the full modern screen.
 */
export class LoadingScreen {
  private raf = 0;
  private style: LoadingStyle = 'retro';
  private modern: OffscreenCanvas | null = null;
  private classic: { frame: Frame; canvas: OffscreenCanvas; logo: Logo; at: number } | null = null;

  constructor(private readonly display: Display) {}

  /** Starts a loading screen: the steps listed, none done. */
  start(
    style: LoadingStyle, info: Pick<LoadingState, 'kind' | 'map' | 'mode' | 'night' | 'backdrop'>, steps: readonly (readonly [string, string])[],
  ): void {
    this.style = style;
    current = { ...info, steps: steps.map(([label, plain]) => ({ label, plain, done: false })), since: performance.now(), tip: pickTip() };
    cancelAnimationFrame(this.raf);
    const tick = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.draw(performance.now());
    this.raf = requestAnimationFrame(tick);
  }

  /** What is known once the map has loaded. */
  update(info: Partial<Pick<LoadingState, 'map' | 'mode' | 'night' | 'backdrop'>>): void {
    if (current) Object.assign(current, info);
  }

  /** Marks a step done. */
  done(label: string): void {
    const s = current?.steps.find((x) => x.label === label);
    if (s) s.done = true;
  }

  /** Marks every step done but the ones named (still to come once the match has the screen). */
  handOver(pending: readonly string[] = []): void {
    for (const s of current?.steps ?? []) s.done = !pending.includes(s.label);
  }

  /** Stops drawing: the match has its screen. The state stays for a modern match's link-up until clear. */
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Stops and forgets the state. */
  clear(): void {
    this.stop();
    current = null;
  }

  get running(): boolean {
    return this.raf !== 0;
  }

  private draw(now: number): void {
    const s = current;
    if (!s) return;
    if (this.style === 'modern') {
      this.modern ??= new OffscreenCanvas(MODERN_W, MODERN_H);
      drawLoadingFeed(this.modern.getContext('2d')! as unknown as CanvasRenderingContext2D, MODERN_W, MODERN_H, now, s);
      this.display.present(this.modern, 1, true);
      return;
    }
    const c = (this.classic ??= { frame: new Frame(), canvas: new OffscreenCanvas(SCREEN_W, SCREEN_H), logo: new Logo(), at: 0 });
    // The logo's fire at its own pace, as on the menu.
    if (now - c.at > 45) {
      c.at = now;
      c.logo.step();
    }
    drawClassicLoading(c.frame, now, s);
    const g = c.canvas.getContext('2d')!;
    g.putImageData(new ImageData(new Uint8ClampedArray(c.frame.px.buffer.slice(0)), SCREEN_W, SCREEN_H), 0, 0);
    g.drawImage(c.logo.canvas, (SCREEN_W - c.logo.canvas.width) >> 1, 14);
    this.display.present(c.canvas);
  }
}

// ---- The classic screen --------------------------------------------------------------------------------------

const abgr = (hex: number) => (0xff000000 | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0;
const C = {
  ink: abgr(0xf2ead2),
  amber: abgr(0xf0b030),
  muted: abgr(0x8a8672),
  olive: abgr(0x4f5a3c),
  oliveDark: abgr(0x262b1c),
  green: abgr(0x7cc46a),
};

function centred(f: Frame, text: string, y: number, colour: number): void {
  drawText(f, text, (SCREEN_W - textWidth(text)) >> 1, y, colour);
}

/** Words wrapped to lines of at most n letters. */
function wrap(text: string, n: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    if (line && line.length + 1 + w.length > n) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}

const HEADINGS: Record<LoadingState['kind'], string> = {
  match: 'PREPARING FOR BATTLE',
  replay: 'LOADING REPLAY',
  online: 'JOINING THE BATTLE',
  boot: 'LOADING',
};

/** The classic view's loading screen: the burning logo (drawn over this), what loads, a bar of blocks and a tip. */
export function drawClassicLoading(f: Frame, now: number, s: LoadingState): void {
  f.setClip(0, 0, SCREEN_W, SCREEN_H);
  f.fill(0xff000000);
  const t = now - s.since;
  const dots = '.'.repeat(1 + (Math.floor(t / 400) % 3));
  const head = HEADINGS[s.kind];
  // The heading, with its dots after it so it does not shift as they change.
  drawText(f, head + dots, (SCREEN_W - textWidth(head)) >> 1, 112, C.amber);
  if (s.map) centred(f, s.map.toUpperCase().slice(0, 50), 126, C.ink);
  const mode = [s.mode, s.night ? 'NIGHT' : ''].filter(Boolean).join('  ');
  if (mode) centred(f, mode, 137, C.muted);

  // A bar of blocks: one share for each step done, and the step under way creeping on.
  const n = s.steps.length || 1;
  const done = s.steps.filter((x) => x.done).length;
  const creep = done < n ? 1 - Math.exp(-t / 1500) : 0;
  const share = Math.min(1, (done + 0.9 * creep) / n);
  const BLOCKS = 20;
  const bw = 7;
  const gap = 1;
  const x0 = (SCREEN_W - BLOCKS * (bw + gap) + gap) >> 1;
  const y0 = 154;
  box(f, x0 - 3, y0 - 3, BLOCKS * (bw + gap) - gap + 6, 12, C.olive);
  const lit = Math.round(share * BLOCKS);
  for (let i = 0; i < BLOCKS; i++) rect(f, x0 + i * (bw + gap), y0, bw, 6, i < lit ? (i === lit - 1 && done < n && (t >> 8) & 1 ? C.ink : C.amber) : C.oliveDark);

  // What is loading now.
  const active = s.steps.find((x) => !x.done);
  centred(f, active ? `${active.plain.toUpperCase()}${dots}` : 'READY', 170, active ? C.ink : C.green);

  // A tip along the bottom.
  const tip = wrap(`TIP: ${s.tip.toUpperCase()}`, 50);
  tip.slice(0, 3).forEach((l, i) => centred(f, l, 196 + i * 10, C.muted));
}

function rect(f: Frame, x: number, y: number, w: number, h: number, c: number): void {
  for (let yy = y; yy < y + h; yy++) f.px.fill(c, yy * f.w + x, yy * f.w + x + w);
}

function box(f: Frame, x: number, y: number, w: number, h: number, c: number): void {
  rect(f, x, y, w, 1, c);
  rect(f, x, y + h - 1, w, 1, c);
  rect(f, x, y, 1, h, c);
  rect(f, x + w - 1, y, 1, h, c);
}
