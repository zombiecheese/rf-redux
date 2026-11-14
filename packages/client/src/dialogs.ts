// The front end's dialogs: Player Selector, Level Selector, Hall of Fame, Help, About and the exit question, plus the
// Windows 95 menu bar the level editor keeps (RFireEng.dll MENU 101). They are DOM elements drawn over the game
// picture, so they stay sharp at any window size: the game page dresses them as modern panels (ui.css), the editor
// as the original's Win95 controls (w95.css).

import { DIFFICULTY, clampDifficulty, type RfwMap } from '@rfw/sim';
import { artSprites, loadCommon, type MapEntry } from './assets.js';
import { CONTROL_ROWS, MENU_KEYS, ONLINE_KEYS, REPLAY_KEYS, SHORTCUTS, activeControls, keyName, shortcutName } from './keys.js';
import { MapPreview } from './mappreview.js';
import { formatTime, type ScoreMode, type ScoreTable } from './scores.js';
import { layoutsFor, teamsForLayout } from '@rfw/net';
import type { Settings, TeamChoice } from './settings.js';
import { modernAvailable } from './modern/layout.js';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  e.append(...children);
  return e;
}

// ---- Menu bar ---------------------------------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  /** The shortcut shown on the right, as the original listed it. */
  key?: string;
  action?: () => void;
  checked?: () => boolean;
  enabled?: () => boolean;
  items?: MenuItem[];
}

/** The level editor's menu bar, opened by click, closed by Esc or a click elsewhere. */
export class Menubar {
  readonly root = el('nav', { class: 'w95 menubar', role: 'menubar' } as Partial<HTMLElement>);
  private open: HTMLElement | null = null;

  constructor(menus: { label: string; items: MenuItem[] }[]) {
    for (const m of menus) {
      const title = el('button', { class: 'menutitle', type: 'button' }, m.label);
      const wrap = el('div', { class: 'menu' }, title);
      title.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.open === wrap) this.close();
        else this.show(wrap, m.items);
      });
      title.addEventListener('pointerenter', () => {
        if (this.open && this.open !== wrap) this.show(wrap, m.items);
      });
      this.root.append(wrap);
    }
    addEventListener('pointerdown', (e) => {
      if (this.open && !this.root.contains(e.target as Node)) this.close();
    });
    addEventListener('keydown', (e) => {
      if (this.open && e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
    }, { capture: true });
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** Opens the first menu (M). */
  focus(): void {
    const first = this.root.querySelector<HTMLElement>('.menutitle');
    first?.dispatchEvent(new PointerEvent('pointerdown'));
  }

  private show(wrap: HTMLElement, items: MenuItem[]): void {
    this.close();
    this.open = wrap;
    wrap.classList.add('open');
    wrap.append(this.list(items));
    document.body.classList.add('menu-open');
  }

  private list(items: MenuItem[]): HTMLElement {
    const ul = el('div', { class: 'w95 raised dropdown', role: 'menu' } as Partial<HTMLElement>);
    for (const it of items) {
      if (it.label === '-') {
        ul.append(el('hr'));
        continue;
      }
      const enabled = it.enabled?.() ?? true;
      const b = el('button', { type: 'button', class: 'item', disabled: !enabled },
        el('span', { class: 'check' }, it.checked?.() ? '✓' : ''), el('span', { class: 'label' }, it.label),
        el('span', { class: 'key' }, it.items ? '▸' : it.key ?? ''));
      if (it.items) {
        const sub = el('div', { class: 'sub' }, b);
        b.addEventListener('pointerenter', () => {
          ul.querySelectorAll('.sub > .dropdown').forEach((d) => d.remove());
          sub.append(this.list(it.items!));
        });
        b.addEventListener('click', () => b.dispatchEvent(new PointerEvent('pointerenter')));
        ul.append(sub);
      } else {
        b.addEventListener('pointerenter', () => ul.querySelectorAll('.sub > .dropdown').forEach((d) => d.remove()));
        b.addEventListener('click', () => {
          this.close();
          it.action?.();
        });
        ul.append(b);
      }
    }
    return ul;
  }

  close(): void {
    if (!this.open) return;
    this.open.classList.remove('open');
    this.open.querySelector('.dropdown')?.remove();
    this.open = null;
    document.body.classList.remove('menu-open');
  }
}

