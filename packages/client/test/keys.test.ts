import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTIONS, ARROWS, CONTROL_ROWS, DEFAULT_BINDINGS, MENU_KEYS, ONLINE_KEYS, REPLAY_KEYS, SHORTCUTS, SOLO, WASD, activeControls, bindings, playKeys, rebind,
  reservedKey, setBindings, shortcutFor, touchKey,
} from '../src/keys.js';
import { TOUCH_BUTTONS } from '../src/touch.js';

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const codes = (c: typeof WASD) => Object.values(c).flat(2) as string[];

describe('key bindings', () => {
  it('gives the two halves of the keyboard no key in common, and no key twice', () => {
    const left = codes(WASD);
    const right = codes(ARROWS);
    expect(new Set(left).size).toBe(left.length);
    expect(new Set(right).size).toBe(right.length);
    expect(left.filter((k) => right.includes(k))).toEqual([]);
  });

  it('lets a solo player use either half', () => {
    expect(new Set(codes(SOLO))).toEqual(playKeys());
  });

  it('keeps chat and the scoreboard off the play keys', () => {
    const play = playKeys();
    expect(play.has(ONLINE_KEYS.chat)).toBe(false);
    expect(play.has(ONLINE_KEYS.scoreboard)).toBe(false);
    // The game must not open the chat line on anything but the chat key.
    expect(source('game.ts')).not.toMatch(/'Enter'/);
  });

  it('keeps every shortcut off the play keys and the chat key, and uses no function keys', () => {
    const play = playKeys();
    for (const k of SHORTCUTS) {
      expect(k.code, k.id).not.toMatch(/^F\d+$/);
      expect(k.code, k.id).not.toBe(ONLINE_KEYS.chat);
      expect(k.code, k.id).not.toBe(ONLINE_KEYS.scoreboard);
      // A shortcut on a play key needs Alt, which the game never reads.
      if (play.has(k.code)) expect(k.alt, k.id).toBe(true);
    }
    expect(source('game.ts')).toMatch(/if \(e\.ctrlKey \|\| e\.altKey \|\| e\.metaKey\) return;/);
    expect(new Set(SHORTCUTS.map((k) => `${k.alt}${k.code}`)).size).toBe(SHORTCUTS.length);
  });

  it('finds the shortcut for a key press only with the right modifiers', () => {
    const press = (code: string, mods: Partial<KeyboardEvent> = {}) =>
      shortcutFor({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods } as KeyboardEvent);
    expect(press('KeyP')).toBe('pause');
    expect(press('KeyP', { shiftKey: true })).toBe('pause');
    expect(press('KeyP', { ctrlKey: true })).toBeNull();
    expect(press('KeyR')).toBeNull();
    expect(press('KeyR', { altKey: true })).toBe('restart');
    expect(press('Enter')).toBeNull();
    expect(press('F1')).toBeNull();
  });

  it('never lets a player pause an online match', () => {
    expect(source('game.ts')).toMatch(/pause\(on: boolean\): void \{[^}]*if \(this\.o\.online\) return;/);
    expect(source('main.ts')).toMatch(/async function togglePause\(\)[^]*?if \(game\.online\) return/);
  });

  it('uses no function keys anywhere in the client', () => {
    for (const f of ['main.ts', 'menu.ts', 'game.ts', 'touch.ts', 'dialogs.ts', 'editor/main.ts', 'editor/testplay.ts']) {
      expect(source(f), f).not.toMatch(/(case |=== |, )'F\d+'/);
    }
  });

  it('lists every vehicle control in Help Topics', () => {
    const shown = new Set(CONTROL_ROWS.flatMap(([, keys]) => [...keys(WASD), ...keys(ARROWS)]));
    expect(shown).toEqual(playKeys());
  });

  it('lists the menu keys in Help Topics, and the menu reads no others', () => {
    for (const k of Object.keys(MENU_KEYS)) expect(source('dialogs.ts'), k).toMatch(new RegExp(`MENU_KEYS\\.${k}\\b`));
    // Besides MENU_KEYS the menu only lets Tab, Enter and Space do what they do on any page.
    expect(source('menu.ts')).not.toMatch(/'(Arrow\w+|Escape|Key\w|Digit\d|Backspace)'/);
  });

  it('presses only bound keys from the touch controls', () => {
    const touch = TOUCH_BUTTONS.flatMap((b) => b.press);
    expect(touch.length).toBeGreaterThan(8);
    const extras = ['pause', 'chat', 'scores', 'follow1', 'follow2', 'follow3', 'follow4'];
    for (const a of touch) expect((ACTIONS as readonly string[]).includes(a) || extras.includes(a), a).toBe(true);
    for (const a of ['up', 'down', 'left', 'right']) expect(source('touch.ts')).toContain(`codeFor('${a}')`);
  });

  it('lists the replay keys in Help Topics', () => {
    for (const k of Object.keys(REPLAY_KEYS)) expect(source('dialogs.ts'), k).toMatch(new RegExp(`r\\.${k}\\b`));
  });
});

describe('rebinding', () => {
  const fresh = () => ({ left: { ...DEFAULT_BINDINGS.left }, right: { ...DEFAULT_BINDINGS.right } });

  it('starts from the original layout', () => {
    setBindings({});
    expect(bindings()).toEqual(DEFAULT_BINDINGS);
    expect(activeControls().left).toEqual(WASD);
    expect(activeControls().right).toEqual(ARROWS);
  });

  it('gives an action a new key, and swaps with the same half', () => {
    const b = rebind(fresh(), 'left', 'fire', 'KeyG');
    expect(typeof b).toBe('object');
    if (typeof b === 'string') return;
    expect(b.left.fire).toBe('KeyG');
    const swapped = rebind(b, 'left', 'up', 'KeyS');
    if (typeof swapped === 'string') throw new Error(swapped);
    expect(swapped.left.up).toBe('KeyS');
    expect(swapped.left.down).toBe('KeyW');
  });

  it('refuses the other half\'s keys, shortcuts, chat, menu and function keys', () => {
    expect(rebind(fresh(), 'left', 'fire', 'Enter')).toMatch(/right-hand fire/);
    for (const s of SHORTCUTS.filter((x) => !x.alt)) expect(reservedKey(s.code), s.id).not.toBeNull();
    for (const code of [ONLINE_KEYS.chat, ONLINE_KEYS.scoreboard, 'Escape', 'F1', 'F12', 'ControlLeft', 'AltRight', 'MetaLeft']) {
      expect(rebind(fresh(), 'right', 'dock', code), code).toEqual(expect.any(String));
    }
  });

  it('keeps every rule the defaults keep, whatever was saved', () => {
    // Saved settings may clash or be hand-edited: what cannot be bound falls back to the original key.
    setBindings({ left: { fire: 'Enter', up: 'KeyT', dock: 'KeyI', fire3: 'Numpad5' }, right: { fire: 'KeyH' } });
    const b = bindings();
    expect(b.left.fire).toBe('Space');
    expect(b.left.up).toBe('KeyW');
    expect(b.left.dock).toBe('KeyI');
    expect(b.left.fire3).toBe('Numpad5');
    expect(b.right.fire).toBe('Enter');
    const left = Object.values(b.left);
    const right = Object.values(b.right);
    expect(new Set([...left, ...right]).size).toBe(left.length + right.length);
    for (const k of playKeys()) expect(reservedKey(k), k).toBeNull();
    expect(touchKey('dock')).toBe('KeyI');
    expect(new Set(Object.values(activeControls().solo).flat(2))).toEqual(playKeys());
    setBindings({});
  });
});
