// Help that comes to the editor's user rather than waiting to be asked: the list of keys (in Help, and as a cheat
// sheet while K is held), the getting-started checklist over the map, and the one-click fixes on the Problems tab.

import { type MapPoint, type MapProblem } from '@rfw/sim';
import { el } from '../dialogs.js';
import type { EditorDoc } from './doc.js';
import { GROUNDS, paintTiles, square, type ToolContext } from './tools.js';

/** Every key the editor takes, by what it is for. Help and the cheat sheet both show this. */
export const KEY_SECTIONS: [string, [string, string][]][] = [
  ['Tools and painting', [
    ['Pick a tool', 'Click it, or press its letter'], ['Brush, line, box, fill', 'The Brush buttons under the tools'],
    ['Take a tile or building as the brush', 'Alt + click'], ['Undo / redo', 'Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z)'],
    ['Select all / clear the selection', 'Ctrl+A / Esc'], ['Delete the selection', 'Delete or Backspace'],
    ['Copy, cut, paste', 'Ctrl+C, Ctrl+X, Ctrl+V (R turns, H and V mirror, Esc drops)'],
  ]],
  ['Looking at the map', [
    ['Preview: Classic, Modern or Night', 'V, or the Preview switch at the top'], ['Top down / game camera', 'Tab'],
    ['Move the view', 'Right-drag, Space + drag, or the arrow keys'], ['Zoom', 'Mouse wheel, + and -; 0 fits the map'],
    ['Jump to a place', 'Click or drag on the minimap'], ['Grid on or off', 'G'],
    ['Next / previous problem', 'J / Shift+J'], ['This list, while held', 'K'],
  ]],
  ['Files and playing', [
    ['New map', 'Ctrl+Alt+N'], ['Open a draft or an original map', 'Ctrl+O'], ['Export as a file', 'Ctrl+E'],
    ['Save the draft', 'Ctrl+S (drafts also save by themselves)'], ['Save to your library on the server', 'Ctrl+Shift+S'],
    ['Shared maps and your library', 'Ctrl+Shift+O'], ['Test play', 'P, or Test Play at the top'],
    ['In test play', "The game's keys (its Help lists them); P pauses, Esc comes back"], ['Help', '?'],
  ]],
];

export function keyTable(rows: [string, string][]): HTMLTableElement {
  return el('table', { class: 'grid help' }, el('tbody', {}, ...rows.map(([x, y]) => el('tr', {}, el('td', {}, x), el('td', {}, y)))));
}

/** The cheat sheet: every key at a glance, over the map while K is held down. */
export class CheatSheet {
  readonly root = el('div', { class: 'ed-keys', hidden: true },
    el('div', { class: 'ed-keys-head' }, el('b', {}, 'Keys'), el('span', {}, 'Let go of K to close')),
    el('div', { class: 'ed-keys-cols' }, ...KEY_SECTIONS.map(([title, rows]) => el('div', {}, el('div', { class: 'caption' }, title), keyTable(rows)))));

  constructor() {
    addEventListener('keyup', (e) => {
      if (e.code === 'KeyK') this.root.hidden = true;
    });
    addEventListener('blur', () => (this.root.hidden = true));
  }

  show(): void {
    this.root.hidden = false;
  }
}

// ---- Getting started ---------------------------------------------------------------------------------------------

const GUIDE_KEY = 'rfw-editor-guide';
const TESTED_KEY = 'rfw-editor-tested';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
}

/** Drafts that have been test played (their ids), so the checklist's last step stays ticked. */
export function markTested(draftId: string): void {
  const ids = new Set((read(TESTED_KEY) ?? '').split(',').filter(Boolean));
  ids.add(draftId);
  write(TESTED_KEY, [...ids].slice(-200).join(','));
}

function tested(draftId: string): boolean {
  return (read(TESTED_KEY) ?? '').split(',').includes(draftId);
}

/**
 * The steps from an empty map to one that can be played, ticked off as the map gets there. It shows over the
 * map until every step is done; × hides it, and Help > Getting Started brings it back.
 */
export class Checklist {
  readonly root = el('div', { class: 'ed-guide', hidden: true });
  private readonly list = el('ol', {});
  private key = '';

  constructor(private readonly onStep: (step: string) => void) {
    const close = el('button', { type: 'button', class: 'ed-guide-close', title: 'Hide the checklist (Help > Getting Started shows it again)', ariaLabel: 'Hide' }, '×');
    close.addEventListener('click', () => {
      write(GUIDE_KEY, 'off');
      this.root.hidden = true;
    });
    this.root.append(el('div', { class: 'ed-guide-head' }, el('b', {}, 'Getting started'), close), this.list);
  }