// ---- Dialogs ----------------------------------------------------------------------------------------------------

/**
 * The look of the dialogs: the Windows 95 controls (w95.css), which the level editor keeps, or the game's modern
 * panels (ui.css), which the game page picks with modernUi().
 */
let skin = 'w95 raised';

export function modernUi(): void {
  skin = 'ui';
}

/** The class a window-like panel takes in the current look. */
export function skinClass(): string {
  return skin;
}

/** Ends the dialog around a node with a value, as its buttons do: for choices inside the body (a lobby's Join). */
export function finish(node: Element, value: string): void {
  node.dispatchEvent(new CustomEvent('dialog-done', { detail: value, bubbles: true }));
}

/** True while a dialog is up; the game's keys and the shortcuts wait. */
export function dialogOpen(): boolean {
  // The online lobby window is a window too, but not modal: the menus and shortcuts still work under it.
  return document.querySelector('.dialog-layer:not(.lobby-layer)') !== null;
}

/**
 * A modal dialog window. Resolves with the pressed button's value, or null for Cancel, Esc or the close box.
 * Enter presses the first button.
 */
export function dialog(title: string, body: HTMLElement, buttons: [string, string][]): Promise<string | null> {
  return new Promise((resolve) => {
    const close = el('button', { type: 'button', class: 'close', ariaLabel: 'Close' }, '×');
    const row = el('div', { class: 'buttons' });
    const win = el('div', { class: `${skin} window`, role: 'dialog' } as Partial<HTMLElement>,
      el('div', { class: 'titlebar' }, el('span', {}, title), close), el('div', { class: 'body' }, body, row));
    win.setAttribute('aria-label', title);
    const layer = el('div', { class: 'dialog-layer' }, win);
    const done = (v: string | null) => {
      removeEventListener('keydown', onKey, { capture: true });
      layer.remove();
      resolve(v === 'cancel' ? null : v);
    };
    win.addEventListener('dialog-done', (e) => done((e as CustomEvent<string>).detail));
    buttons.forEach(([label, value], i) => {
      const b = el('button', { type: 'button', class: 'btn' + (i === 0 ? ' default' : '') + (value === 'cancel' ? ' quiet' : '') }, label);
      b.addEventListener('click', () => done(value));
      row.append(b);
    });
    close.addEventListener('click', () => done(null));
    const onKey = (e: KeyboardEvent) => {
      // A control waiting for a key (Options > Controls) takes every key itself, Esc and Enter included.
      if (e.target instanceof HTMLElement && e.target.closest('[data-capture-keys]') && win.contains(e.target)) return;
      // The dialog has the keyboard: nothing reaches the game or the shortcuts while it is up.
      e.stopImmediatePropagation();
      if (e.code === 'Escape') {
        e.preventDefault();
        done(null);
      } else if (e.code === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        done(buttons[0]![1]);
      }
    };
    addEventListener('keydown', onKey, { capture: true });
    document.body.append(layer);
    (win.querySelector<HTMLElement>('input:checked, input[type=text], .btn.default') ?? win).focus();
  });
}

export function radio(name: string, label: string, checked: boolean, value: string): HTMLLabelElement {
  return el('label', { class: 'radio' }, el('input', { type: 'radio', name, value, checked }), label);
}

export function field(label: string, input: HTMLElement): HTMLLabelElement {
  return el('label', { class: 'field' }, el('span', {}, label), input);
}

