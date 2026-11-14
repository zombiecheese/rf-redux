// The modern view's screen: its size and where each view goes on it. Kept apart from the renderer so the game can
// lay it out without loading three.js, which is only fetched the first time the modern view is picked.

export const MODERN_W = 1280;
export const MODERN_H = 720;
/** The split screen's two views and the strip between them. */
const SPLIT_GAP = 8;

/** One view on the modern screen, in its pixels. */
export interface ModernRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function modernLayout(players: number): ModernRect[] {
  if (players === 1) return [{ x: 0, y: 0, w: MODERN_W, h: MODERN_H }];
  const w = (MODERN_W - SPLIT_GAP) / 2;
  return [{ x: 0, y: 0, w, h: MODERN_H }, { x: w + SPLIT_GAP, y: 0, w, h: MODERN_H }];
}

let webgl: boolean | null = null;

/** Whether this browser can draw the modern view (it needs WebGL), asked once. */
export function modernAvailable(): boolean {
  if (webgl === null) {
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
