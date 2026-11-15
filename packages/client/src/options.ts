// Options > Sound and Options > Controls: the volume sliders and rebinding the vehicle keys. Neither changes how
// the game plays; the bindings themselves and their rules are in keys.ts.

import { dialog, el } from './dialogs.js';
import {
  ACTIONS, ACTION_HINTS, ACTION_LABELS, DEFAULT_BINDINGS, bindings, keyName, rebind, setBindings, type Action, type Bindings, type Half,
} from './keys.js';
import type { Settings, Volume } from './settings.js';

/**
 * The volume sliders. Each change is heard at once through `apply`; Cancel puts the old volume back. Resolves with
 * the new volume, or null if cancelled.
 */
export async function soundDialog(start: Volume, apply: (v: Volume) => void): Promise<Volume | null> {
  const v = { ...start };
  const slider = (label: string, key: 'master' | 'effects' | 'music') => {
    const out = el('output', { class: 'num' }, String(v[key]));
    const input = el('input', { type: 'range', min: '0', max: '100', step: '5', value: String(v[key]) });
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      v[key] = Number(input.value);
      out.textContent = input.value;
      apply({ ...v });
    });
    return el('label', { class: 'field slider' }, el('span', {}, label), input, out);
  };
  const mute = el('input', { type: 'checkbox', checked: v.muted });
  mute.addEventListener('change', () => {
    v.muted = mute.checked;
    apply({ ...v });
  });
  const body = el('div', { class: 'stack' },
    slider('Master', 'master'), slider('Effects', 'effects'), slider('Music', 'music'),
    el('label', { class: 'check' }, mute, 'Mute everything (V in a game)'));
  const r = await dialog('Sound', body, [['Save', 'ok'], ['Cancel', 'cancel']]);
  if (r !== 'ok') {
    apply(start);
    return null;
  }
  return v;
}

/** What settings keep: only the keys that differ from the original layout. */
export function changedKeys(b: Record<Half, Bindings>): Settings['keys'] {
  const out: Settings['keys'] = {};
  for (const half of ['left', 'right'] as const) {
    const diff = Object.fromEntries(ACTIONS.filter((a) => b[half][a] !== DEFAULT_BINDINGS[half][a]).map((a) => [a, b[half][a]]));
    if (Object.keys(diff).length) out[half] = diff;
  }
  return out;
}

/**
 * Config > Controls: every vehicle action for each half of the keyboard. Pressing a key's button and then the new
 * key rebinds it; a key that half already uses swaps over, and a reserved key or one the other half plays with is
 * refused with the reason. Resolves with the keys to keep, or null if cancelled.
 */
export async function controlsDialog(): Promise<Settings['keys'] | null> {
  let b = bindings();
  const message = el('p', { class: 'hint' }, 'Click a key, then press the new one. Esc cancels.');
  const buttons = new Map<string, HTMLButtonElement>();
  const show = () => {
    for (const half of ['left', 'right'] as const) for (const a of ACTIONS) buttons.get(`${half}:${a}`)!.textContent = keyName(b[half][a]);
  };
  let waiting: HTMLButtonElement | null = null;
  const stopWaiting = () => {
    if (!waiting) return;
    waiting.classList.remove('waiting');
    delete waiting.dataset.captureKeys;
    waiting = null;
    show();
  };
  const keyButton = (half: Half, a: Action) => {
    const btn = el('button', { type: 'button', class: 'btn small key' });
    btn.setAttribute('aria-label', `${half === 'left' ? 'Left-hand' : 'Right-hand'} ${ACTION_LABELS[a]}`);
    btn.addEventListener('click', () => {
      stopWaiting();
      waiting = btn;
      btn.dataset.captureKeys = '';
      btn.classList.add('waiting');
      btn.textContent = 'Press a key…';
      message.textContent = `New ${half === 'left' ? 'left' : 'right'}-hand key for ${ACTION_LABELS[a].toLowerCase()}. Esc cancels.`;
    });
    // While waiting this button has the keyboard: the dialog lets keys through to it (data-capture-keys).
    btn.addEventListener('keydown', (e) => {
      if (waiting !== btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        message.textContent = 'Click a key, then press the new one. Esc cancels.';
        return stopWaiting();
      }
      const r = rebind(b, half, a, e.code);
      if (typeof r === 'string') {
        message.textContent = `${r}. Try another key.`;
        return;
      }
      b = r;
      message.textContent = `${ACTION_LABELS[a]} is now ${keyName(e.code)}.`;
      stopWaiting();
    });
    btn.addEventListener('blur', () => {
      if (waiting === btn) stopWaiting();
    });
    buttons.set(`${half}:${a}`, btn);
    return btn;
  };
  const rows = ACTIONS.map((a) => el('tr', {}, el('td', {}, ACTION_LABELS[a], ACTION_HINTS[a] ? el('small', { class: 'hint key-hint' }, ACTION_HINTS[a]) : ''), el('td', {}, keyButton('left', a)), el('td', {}, keyButton('right', a))));
  const reset = el('button', { type: 'button', class: 'btn quiet small' }, 'Original keys');
  reset.addEventListener('click', () => {
    stopWaiting();
    b = { left: { ...DEFAULT_BINDINGS.left }, right: { ...DEFAULT_BINDINGS.right } };
    message.textContent = 'Back to the original layout.';
    show();
  });
  show();
  const body = el('div', { class: 'stack controls' },
    el('div', { class: 'scroll' }, el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Left hand (Brown)'), el('th', {}, 'Right hand (Green)'))),
      el('tbody', {}, ...rows))),
    message,
    el('p', { class: 'hint' }, 'In Training and online either hand works. Shortcuts, chat and the menu keys keep their own keys.'),
    reset);
  const r = await dialog('Controls', body, [['Save', 'ok'], ['Cancel', 'cancel']]);
  if (r !== 'ok') return null;
  const keys = changedKeys(b);
  setBindings(keys);
  return keys;
}