const PREVIEWS = {
  retro: new URL('./previews/classic.jpg', import.meta.url).href,
  modern: new URL('./previews/modern.jpg', import.meta.url).href,
};

export interface ViewChoice {
  value: string;
  label: string;
  hint: string;
  /** A picture of the view; a choice without one shows both. */
  image?: 'retro' | 'modern';
}

/** The views a player picks from: classic pixels or the modern 3D view, each with a picture of it in play. */
export const VIEW_CHOICES: ViewChoice[] = [
  { value: 'retro', label: 'Classic', hint: 'The original pixel look', image: 'retro' },
  { value: 'modern', label: 'Modern', hint: '3D drone feed at 720p', image: 'modern' },
];

/**
 * Cards to pick a view from, each with its preview. The element's value is the picked choice; it sends change. A
 * browser without WebGL cannot show Modern, so for the player's own view (local) that card is greyed out.
 */
export function viewPicker(value: string, choices: readonly ViewChoice[] = VIEW_CHOICES, local = true): HTMLDivElement & { value: string } {
  const root = el('div', { class: 'view-picker' }) as HTMLDivElement & { value: string };
  root.setAttribute('role', 'radiogroup');
  root.value = value;
  const cards = choices.map((c) => {
    const off = local && c.value === 'modern' && !modernAvailable();
    const pic = c.image
      ? el('img', { src: PREVIEWS[c.image], alt: `${c.label} view`, loading: 'lazy' })
      : el('span', { class: 'view-both' }, el('img', { src: PREVIEWS.retro, alt: '' }), el('img', { src: PREVIEWS.modern, alt: '' }));
    const card = el('button', { type: 'button', class: 'view-card', disabled: off, title: off ? 'This browser cannot show the modern view (no WebGL)' : c.hint },
      pic, el('strong', {}, c.label), el('small', {}, off ? 'Needs WebGL' : c.hint));
    card.setAttribute('role', 'radio');
    card.addEventListener('click', () => {
      root.value = c.value;
      sync();
      root.dispatchEvent(new Event('change'));
    });
    return { c, card };
  });
  const sync = () => {
    for (const { c, card } of cards) {
      card.classList.toggle('picked', c.value === root.value);
      card.setAttribute('aria-checked', String(c.value === root.value));
    }
  };
  sync();
  root.append(...cards.map((x) => x.card));
  return root;
}

/**
 * Player Selector (N, New Game): Training (one player against the computer) or Split Screen (two players at one
 * keyboard), the Brown and Green names, the difficulty, the time of day and the view. Phones and tablets play Training
 * only. fixed keeps s.players and hides the choice (Local Play > Training, Local Play > Split Screen): one player gets
 * the single full-screen view, never the split screen.
 */
