// What this browser remembers between visits: the original kept these in the registry under
// Software\Silent Software, Inc.\Return Fire (sub_424c80 and the Config dialog). Accounts will hold them on the
// server (the profiles card); until then they live in localStorage, and everything still works without it.

import { DIFFICULTY, clampDifficulty } from '@rfw/sim';
import type { Bindings, Half } from './keys.js';

export interface Settings {
  /** Player names for the Brown (base 1) and Green (base 2) sides, as on the Player Selector. */
  names: [string, string];
  /** The computer's skill in a training game, 1-9. */
  difficulty: number;
  /**
   * Training (one player against the computer, one full-screen view) or Tournament (two players, split screen).
   * Never carried over from a visit or another browser: every match is one player unless two are picked for it.
   */
  players: 1 | 2;
  /** The last level and map picked on the Level Selector. */
  level: number;
  mapId: string;
  /** Swap Sides (Alt+3): which half of the keyboard plays Brown in a two-player game. */
  swapSides: boolean;
  /** How the picture is scaled: fill the window, or whole-number scales only. */
  scale: 'sharp' | 'integer';
  /** Options > Music. */
  music: boolean;
  /** Options > Sound: master, effects and music volume, 0-100, and the mute switch (V). */
  volume: Volume;
  /** Options > Controls: keys the player has changed from the original layout, per half of the keyboard. */
  keys: Partial<Record<Half, Partial<Bindings>>>;
  /** Options > Picture: a subtle CRT look (scanlines and glow) over the picture. */
  crt: boolean;
  /** The last choices on the Teams dialog, for offline games on maps with three or four bases. */
  teams: TeamChoice;
}

/** Teams for an offline game on a map with more than two bases. */
export interface TeamChoice {
  /** Team sizes, largest first ("2,2", "2,1,1"); empty for every base on its own. */
  layout: string;
  /** Extra vehicles for the smaller side. */
  handicap: boolean;
  /** Two Players: both players on one team, where the layout has room. */
  together: boolean;
  /** Two Players: the computer plays the bases neither player has. */
  bots: boolean;
}

export interface Volume {
  master: number;
  effects: number;
  music: number;
  muted: boolean;
}

const KEY = 'rfw.settings';

const DEFAULTS: Settings = {
  names: ['Brown', 'Green'], difficulty: DIFFICULTY.default, players: 1, level: 1, mapId: 'rfmap101',
  swapSides: false, scale: 'sharp', music: true,
  volume: { master: 80, effects: 100, music: 70, muted: false }, keys: {}, crt: true,
  teams: { layout: '', handicap: false, together: false, bots: true },
};

const level = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback);

/** A volume from settings that may be old or hand-edited. */
export function cleanVolume(v: Partial<Volume> | undefined): Volume {
  const d = DEFAULTS.volume;
  return { master: level(v?.master, d.master), effects: level(v?.effects, d.effects), music: level(v?.music, d.music), muted: v?.muted === true };
}

/** A volume (0-100) as a gain: a curve, so the slider's middle sounds like half as loud. */
export function gainOf(percent: number): number {
  return (percent / 100) ** 2;
}

export function loadSettings(): Settings {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    // The start menu before this one kept only the difficulty.
    const old = localStorage.getItem('rfw.difficulty');
    if (old !== null && saved.difficulty === undefined) saved.difficulty = Number(old);
  } catch {
    // Unreadable or unavailable storage starts from the defaults.
  }
  const s = { ...DEFAULTS, ...saved };
  s.difficulty = clampDifficulty(s.difficulty);
  s.names = [String(s.names?.[0] ?? DEFAULTS.names[0]).slice(0, 20), String(s.names?.[1] ?? DEFAULTS.names[1]).slice(0, 20)];
  // Split screen is only for two people at one keyboard who asked for it, so a new visit starts as one player.
  s.players = 1;
  if (s.scale !== 'sharp' && s.scale !== 'integer') s.scale = 'sharp';
  s.music = s.music !== false;
  s.volume = cleanVolume(s.volume);
  s.keys = s.keys && typeof s.keys === 'object' ? s.keys : {};
  s.crt = s.crt !== false;
  s.teams = { layout: typeof s.teams?.layout === 'string' ? s.teams.layout : '', handicap: s.teams?.handicap === true, together: s.teams?.together === true, bots: s.teams?.bots !== false };
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not remembered when storage is unavailable.
  }
}
