import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/keys.js';
import { ANGLE_MASK, FIXED_SHIFT } from '@rfw/sim';
import { STICK_MODES, TOUCH_BUTTONS, steer, touchModeFor, type TouchMode } from '../src/touch.js';

/** A heading of h of the 64 steps (0 north, clockwise). */
const facing = (h: number, yaw = 0) => ({ heading: Math.round(h * (1 << FIXED_SHIFT)) & ANGLE_MASK, yaw });

const shown = (mode: TouchMode) => TOUCH_BUTTONS.filter((b) => b.modes.includes(mode));
const presses = (mode: TouchMode) => new Set(shown(mode).flatMap((b) => b.press));

describe('touch controls', () => {
  it('picks the controls from what the player is doing', () => {
    expect(touchModeFor('bunker', null)).toBe('bunker');
    expect(touchModeFor('driving', 'tank')).toBe('tank');
    expect(touchModeFor('driving', 'heli')).toBe('heli');
    expect(touchModeFor('launching', null)).toBe('idle');
    expect(touchModeFor('docking', 'jeep')).toBe('idle');
    expect(touchModeFor('skull', null)).toBe('idle');
    expect(touchModeFor(null, null)).toBe('watch');
    // A player whose base is out watches too, picking with P1-P4.
    expect(touchModeFor('out', null)).toBe('watch');
  });

  it('gives every vehicle the buttons the sim gives it, and no others', () => {
    for (const mode of ['jeep', 'tank', 'asv', 'heli'] as const) {
      const p = presses(mode);
      expect(p.has('fire')).toBe(true);
      expect(p.has('dock')).toBe(true);
      expect(STICK_MODES).toContain(mode);
    }
    expect([...presses('jeep')].sort()).toEqual(['dock', 'fire', 'fire2', 'fire3', 'pause', 'chat', 'scores'].sort());
    expect(presses('tank').has('turretLeft') && presses('tank').has('turretRight')).toBe(true);
    expect(presses('tank').has('fire3')).toBe(false);
    expect(presses('asv').has('fire3') && !presses('asv').has('turretLeft')).toBe(true);
    expect(presses('heli').has('turretLeft') && presses('heli').has('fire3')).toBe(true);
  });

  it('launches from the lift screen and follows players while watching', () => {
    expect([...presses('bunker')].filter((a) => a.startsWith('launch')).sort()).toEqual(['launchAsv', 'launchHeli', 'launchJeep', 'launchTank']);
    expect(presses('bunker').has('fire')).toBe(true);
    // The bays are tapped on the lift screen, so the stick's zone stays off them.
    expect(STICK_MODES.includes('bunker')).toBe(false);
    expect([...presses('watch')].filter((a) => a.startsWith('follow'))).toHaveLength(4);
    expect(presses('watch').has('fire') || STICK_MODES.includes('watch')).toBe(false);
  });

  it('only presses play keys or the known extras', () => {
    const extras = ['pause', 'chat', 'scores', 'follow1', 'follow2', 'follow3', 'follow4'];
    for (const b of TOUCH_BUTTONS) for (const p of b.press) expect([...ACTIONS, ...extras]).toContain(p);
  });

  it('never shows two buttons in the same place', () => {
    for (const mode of ['bunker', 'jeep', 'tank', 'asv', 'heli', 'watch', 'idle'] as const) {
      const spots = shown(mode).filter((b) => !b.cls.startsWith('top')).map((b) => b.cls);
      expect(new Set(spots).size).toBe(spots.length);
    }
  });

  it('steers by direction: turns the short way round to face the stick, then drives', () => {
    // Facing north, stick up: straight ahead.
    expect(steer(0, -1, facing(0.5))).toEqual({ turn: 0, forward: true });
    // Facing north, stick right (east, a quarter turn): turns right on the spot first.
    expect(steer(1, 0, facing(0.5))).toEqual({ turn: 1, forward: false });
    // Facing north, stick left: turns left.
    expect(steer(-1, 0, facing(0.5)).turn).toBe(-1);
    // Facing east, stick a little up of east: turns left while driving on.
    expect(steer(1, -0.3, facing(16.5))).toEqual({ turn: -1, forward: true });
    // Across north: facing 62, stick up turns right, the short way.
    expect(steer(0, -1, facing(62)).turn).toBe(1);
    // Stick straight down from north: turns on the spot.
    expect(steer(0, 1, facing(0.5)).forward).toBe(false);
  });

  it('settles on the heading the stick points along without hunting', () => {
    // Within a step of the middle it does not start a turn, but a turn under way runs on into the heading.
    expect(steer(0, -1, facing(1.2)).turn).toBe(0);
    expect(steer(0, -1, facing(1.2), -1).turn).toBe(-1);
    expect(steer(0, -1, facing(0.9), -1).turn).toBe(0);
    // A ground vehicle turning at its rate always comes to rest facing the stick.
    for (const rate of [0.2, 0.25, 0.5]) {
      for (const start of [5, 20, 33, 47, 60]) {
        let h = start;
        let turn: -1 | 0 | 1 = 0;
        for (let t = 0; t < 400; t++) {
          turn = steer(-1, -1, facing(h), turn).turn;
          h = (h + turn * rate + 64) % 64;
        }
        expect(Math.floor(h)).toBe(56);
        expect(turn).toBe(0);
      }
    }
  });

  it('lets go of the helicopter turn early enough not to swing past', () => {
    const ONE = 1 << FIXED_SHIFT;
    const RATE = 0xc000, UP = 0x7ae, DOWN = 0x1eb8;
    for (const start of [0, 10, 40]) {
      let h = start * ONE;
      let yaw = 0;
      let turn: -1 | 0 | 1 = 0;
      for (let t = 0; t < 600; t++) {
        turn = steer(1, 0, { heading: h & ANGLE_MASK, yaw }, turn).turn;
        // heli.ts fly(): the turn rate eases towards the key's, faster on the way down.
        const target = turn * RATE;
        const step = (target >= 0 && yaw <= 0) || (target <= 0 && yaw > 0) ? DOWN : UP;
        yaw = target > yaw ? Math.min(target, yaw + step) : Math.max(target, yaw - step);
        h = (h + yaw) & ANGLE_MASK;
      }
      expect(yaw).toBe(0);
      expect(Math.abs((h / ONE) - 16.5)).toBeLessThan(1.5);
    }
  });
});