export async function playerSelector(s: Settings, handheld: boolean, fixed = false): Promise<Settings | null> {
  // Laid out like an online lobby's match settings: game, players, difficulty and time of day, then the view.
  const seg = (name: string, options: [string, string][], value: string) =>
    el('div', { class: 'segmented', role: 'radiogroup' } as Partial<HTMLDivElement>, ...options.map(([v, label]) => radio(name, label, v === value, v)));
  const checked = (g: HTMLElement) => g.querySelector<HTMLInputElement>('input:checked')?.value;
  const mode = seg('mode', handheld ? [['1', 'Training']] : [['1', 'Training'], ['2', 'Split Screen']], String(s.players));
  const modeRow = field('Game:', mode);
  modeRow.hidden = fixed || handheld;
  const brown = el('input', { type: 'text', value: s.names[0], maxLength: 20, ariaLabel: 'Brown' });
  const green = el('input', { type: 'text', value: s.names[1], maxLength: 20, ariaLabel: 'Green' });
  const skill = el('select', {});
  for (let d = DIFFICULTY.min; d <= DIFFICULTY.max; d++) skill.add(new Option(String(d), String(d), false, d === s.difficulty));
  skill.title = 'The computer players\' skill';
  const greenRow = field('Green:', green);
  const skillRow = field('Difficulty:', skill);
  // Day or night is part of the game, like the difficulty (the modern view draws the night).
  const time = seg('time', [['day', 'Day'], ['night', 'Night']], s.lighting === 'night' ? 'night' : 'day');
  // The view: classic or modern, with a picture of each. Options > View > Visuals still switches it at any time.
  const view = viewPicker(s.visuals === 'modern' && modernAvailable() ? 'modern' : 'retro');
  const body = el('div', { class: 'match-setup' }, modeRow, field('Brown:', brown), greenRow, skillRow, field('Time of day:', time),
    el('fieldset', { class: 'view-set' }, el('legend', {}, 'View'), view));
  const sync = () => {
    const two = checked(mode) === '2';
    skillRow.hidden = two;
    greenRow.querySelector('span')!.textContent = two ? 'Green:' : 'Computer:';
  };
  mode.addEventListener('change', sync);
  sync();
  const r = await dialog('Player Selector', body, [['OK', 'ok'], ['Cancel', 'cancel']]);
  if (!r) return null;
  const players = handheld ? 1 : fixed ? s.players : (Number(checked(mode)) as 1 | 2) || 1;
  return {
    ...s, players,
    visuals: view.value === 'modern' ? 'modern' : 'retro',
    lighting: checked(time) === 'night' ? 'night' : 'day',
    names: [brown.value.trim() || 'Brown', green.value.trim() || 'Green'],
    difficulty: clampDifficulty(Number(skill.value)),
  };
}

/**
 * The team of each seat for a choice on the Teams dialog: seats are the players' bases first, then the rest. Seats
 * are dealt to teams in turn, so two players start on opposite sides unless they asked to play together.
 */
export function teamsFor(choice: TeamChoice, bases: number, players: 1 | 2): number[] | undefined {
  const sizes = choice.layout.split(',').map(Number).filter((n) => n > 0);
  if (sizes.length < 2 || sizes.reduce((a, b) => a + b, 0) !== bases) return undefined;
  const teams = teamsForLayout(sizes);
  const mate = teams.findIndex((t, i) => i > 1 && t === teams[0]);
  if (players === 2 && choice.together && mate > 0) [teams[1], teams[mate]] = [teams[mate]!, teams[1]!];
  return teams;
}

/**
 * Teams, for an offline game on a map with three or four bases: the team layout (every base is played), extra
 * vehicles for the smaller side, and with two players whether they share a team and whether the computer plays the
 * other bases.
 */
export async function teamSelector(last: TeamChoice, bases: number, players: 1 | 2): Promise<TeamChoice | null> {
  const layouts = layoutsFor(bases).filter((l) => l.teams.reduce((a, b) => a + b, 0) === bases);
  const layout = el('select', {});
  for (const l of layouts) {
    const all = l.teams.every((n) => n === 1);
    layout.add(new Option(all ? 'Everyone for themselves' : l.name, all ? '' : l.teams.join(','), false, (all ? '' : l.teams.join(',')) === last.layout));
  }
  const handicap = el('input', { type: 'checkbox', checked: last.handicap });
  const together = el('input', { type: 'checkbox', checked: last.together });
  const bots = el('input', { type: 'checkbox', checked: last.bots });
  const handicapRow = el('label', { class: 'check' }, handicap, 'Handicap for the smaller side');
  const togetherRow = el('label', { class: 'check' }, together, 'Both players on one team');
  const botsRow = el('label', { class: 'check' }, bots, 'The computer plays the other bases');
  togetherRow.hidden = botsRow.hidden = players === 1;
  const sync = () => {
    const sizes = layout.value.split(',').map(Number).filter((n) => n > 0);
    handicap.disabled = new Set(sizes).size < 2;
    together.disabled = !sizes.some((n) => n > 1);
  };
  layout.addEventListener('change', sync);
  sync();
  const body = el('div', { class: 'stack' }, field('Teams:', layout), handicapRow, togetherRow, botsRow);
  const r = await dialog('Teams', body, [['OK', 'ok'], ['Cancel', 'cancel']]);
  if (!r) return null;
  return { layout: layout.value, handicap: handicap.checked && !handicap.disabled, together: together.checked && !together.disabled, bots: bots.checked };
}