  get off(): boolean {
    return read(GUIDE_KEY) === 'off';
  }

  /** Shows it again after it was hidden. */
  turnOn(): void {
    write(GUIDE_KEY, 'on');
    this.key = '';
  }

  update(doc: EditorDoc, problems: readonly MapProblem[], draftId: string, landTiles: number): void {
    const errors = problems.filter((p) => p.level === 'error').length;
    const steps: { id: string; text: string; done: boolean }[] = [
      { id: 'land', text: 'Paint some land', done: landTiles > 0 },
      { id: 'start', text: 'Place two or more base starts', done: doc.bases.length >= 2 },
      { id: 'flag', text: 'Give each base a flag site', done: doc.bases.length > 0 && doc.bases.every((b) => b.flagSites.length > 0) },
      { id: 'problems', text: errors ? `Fix the ${errors === 1 ? 'error' : `${errors} errors`} in Problems` : 'No errors in Problems', done: doc.bases.length > 0 && !errors },
      { id: 'test', text: 'Test play it (P)', done: tested(draftId) },
    ];
    const all = steps.every((s) => s.done);
    const key = steps.map((s) => `${s.id}${s.done}${s.text}`).join('|') + this.off;
    if (key === this.key) return;
    this.key = key;
    this.root.hidden = all || this.off;
    const next = steps.find((s) => !s.done);
    this.list.replaceChildren(...steps.map((s) => {
      const b = el('button', { type: 'button', class: 'ed-step' + (s.done ? ' done' : '') + (s === next ? ' next' : '') },
        el('span', { class: 'tick' }, s.done ? '✓' : ''), s.text);
      b.addEventListener('click', () => this.onStep(s.id));
      return el('li', {}, b);
    }));
  }
}

// ---- One-click fixes ---------------------------------------------------------------------------------------------

/** A fix for a problem: a button label and the edit (returns whether it changed anything), or a tool to pick. */
export type Fix = { label: string; edit: () => boolean } | { label: string; tool: 'start' | 'flag'; base: number };

/** The fix for a problem, where there is an obvious one. ctx edits the map without symmetry. */
export function fixFor(p: MapProblem, doc: EditorDoc, ctx: ToolContext): Fix | null {
  const base = p.base ?? 0;
  const b = doc.bases[base];
  const at = p.tiles[0];
  const clearAt = (t: MapPoint) => doc.objects.delete(doc.index(t.x, t.y));
  const dropSite = (t: MapPoint) => {
    const k = b?.flagSites.findIndex((f) => f.x === t.x && f.y === t.y) ?? -1;
    if (k < 0) return false;
    b!.flagSites.splice(k, 1);
    return true;
  };
  switch (p.code) {
    case 'no-bases':
      return { label: 'Place a base', tool: 'start', base: 0 };
    case 'no-flag':
      return { label: 'Place a flag site', tool: 'flag', base };
    case 'lift-blocked':
      return b ? { label: 'Remove the building', edit: () => clearAt(b.start) } : null;
    case 'lift-water':
      return b ? { label: 'Put land under it', edit: () => paintTiles(ctx, square(b.start, 3), GROUNDS.land) } : null;
    case 'lift-boxed':
      return b ? {
        label: 'Clear round it', edit: () => {
          const round = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: b.start.x + dx!, y: b.start.y + dy! })).filter((t) => doc.inside(t.x, t.y));
          let changed = false;
          for (const t of round) changed = clearAt(t) || changed;
          return paintTiles(ctx, square(b.start, 3), GROUNDS.land) || changed;
        },
      } : null;
    case 'no-jeeps':
      return {
        label: 'Use the default jeeps', edit: () => {
          let changed = false;
          if (doc.meta.settings.vehicles.jeep === 0) {
            doc.meta.settings.vehicles.jeep = null;
            changed = true;
          }
          if (b?.vehicles?.jeep === 0) {
            delete b.vehicles.jeep;
            if (!Object.keys(b.vehicles).length) delete b.vehicles;
            changed = true;
          }
          return changed;
        },
      };
    case 'flag-covers':
      return at ? { label: 'Remove the building', edit: () => clearAt(at) } : null;
    case 'flag-twice':
    case 'flag-on-lift':
    case 'flag-water':
    case 'flag-shared':
      return at ? { label: 'Remove this flag site', edit: () => dropSite(at) } : null;
    default:
      return null;
  }
}
