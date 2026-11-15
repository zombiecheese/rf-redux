// Test play: a solo match on the map being edited, against bots at a chosen skill, in the game's own display and
// in the view the editor is previewing (classic, or modern by day or at night). Esc (or the match ending) comes
// back to the editor where it was.

import { DIFFICULTY, MAX_BASES, clampDifficulty, type RfwMap } from '@rfw/sim';
import type { GameData } from '../assets.js';
import { dialog, el, field } from '../dialogs.js';
import { Display } from '../display.js';
import { Game } from '../game.js';
import { setBindings } from '../keys.js';
import { Music } from '../music/music.js';
import { gainOf, loadSettings } from '../settings.js';
import { Sound } from '../sound.js';

let sound: Sound | null = null;
let music: Music | null = null;
const SKILL = 'rfw-editor-skill';

/** How the test match is drawn. */
export interface TestLook {
  visuals: 'retro' | 'modern';
  lighting: 'day' | 'night';
}

/** Asks how to play, then runs the match; started is called as it begins. */
export async function testPlay(data: GameData, map: RfwMap, started: () => void, look: TestLook = { visuals: 'retro', lighting: 'day' }): Promise<void> {
  const base = el('select', {});
  map.bases.forEach((_, i) => base.add(new Option(`Base ${i + 1}`, String(i))));
  const bots = el('input', { type: 'checkbox', checked: true });
  const skill = el('select', {});
  let saved: number = DIFFICULTY.default;
  try {
    saved = clampDifficulty(Number(localStorage.getItem(SKILL) ?? DIFFICULTY.default));
  } catch {
    // Use the default.
  }
  for (let d = DIFFICULTY.min; d <= DIFFICULTY.max; d++) skill.add(new Option(String(d), String(d), false, d === saved));
  const others = map.bases.length - 1;
  const body = el('div', { class: 'stack' },
    field('Play from:', base),
    el('label', { class: 'check' }, bots, others ? `Computer plays the other ${others === 1 ? 'base' : `${others} bases`}` : 'No other bases to play against'),
    field('Computer skill:', skill),
    el('p', { class: 'hint' }, `Drawn as previewed: ${look.visuals === 'retro' ? 'the classic view' : look.lighting === 'night' ? 'the modern view, at night' : 'the modern view'}. The game's keys (H in the game lists them). P pauses, Esc comes back to the editor.`));
  if (map.bases.length > MAX_BASES) return;
  const r = await dialog('Test Play', body, [['Play', 'ok'], ['Cancel', 'cancel']]);
  if (!r) return;
  try {
    localStorage.setItem(SKILL, skill.value);
  } catch {
    // Not remembered.
  }

  started();
  sound ??= new Sound();
  void sound.unlock();
  // The game's Options > Music setting holds here too.
  const prefs = loadSettings();
  music ??= new Music(prefs.music);
  void music.unlock();
  // The game's keys, volume and picture settings hold here too.
  setBindings(prefs.keys);
  const master = prefs.volume.muted ? 0 : gainOf(prefs.volume.master);
  sound.setVolume(master * gainOf(prefs.volume.effects));
  music.setVolume(master * gainOf(prefs.volume.music));
  const display = new Display('sharp');
  display.canvas.classList.add('testplay');
  const names = map.bases.map((_, i) => `Base ${i + 1}`);
  const game = new Game({
    assets: { ...data, map }, display, sound, music, seed: (Date.now() % 0x7fffffff) | 0 || 1, players: 1, difficulty: clampDifficulty(Number(skill.value)),
    names, swapSides: false, bots: bots.checked, homeBase: Number(base.value), handheld: false,
    visuals: () => look.visuals, lighting: () => look.lighting,
  });
  // The editor's own keys wait (main.ts); Esc ends the test and P pauses, as in the game.
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') game.stop();
    else if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) game.pause(!game.paused);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  addEventListener('keydown', onKey, { capture: true });
  // A browser can leave the audio suspended until a later key press or tap (main.ts).
  const wake = () => {
    void sound?.unlock();
    void music?.unlock();
  };
  const wakeOn = ['keydown', 'pointerdown', 'pointerup'] as const;
  for (const type of wakeOn) addEventListener(type, wake, { capture: true, passive: true });
  try {
    const outcome = await game.done;
    if (outcome) {
      const text = outcome.winnerBase === null ? 'The match was a draw.' : `${names[outcome.winnerBase]} won after ${Math.round(outcome.ms / 1000)} seconds.`;
      await dialog('Test Play', el('p', {}, text), [['Back to the Editor', 'ok']]);
    }
  } finally {
    removeEventListener('keydown', onKey, { capture: true });
    for (const type of wakeOn) removeEventListener(type, wake, { capture: true });
    display.remove();
    music.quiet();
  }
}