/**
 * Level Selector: Level 1-9 (the original's own grouping of its two-player maps), and the maps of that level in a
 * list. 3 & 4 Players lists the built-in maps with more than two bases; Add-Ons the maps made in the level editor in
 * this browser. The picked map is previewed beside the list; load fetches a map by its id for that.
 */
export async function levelSelector(s: Settings, maps: MapEntry[], addOns: MapEntry[] = [],
  load?: (id: string) => Promise<RfwMap | null>): Promise<{ level: number; mapId: string } | null> {
  if (!maps.length && !addOns.length) return { level: s.level, mapId: s.mapId };
  // The list each map is in: its level, MULTI for more than two bases, 0 (Add-Ons) for maps from the level editor.
  const group = (m: MapEntry) => (m.players.max > 2 ? MULTI : m.level);
  const all = [...maps.map((m) => ({ ...m, level: group(m) })), ...addOns.map((m) => ({ ...m, level: 0 }))];
  const mine = all.find((m) => m.id === s.mapId);
  let level = mine ? mine.level : all.some((m) => m.level === s.level) ? s.level : all[0]!.level;
  let mapId = s.mapId;
  const levels = el('fieldset', { class: 'levels' }, el('legend', {}, 'Level'));
  for (let l = 1; l <= 9; l++) {
    const r = radio('level', `Level ${l}`, l === level, String(l));
    if (!all.some((m) => m.level === l)) r.querySelector('input')!.disabled = true;
    levels.append(r);
  }
  const multi = radio('level', '3 & 4 Players', level === MULTI, String(MULTI));
  multi.querySelector('input')!.disabled = !all.some((m) => m.level === MULTI);
  multi.title = 'Maps for three or four sides; the computer plays every base nobody takes';
  levels.append(multi);
  const extra = radio('level', 'Add-Ons', level === 0, '0');
  extra.querySelector('input')!.disabled = !addOns.length;
  extra.title = addOns.length ? 'Maps made in the level editor in this browser' : 'Maps you make in the level editor (editor.html) appear here';
  levels.append(extra);
  const list = el('select', { size: 12, class: 'listview' });
  const preview = load ? new MapPreview(loadCommon) : null;
  const groupName = (l: number) => (l === MULTI ? '3 & 4 Players' : l === 0 ? 'Add-On' : `Level ${l}`);
  const showPicked = () => {
    const m = all.find((x) => x.id === mapId);
    if (preview && m) preview.show(m.id, { name: m.name, bases: m.players.max, note: groupName(m.level) }, () => load!(m.id));
  };
  const fill = () => {
    list.replaceChildren();
    const here = all.filter((m) => m.level === level);
    for (const m of here) list.add(new Option(m.name, m.id, false, m.id === mapId));
    if (!here.some((m) => m.id === mapId)) {
      mapId = here[0]!.id;
      list.value = mapId;
    }
    showPicked();
  };
  fill();
  levels.addEventListener('change', () => {
    level = Number(levels.querySelector<HTMLInputElement>('input:checked')!.value);
    fill();
  });
  list.addEventListener('change', () => {
    mapId = list.value;
    showPicked();
  });
  const body = el('div', { class: 'cols level-selector' }, levels, el('div', { class: 'grow' }, el('div', { class: 'caption' }, 'Map'), list),
    ...(preview ? [el('div', { class: 'grow preview-col' }, el('div', { class: 'caption' }, 'Preview'), preview.root)] : []));
  const go = dialog('Level Selector', body, [['OK', 'ok'], ['Cancel', 'cancel']]);
  list.addEventListener('dblclick', () => body.closest('.window')?.querySelector<HTMLButtonElement>('.btn.default')?.click());
  return (await go) ? { level, mapId } : null;
}

