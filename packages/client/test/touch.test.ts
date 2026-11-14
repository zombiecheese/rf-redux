import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/keys.js';
import { STICK_MODES, TOUCH_BUTTONS, touchModeFor, type TouchMode } from '../src/touch.js';

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
});
