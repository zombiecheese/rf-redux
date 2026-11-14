// The win scene in the modern view: the drone's last pass over the winner's base. It climbs as the retro scene's
// camera does while fireworks go up, the computer vision locks onto the base and types out its verdict, and the
// stream breaks up and cuts to SIGNAL LOST. It draws with the match's own modern renderer, handed over by the game,
// in the look the match was seen in (drone feed or clean, thermal, day or night).

import { TICK_MS, type Match } from '@rfw/sim';
import { Camera, FOCAL } from '../camera.js';
import { TEAMS } from '../paint.js';
import { SCREEN_H, SCREEN_W } from '../raster.js';
import { winPlan, type WinScene } from '../winscene.js';
import { drawFeed, drawVerdict } from './hud.js';
import { MODERN_H, MODERN_W } from './layout.js';
import type { ModernRenderer } from './renderer.js';

/** The camera's pitch over the base, as the retro scene's. */
const PITCH = 32;
const START_HEIGHT = 40;
/** How long the feed takes to cut out at the end (ms). */
const CUT_MS = 1700;

export interface ModernFinale {
  renderer: ModernRenderer;
  extras: Parameters<ModernRenderer['draw']>[2];
}

/** The modern scene for a finished match: `base` is the winning base, `tier` from winTier, `ms` how long it lasted. */
export function modernWinScene(match: Match, finale: ModernFinale, base: number, tier: number, ms: number): WinScene {
  const plan = winPlan(tier);
  const { renderer, extras } = finale;
  const cam = new Camera({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H, dx: 0, dy: 0, boxW: SCREEN_W, boxH: SCREEN_H });
  const rect = { x: 0, y: 0, w: MODERN_W, h: MODERN_H };
  const home = match.world.bases.find((b) => b.id === base) ?? match.world.bases[0];
  const hx = home ? home.start.tx * 32 + 16 : 2048;
  const hy = home ? home.start.ty * 32 + 16 : 2048;
  const flag = match.flags.find((f) => f.base === base && f.revealed && f.carrier < 0);
  const fx = flag ? flag.x / 65536 : hx;
  const fy = flag ? flag.y / 65536 : hy;
  const team = TEAMS[base] ?? TEAMS[0]!;
  const colour: [number, number, number] = [(team.colour & 255) / 255, ((team.colour >> 8) & 255) / 255, ((team.colour >> 16) & 255) / 255];
  const winner = match.players.find((p) => p.base === base);
  const side = winner?.team;
  const out = match.players.filter((p) => p.team !== side).length;
  const clock = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const lines = [
    `HOSTILE BASES NEUTRALISED ... ${out}`,
    `ENGAGEMENT TIME ............. ${clock}`,
    'FEED ARCHIVED // UAV-1',
  ];
  let next = 400;
  const look = renderer.look;
  const started = Date.now();

  return {
    ms: plan.ms,
    draw(ctx, t) {
      const u = Math.min(1, t / plan.ms);
      const ease = 1 - (1 - u) * (1 - u);
      const x = hx + (fx - hx) * ease;
      const y = hy + (fy - hy) * ease;
      const z = START_HEIGHT + (plan.rise - START_HEIGHT) * ease;
      cam.fix(x, y, z, PITCH);
      const lost = Math.max(0, Math.min(1, (t - (plan.ms - CUT_MS)) / (CUT_MS * 0.6)));
      // Fireworks round the base until the feed goes, more of them the higher the level.
      for (; next < t && lost < 0.5; next += plan.every * TICK_MS * (0.6 + Math.random() * 0.8)) {
        const white = Math.random() < 0.25;
        renderer.fx.firework(x + (Math.random() - 0.5) * 260, y + (Math.random() - 0.5) * 170, 70 + Math.random() * 70,
          white ? [1, 0.92, 0.7] : colour, 0.8 + Math.random() * 0.5);
      }
      renderer.jam(lost > 0 ? 0.25 + lost * 0.75 : 0);
      renderer.draw(match, [{ cam, rect, viewer: winner?.id ?? 0, skip: false }], extras);
      const g = renderer.canvas.getContext('2d')!;
      if (look.drone) {
        const tile = (n: number) => String(Math.max(0, Math.floor(n / 32))).padStart(2, '0');
        drawFeed(g, rect, {
          name: 'UAV-1',
          mode: look.thermal ? 'IR  WHT' : look.night ? 'EO  NIGHT' : 'EO  DAY',
          lines: [`ALT ${Math.round((FOCAL + z) * 6)}FT`, 'HDG 000', `GRID ${tile(x)}-${tile(y)}`, `ZOOM ${((FOCAL / (FOCAL + z)) * 2).toFixed(1)}X`],
          now: new Date(started + t),
          full: true,
        });
      }
      const at = renderer.project(cam, rect, hx, hy, 8);
      const scale = FOCAL / (FOCAL + z);
      drawVerdict(g, MODERN_W, MODERN_H, {
        name: team.name, css: team.css, t, lines, lost,
        target: at ? { x: at.x, y: at.y, w: 150 * scale * 4, h: 110 * scale * 4 } : null,
      });
      ctx.drawImage(renderer.canvas, 0, 0);
    },
  };
}