/** The Level Selector's list of maps with three or four bases. */
const MULTI = 10;

/** Hall of Fame (L): the original's columns, for Training or Tournament games. */
export async function hallOfFame(table: ScoreTable, start: ScoreMode): Promise<void> {
  let mode = start;
  const grid = el('table', { class: 'grid' });
  const head = ['Level', 'Map Name', 'Time', 'Winner', 'Draws', 'Player 1 Wins', 'Player 2 Wins', 'Total Games'];
  const fill = () => {
    grid.replaceChildren(el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))));
    const tbody = el('tbody');
    for (const r of table[mode]) {
      tbody.append(el('tr', {}, ...[r.level, r.mapName, formatTime(r.time), r.winner, r.draws, r.wins[0], r.wins[1], r.total]
        .map((v) => el('td', {}, String(v)))));
    }
    if (!table[mode].length) tbody.append(el('tr', {}, el('td', { colSpan: head.length, class: 'none' }, 'No games yet')));
    grid.append(tbody);
  };
  fill();
  const modes = el('div', { class: 'row' }, radio('hof', 'Training', mode === 'training', 'training'),
    radio('hof', 'Tournament', mode === 'tournament', 'tournament'));
  modes.addEventListener('change', () => {
    mode = modes.querySelector<HTMLInputElement>('input:checked')!.value as ScoreMode;
    fill();
  });
  await dialog('Hall of Fame', el('div', {}, el('div', { class: 'scroll' }, grid), modes), [['Close', 'ok']]);
}

export async function about(): Promise<void> {
  await dialog('About Return Fire: Redux', el('div', { class: 'stack' },
    el('b', {}, 'Return Fire: Redux'),
    el('p', {}, 'A browser remake of Return Fire (Silent Software, 1995), rebuilt from the original so it plays the same.'),
    el('p', {}, 'Return Fire is a trademark of its owners. This build uses the game data you imported from your own copy.')),
  [['OK', 'ok']]);
}

