// The win scene, in place of the original's win movies: the camera rises over the winner's base on the map just
// played, fireworks go up over it, and the winner's banner is shown, all drawn by the game's own renderer from the
// project's own art while the Win piece plays. There are four scenes, picked by the map's level as the movies
// were: each lasts longer and fires more than the last.

import { TICK_MS, type Match } from '@rfw/sim';
import type { GameAssets } from './assets.js';
import { Camera } from './camera.js';
import { Effects } from './effects.js';
import { drawText, textWidth } from './font.js';
import { TEAMS } from './paint.js';
import { Frame, SCREEN_H, SCREEN_W } from './raster.js';
import { drawView } from './view.js';

/**
 * Which scene a level (1-9) gets, as the original picked its movie: one for level 1, the next for 2-5, the next for
 * 6-8 and the grandest for 9.
 */
export function winTier(level: number): number {
  return [0, 1, 1, 1, 1, 2, 2, 2, 3, 3][Math.max(0, Math.min(9, level - 1))]!;
}

/** For each tier: how long it lasts (ms), how many ticks between fireworks, and how high the camera ends. */
const TIERS = [
  { ms: 9000, every: 14, rise: 150 },
  { ms: 11000, every: 10, rise: 190 },
  { ms: 13000, every: 7, rise: 230 },
  { ms: 16000, every: 4, rise: 280 },
] as const;

/** The camera's pitch over the base, in 256ths of a turn (the game's own when a vehicle is stopped). */
const PITCH = 32;
const START_HEIGHT = 40;

/** A run of numbers that is the same every time: where and when each firework goes. */
function dice(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

export interface WinScene {
  ms: number;
  /** Draws the scene `t` ms in. */
  draw(ctx: OffscreenCanvasRenderingContext2D, t: number): void;
}

/** The scene for a finished match: `base` is the winning base, `tier` from winTier. */
export function winScene(match: Match, assets: GameAssets, base: number, tier: number): WinScene {
  const plan = TIERS[Math.max(0, Math.min(TIERS.length - 1, tier))]!;
  const frame = new Frame();
  const image = new ImageData(new Uint8ClampedArray(frame.px.buffer), SCREEN_W, SCREEN_H);
  // The whole screen: there is no console under a win scene.
  const cam = new Camera({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H, dx: 0, dy: 0, boxW: SCREEN_W, boxH: SCREEN_H });
  const effects = new Effects(assets);
  const roll = dice(base * 977 + tier * 131 + 7);
  // The winner's bunker, and its flag if it is lying in the open: the camera starts on one and drifts to the other.
  const home = match.world.bases.find((b) => b.id === base) ?? match.world.bases[0];
  const hx = home ? home.start.tx * 32 + 16 : 2048;
  const hy = home ? home.start.ty * 32 + 16 : 2048;
  const flag = match.flags.find((f) => f.base === base && f.revealed && f.carrier < 0);
  const fx = flag ? flag.x / 65536 : hx;
  const fy = flag ? flag.y / 65536 : hy;
  const team = TEAMS[base] ?? TEAMS[0]!;
  const text = `${team.name} wins`.toUpperCase();
  const blasts = assets.effects ? [assets.effects.mine, ...assets.effects.shots.flat().filter((k): k is string => !!k)] : [];
  let ticks = 0;

  return {
    ms: plan.ms,
    draw(ctx, t) {
      const u = Math.min(1, t / plan.ms);
      // Ease out: quick off the ground, slow at the top.
      const ease = 1 - (1 - u) * (1 - u);
      const x = hx + (fx - hx) * ease;
      const y = hy + (fy - hy) * ease;
      // The effects run on the game's clock, however fast the screen draws.
      for (const want = Math.floor(t / TICK_MS); ticks < want; ticks++) {
        effects.add([], match);
        if (blasts.length && ticks % plan.every === 0) {
          const key = blasts[Math.floor(roll() * blasts.length)]!;
          effects.burst(key, (x + (roll() - 0.5) * 220) * 65536, (y + (roll() - 0.5) * 150) * 65536, (20 + roll() * 60) * 65536);
        }
      }
      effects.takeSounds();
      cam.fix(x, y, START_HEIGHT + (plan.rise - START_HEIGHT) * ease, PITCH);
      frame.setClip(0, 0, SCREEN_W, SCREEN_H);
      drawView(frame, cam, match, assets, -1, effects.current(match.tick + ticks));
      // The banner: the winner's name in its colour on a dark band, sliding up after the first second.
      const size = 3;
      const w = textWidth(text, size);
      const shown = Math.max(0, Math.min(1, (t - 1000) / 600));
      if (shown > 0) {
        const by = SCREEN_H - Math.round(48 * shown);
        frame.setClip(0, 0, SCREEN_W, SCREEN_H);
        for (let yy = by - 6; yy < Math.min(SCREEN_H, by + 8 * size + 6); yy++) {
          for (let xx = 0; xx < SCREEN_W; xx++) {
            const c = frame.px[yy * SCREEN_W + xx]!;
            frame.px[yy * SCREEN_W + xx] = (0xff000000 | (((c >> 16) & 0xff) >> 2 << 16) | (((c >> 8) & 0xff) >> 2 << 8) | ((c & 0xff) >> 2)) >>> 0;
          }
        }
        drawText(frame, text, (SCREEN_W - w) >> 1, by, team.colour, size, SCREEN_W);
      }
      ctx.putImageData(image, 0, 0);
    },
  };
}
