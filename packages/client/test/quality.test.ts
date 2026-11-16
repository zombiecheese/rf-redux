import { describe, expect, it, vi } from 'vitest';
import { Pacer, PRESETS, activePreset, setQualityChoice, setTiltShift, tiltShiftOn } from '../src/quality.js';

/** Feeds the pacer frames dt ms apart for ms in all, from start; returns the time reached. */
function run(p: Pacer, start: number, dt: number, ms: number): number {
  let t = start;
  for (; t < start + ms; t += dt) p.frame(t);
  return t;
}

describe('quality', () => {
  it('keeps the tilt-shift on by default, and remembers when it is switched off', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
      removeItem: (k: string) => void kept.delete(k),
    });
    expect(tiltShiftOn()).toBe(true);
    setTiltShift(false);
    expect(tiltShiftOn()).toBe(false);
    expect(kept.get('rf.tiltShift')).toBe('off');
    setTiltShift(true);
    expect(tiltShiftOn()).toBe(true);
    expect(kept.get('rf.tiltShift')).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('draws the 3D picture smaller while frames run slow, and back up when they catch up', () => {
    setQualityChoice('high');
    const p = new Pacer(false);
    let t = run(p, 1000, 16.7, 2000);
    expect(p.scale).toBe(1);
    t = run(p, t, 30, 3000);
    expect(p.scale).toBe(0.6);
    run(p, t, 16.7, 15000);
    expect(p.scale).toBe(1);
  });

  it('aims for 30 fps on handhelds', () => {
    setQualityChoice('medium');
    const p = new Pacer(true);
    run(p, 1000, 30, 5000);
    expect(p.scale).toBe(1);
  });

  it('steps Auto down a preset when even the smallest picture is too slow', () => {
    setQualityChoice('auto');
    expect(activePreset(false)).toBe('high');
    const p = new Pacer(false);
    run(p, 1000, 50, 10000);
    expect(activePreset(false)).toBe('medium');
  });

  it('keeps the 3D picture within its preset size', () => {
    expect(PRESETS.low.width(3000)).toBeLessThan(1280);
    expect(PRESETS.high.width(5000)).toBe(2560);
    expect(PRESETS.high.width(800)).toBe(1280);
  });
});