/** Help Topics: every key, since the original's WinHelp file does not carry over. Built from keys.ts, so it cannot go stale. */
export async function helpTopics(): Promise<void> {
  // One table, so the sections line up: a heading row, then what each key does.
  const heading = (text: string, ...cols: string[]) => el('tr', {}, el('th', { colSpan: cols.length ? 1 : 3 }, text), ...cols.map((c) => el('th', {}, c)));
  const row = (what: string, ...keys: string[]) =>
    el('tr', {}, el('td', {}, what), ...keys.map((k) => el('td', keys.length === 1 ? { colSpan: 2 } : {}, k)));
  const k = ONLINE_KEYS;
  const names = (codes: readonly string[]) => codes.map(keyName).join(' or ');
  const { left, right } = activeControls();
  const r = REPLAY_KEYS;
  const grid = el('table', { class: 'grid help' }, el('tbody', {},
    heading('Vehicles', 'Brown', 'Green'),
    ...CONTROL_ROWS.map(([what, keys, sep]) => row(what, keys(left).map(keyName).join(sep), keys(right).map(keyName).join(sep))),
    heading('Online'),
    row('Open the chat line', keyName(k.chat)),
    row('Chat to everyone, your team or one player', `${keyName(k.scoreboard)} (Shift+${keyName(k.scoreboard)} back)`),
    row('Send / close the chat line', 'Enter / Esc'),
    row('Scoreboard (hold)', keyName(k.scoreboard)),
    row('Spectator: follow player 1-4', k.follow.map(keyName).join(' ')),
    heading('Replays'),
    row('Slower / faster', `${names(r.slower)} / ${names(r.faster)}`),
    row('Ten seconds back / on', `${names(r.back)} / ${names(r.forward)}`),
    row('Follow player 1-4', r.follow.map(keyName).join(' ')),
    row('Pause / play', shortcutName('pause')),
    heading('Game'),
    ...SHORTCUTS.map((s) => row(s.label, shortcutName(s.id))),
    heading('Menus'),
    row('Move up / down', `${names(MENU_KEYS.prev)} / ${names(MENU_KEYS.next)} (or Tab / Shift+Tab)`),
    row('Pick', 'Enter or Space'),
    row('Open a sub-menu', names(MENU_KEYS.open)),
    row('Back to the menu before', `${names(MENU_KEYS.back)} or ${names(MENU_KEYS.close)}`),
    row('Close the menu (from its first page)', names(MENU_KEYS.close)),
    row('Leave the game', 'Esc'),
    row('Skip the win scene', 'Any key')));
  const body = el('div', { class: 'stack' },
    el('p', {}, 'Capture the other side\'s flag: find it under one of their buildings, pick it up with your jeep and bring it home.'),
    el('div', { class: 'scroll' }, grid),
    el('p', {}, 'Online play needs an account: Online, then Sign Up in the menu. Training and two-player games on one keyboard need none.'),
    el('p', {}, 'Second button: jeep floats its tyres, tank and ASV fire at aircraft, helicopter fires straight ahead. Third button: jeep puts down or picks up the flag, ASV lays a mine, helicopter swaps gun and missiles. Both turret keys together centre the turret. On the lift screen the drive keys pick a vehicle and Fire launches it.'),
    el('p', {}, 'On a phone or tablet: the stick comes to wherever your left thumb lands, Fire is in the right corner with the vehicle\'s own buttons round it (Tyres and Flag, AA, Mine, Ahead and Swap, the turret or strafe), and the top row launches a vehicle on the lift screen, docks while driving, pauses offline and opens the chat and scores online. Hold it sideways: upright, the game waits.'),
    el('p', {}, 'While a menu is open it has the keyboard and your vehicle takes no keys. Offline the match waits for you; online it carries on.'),
    el('p', {}, 'In Training, online and in the editor\'s test play either side\'s keys work; Swap Sides (Alt+3) gives Brown the right-hand side, and Options > Controls rebinds any vehicle key. While the chat line is open the vehicle takes no keys, and no game key opens it.'));
  await dialog('Return Fire: Redux Help', body, [['OK', 'ok']]);
}

/** System Info: what the browser offers the game. */
export async function systemInfo(): Promise<void> {
  const rows: [string, string][] = [
    ['Browser', navigator.userAgent], ['Window', `${innerWidth} × ${innerHeight} at ${devicePixelRatio}x`],
    ['Screen', `${screen.width} × ${screen.height}`], ['Touch points', String(navigator.maxTouchPoints)],
    ['Audio', 'AudioContext' in window ? 'Web Audio' : 'none'], ['Processors', String(navigator.hardwareConcurrency ?? '?')],
    ['Own art', artSprites ? `${artSprites} sprites from the art pack` : 'none in use'],
  ];
  await dialog('System Info', el('table', { class: 'grid' }, el('tbody', {}, ...rows.map(([a, b]) => el('tr', {}, el('th', {}, a), el('td', {}, b))))),
    [['OK', 'ok']]);
}

/** The exit question (Esc). In a browser, leaving goes back to the title screen. */
export async function confirmExit(): Promise<boolean> {
  return (await dialog('Return Fire: Redux', el('p', {}, 'Are you sure you want to leave Return Fire: Redux?'), [['Yes', 'yes'], ['No', 'cancel']])) === 'yes';
}

/** A message with OK, for errors and notices. */
export async function notice(title: string, text: string): Promise<void> {
  await dialog(title, el('p', {}, text), [['OK', 'ok']]);
}
