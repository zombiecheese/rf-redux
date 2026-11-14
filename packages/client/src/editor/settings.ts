// The Map tab: name, author and description; size; player count; vehicles for the whole map and for each base;
// random mines, the attack drone pool and the music.

import { MAX_DESCRIPTION, MAX_NAME, type VehicleCounts } from '@rfw/sim';
import { el, field } from '../dialogs.js';
import { BASE_CSS, dot } from './canvas.js';
import type { EditorDoc } from './doc.js';

const KINDS: { id: keyof VehicleCounts; label: string; max: number }[] = [
  { id: 'tank', label: 'Tanks', max: 99 }, { id: 'jeep', label: 'Jeeps', max: 99 }, { id: 'asv', label: 'ASVs', max: 99 }, { id: 'heli', label: 'Helis', max: 99 },
];
const DEFAULTS: VehicleCounts = { tank: 3, jeep: 8, asv: 3, heli: 3 };

/** A number box where empty means "use the default". Unlimited is 255, shown as "∞" in the hint. */
function countInput(value: number | null | undefined, placeholder: string, max: number, set: (v: number | null) => void): HTMLInputElement {
  const input = el('input', { type: 'text', inputMode: 'numeric', value: value === null || value === undefined ? '' : value === 255 ? '∞' : String(value), placeholder } as Partial<HTMLInputElement>);
  input.className = 'num';
  input.title = 'Leave empty for the default; ∞ or 255 for unlimited';
  input.addEventListener('change', () => {
    const t = input.value.trim();
    if (!t) return set(null);
    if (t === '∞' || t === '255') return set(255);
    const n = Math.round(Number(t));
    if (!Number.isFinite(n)) {
      input.value = '';
      return set(null);
    }
    const v = Math.min(max, Math.max(0, n));
    input.value = String(v);
    set(v);
  });
  return input;
}

/** edit runs a change as one undo step; refresh redraws the panel (after a resize). */
export function settingsPanel(doc: EditorDoc, edit: (fn: () => boolean) => void, refresh: () => void): HTMLElement {
  const m = doc.meta;
  // Typing in a box is one undo step per box left, not per key.
  const commit = (fn: () => void) => edit(() => {
    fn();
    return true;
  });

  const name = el('input', { type: 'text', value: m.name, maxLength: MAX_NAME });
  name.addEventListener('change', () => commit(() => (m.name = name.value.trim() || 'Untitled')));
  const author = el('input', { type: 'text', value: m.author, maxLength: 40 });
  author.addEventListener('change', () => commit(() => (m.author = author.value.trim())));
  const description = el('textarea', { value: m.description ?? '', maxLength: MAX_DESCRIPTION, rows: 3 });
  description.addEventListener('change', () => commit(() => (m.description = description.value)));

  const w = el('input', { type: 'number', value: String(doc.width), min: '8', max: '128' } as Partial<HTMLInputElement>);
  const h = el('input', { type: 'number', value: String(doc.height), min: '8', max: '128' } as Partial<HTMLInputElement>);
  w.className = h.className = 'num';
  const anchor = el('select', {});
  for (const [v, label] of [['c', 'centre'], ['tl', 'top left'], ['br', 'bottom right']]) anchor.add(new Option(label!, v));
  const fill = el('select', {});
  fill.add(new Option('deep water', '2'));
  fill.add(new Option('land', '3'));
  const resize = el('button', { type: 'button', class: 'btn' }, 'Resize');
  resize.addEventListener('click', () => {
    const nw = Math.min(128, Math.max(8, Math.round(Number(w.value)) || doc.width));
    const nh = Math.min(128, Math.max(8, Math.round(Number(h.value)) || doc.height));
    const dx = anchor.value === 'tl' ? 0 : anchor.value === 'br' ? nw - doc.width : (nw - doc.width) >> 1;
    const dy = anchor.value === 'tl' ? 0 : anchor.value === 'br' ? nh - doc.height : (nh - doc.height) >> 1;
    edit(() => {
      if (nw === doc.width && nh === doc.height) return false;
      doc.resize(nw, nh, dx, dy, Number(fill.value));
      return true;
    });
    refresh();
  });

  const minPlayers = el('select', {});
  const bases = Math.max(1, doc.bases.length);
  for (let n = 1; n <= bases; n++) minPlayers.add(new Option(String(n), String(n), false, n === Math.min(m.players.min, bases)));
  minPlayers.addEventListener('change', () => commit(() => (m.players = { min: Number(minPlayers.value), max: bases })));

  const vehicles = el('table', { class: 'grid vehicles' });
  vehicles.append(el('tr', {}, el('th', {}, ''), ...KINDS.map((k) => el('th', {}, k.label))));
  vehicles.append(el('tr', {}, el('td', {}, 'Every base'), ...KINDS.map((k) => el('td', {},
    countInput(m.settings.vehicles[k.id], String(DEFAULTS[k.id]), k.max, (v) => commit(() => (m.settings.vehicles[k.id] = v)))))));
  doc.bases.forEach((b, i) => {
    vehicles.append(el('tr', {}, el('td', {}, dot(BASE_CSS[i]!), `Base ${i + 1}`),
      ...KINDS.map((k) => el('td', {}, countInput(b.vehicles?.[k.id], '—', k.max, (v) => commit(() => {
        const own = { ...(b.vehicles ?? {}) };
        if (v === null) delete own[k.id];
        else own[k.id] = v;
        b.vehicles = Object.keys(own).length ? own : undefined;
        if (!b.vehicles) delete b.vehicles;
      }))))));
  });

  const mines = countInput(m.settings.randomMines, 'game default', 200, (v) => commit(() => (m.settings.randomMines = v === 255 ? 200 : v)));
  const drones = countInput(m.settings.aiPool, 'by skill', 5, (v) => commit(() => (m.settings.aiPool = v === 255 ? 5 : v)));
  const music = el('input', { type: 'text', value: m.settings.music ?? '', placeholder: "game's choice", maxLength: 40 });
  music.addEventListener('change', () => commit(() => (m.settings.music = music.value.trim() || null)));

  return el('div', { class: 'stack settings' },
    el('fieldset', {}, el('legend', {}, 'Map'), field('Name:', name), field('Author:', author), field('Description:', description)),
    el('fieldset', {}, el('legend', {}, 'Size'),
      el('div', { class: 'row' }, w, '×', h, 'tiles'), field('Keep the map at:', anchor), field('New tiles:', fill), resize),
    el('fieldset', {}, el('legend', {}, 'Players'),
      el('p', {}, `${doc.bases.length} base${doc.bases.length === 1 ? '' : 's'}, so up to ${bases} player${bases === 1 ? '' : 's'}; the computer fills empty bases.`),
      field('At least:', minPlayers)),
    el('fieldset', {}, el('legend', {}, 'Vehicles'), el('p', { class: 'hint' }, 'Empty uses the default shown; a base\'s own count overrides the map\'s.'), vehicles),
    el('fieldset', {}, el('legend', {}, 'Hazards and music'),
      field('Random mines:', mines), field('Attack drones:', drones), field('Music track:', music)),
  );
}
