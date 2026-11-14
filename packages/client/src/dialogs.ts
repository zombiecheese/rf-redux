// The front end's dialogs: Player Selector, Level Selector, Hall of Fame, Help, System Info, About and the exit question, plus the
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
 * Player Selector (N, New Game): Training (one player against the computer) or Tournament (two players at one
 * keyboard), and the Brown and Green names. Phones and tablets play Training only. fixed keeps s.players and hides the
 * choice (Play > Training, Play > Two Players): one player gets the single full-screen view, never the split screen.
 */
export async function playerSelector(s: Settings, handheld: boolean, fixed = false): Promise<Settings | null> {
  const mode = el('fieldset', {}, el('legend', {}, 'Game'), radio('mode', 'Training', s.players === 1, '1'));
  if (!handheld) mode.append(radio('mode', 'Tournament', s.players === 2, '2'));
  mode.hidden = fixed || handheld;
  const brown = el('input', { type: 'text', value: s.names[0], maxLength: 20 });
  const green = el('input', { type: 'text', value: s.names[1], maxLength: 20 });
  const skill = el('select', {});
  for (let d = DIFFICULTY.min; d <= DIFFICULTY.max; d++) skill.add(new Option(String(d), String(d), false, d === s.difficulty));
  const greenLabel = field('Green:', green);
  const names = el('fieldset', {}, el('legend', {}, 'Players'), field('Brown:', brown), greenLabel);
  const skillRow = field('Computer skill:', skill);
  // The view: classic or modern, with a preview of each. Options > Visuals still switches it at any time.
  const view = viewPicker(s.visuals === 'modern' && modernAvailable() ? 'modern' : 'retro');
  const viewSet = el('fieldset', { class: 'view-set' }, el('legend', {}, 'View'), view);
  const body = el('div', { class: 'stack' }, el('div', { class: 'cols' }, mode, el('div', {}, names, skillRow)), viewSet);
  const sync = () => {
    const two = mode.querySelector<HTMLInputElement>('input:checked')?.value === '2';
    skillRow.hidden = two;
    greenLabel.querySelector('span')!.textContent = two ? 'Green:' : 'Computer:';
  };
  mode.addEventListener('change', sync);
  sync();
  const r = await dialog('Player Selector', body, [['OK', 'ok'], ['Cancel', 'cancel']]);
  if (!r) return null;
  const players = handheld ? 1 : fixed ? s.players : (Number(mode.querySelector<HTMLInputElement>('input:checked')?.value) as 1 | 2) || 1;
  return {
    ...s, players,
    visuals: view.value === 'modern' ? 'modern' : 'retro',
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

/** The game's version, from the root package.json (vite.config.ts). */
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const ul = (...items: string[]) => el('ul', { class: 'help-list' }, ...items.map((t) => el('li', {}, t)));
const h = (text: string) => el('h3', { class: 'help-head' }, text);

/**
 * Pages picked by pill tabs along the top (the arrow keys move between them, as in any radio group), one shown at a
 * time so the dialog stays the same size.
 */
function tabbed(name: string, pages: [string, HTMLElement][]): HTMLElement {
  const tabs = el('div', { class: 'segmented help-tabs', role: 'radiogroup' } as Partial<HTMLDivElement>,
    ...pages.map(([label], i) => radio(name, label, i === 0, String(i))));
  const panes = pages.map(([, page], i) => {
    page.hidden = i !== 0;
    return page;
  });
  tabs.addEventListener('change', () => {
    const at = Number(tabs.querySelector<HTMLInputElement>('input:checked')!.value);
    panes.forEach((p, i) => (p.hidden = i !== at));
  });
  return el('div', { class: 'stack help-book' }, tabs, el('div', { class: 'scroll help-page' }, ...panes));
}

export async function about(): Promise<void> {
  const link = (href: string, text: string) => el('a', { href, target: '_blank', rel: 'noopener' }, text);
  await dialog('About Return Fire: Redux', el('div', { class: 'stack about' },
    el('b', {}, `Return Fire: Redux ${VERSION}`),
    el('p', {}, 'A browser remake of Return Fire (Silent Software, 1995), the capture-the-flag game of jeeps, tanks, ASVs and helicopters. It is traced from the original Windows 95 release so it handles and plays the same, and adds online play for up to four, computer players, a level editor, replays and a modern 3D view.'),
    el('p', {}, 'It stands on its own: you need no copy of the original and nothing is imported. Every sprite, 3D model, sound, picture and piece of music is the project\'s own. Two things come from the original: its measurements (model shapes and number tables) and its 104 two-player map layouts, which are the work of the original designers. The 3- and 4-base maps are made for this game.'),
    el('p', {}, 'Music: the classic view plays the project\'s own band arrangements of public-domain marches and calls; the modern view has its own hardcore and metalcore soundtrack. Sampled instruments use the GeneralUser GS SoundFont by S. Christian Collins. The modern view is drawn with three.js.'),
    el('p', {}, 'Source code and releases: ', link('https://github.com/zombiecheese/rf-redux', 'github.com/zombiecheese/rf-redux'), '.'),
    el('p', { class: 'hint' }, 'Return Fire is a trademark of its owners. This is a fan remake, not connected with them.')),
  [['OK', 'ok']]);
}

/** Help Topics: how to play, the views, sound, online and every key. The keys are built from keys.ts, so they cannot go stale. */
export async function helpTopics(): Promise<void> {
  await dialog('Return Fire: Redux Help', tabbed('help-tab', [
    ['How to Play', howToPlay()], ['Keys', keysPage()], ['Views', viewsPage()], ['Online', onlinePage()], ['More', morePage()],
  ]), [['OK', 'ok']]);
}

function howToPlay(): HTMLElement {
  return el('div', { class: 'stack' },
    el('p', {}, 'Capture the other side\'s flag. It is hidden under one of their flag buildings: shell the buildings to find it, pick it up with your jeep and drive it home to your own base, or a teammate\'s. A base is out when an enemy jeep takes its flag home, or when it has no jeeps left. The last team standing wins.'),
    h('Your vehicles'),
    ul(
      'Jeep: fast, and the only vehicle that can carry a flag. Throws grenades; the second button floats its tyres to cross water, the third puts down or picks up the flag.',
      'Tank: slow and tough, with a turret that swings on its own keys (both together centre it). The second button fires up at aircraft.',
      'ASV: the armoured support vehicle fires missiles, lays mines with the third button and fires up at aircraft with the second.',
      'Helicopter: winds up and lifts off before it can fly, strafes, and only anti-air fire reaches it in the air. The second button fires straight ahead, the third swaps gun and missiles. Land it on your lift to dock.',
    ),
    el('p', {}, 'Each vehicle has a few lives. Choose one on the lift screen with the drive keys (or click or tap its bay) and launch it with Fire or its launch key. Refuel and rearm on any depot\'s pad, and drive back onto your lift to dock and pick another.'),
    h('Games'),
    ul(
      'Training: you against the computer, in one full-screen view. Two Players: two people on one keyboard in split screen (not on phones and tablets).',
      'Maps have two, three or four bases. With more than two you pick the team layout (2v2, 2v1v1 and so on, or everyone for themselves), and the computer plays every base without a player. The handicap helps the smaller side of an uneven match.',
      'The computer\'s skill runs from 1 to 9 (5 is the default). From 4 up, attack drones come for a vehicle that sits still.',
      'When your base is out you can watch the players still in (see Keys). The Hall of Fame keeps the best Training and Tournament times.',
    ));
}

function keysPage(): HTMLElement {
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
    heading('Watching (your base is out, or spectating online)', 'Brown', 'Green'),
    row('Watch the next / previous player still in', `${names([...left.right, ...left.fire])} / ${names(left.left)}`, `${names([...right.right, ...right.fire])} / ${names(right.left)}`),
    row('Watch player 1-4', `Launch keys or ${k.follow.map(keyName).join(' ')}`, 'Launch keys'),
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
    row('Skip the splash or the win scene', 'Any key')));
  return el('div', { class: 'stack' }, grid,
    el('p', {}, 'In Training, online and in the editor\'s test play either side\'s keys work. Options > Controls > Vehicle Keys rebinds any vehicle key for either hand, and Options > Controls > Swap Sides gives Brown the right-hand keys. No game key opens the chat, and while a menu or the chat line is open your vehicle takes no keys. Offline the match waits while a menu is open; online it carries on.'),
    h('Phones and tablets'),
    el('p', {}, 'Hold the device sideways: upright, the game waits. The stick comes to wherever your left thumb lands, Fire is in the right corner with the vehicle\'s own buttons round it (Tyres and Flag, AA, Mine, Ahead and Swap, the turret or strafe), and the top row docks while driving, pauses offline and opens the chat and scores online. On the lift screen tap a bay to choose it and tap it again to launch. When you are out, P1 to P4 pick who to watch. Phones and tablets play solo: no split screen and no level editor.'));
}

function viewsPage(): HTMLElement {
  return el('div', { class: 'stack' },
    el('p', {}, 'Pick the view when you start a game, or switch at any time, even mid-match, with Options > View > Visuals. Both show the same part of the map, so classic and modern players can share an online match.'),
    h('Classic'),
    el('p', {}, 'The original\'s look: a 320 × 240 picture with the tilted 3D camera, scaled to the window with square pixels, with the cockpit panel, bars and radar. Its subtle CRT scanlines and glow are part of the look. Options > View > Picture picks Fill or whole pixels only. The bars beside the picture are camouflage in your colour.'),
    h('Modern'),
    ul(
      'The same game drawn in 3D at 1280 × 720 with toy-soldier models, sunlight and shadows, an animated sea, smoke, fire and debris, a 3D bunker cutaway and a 3D laughing skull. It needs WebGL; without it the game stays classic.',
      'Drone feed: the picture is a surveillance drone\'s, with grain, a scan line and stream errors when something blows up nearby.',
      'Computer-vision HUD: tracking boxes with integrity on your vehicle (with its fuel and ammunition), friends, enemy vehicles, gun towers, flag buildings and drones, a tactical plot for the radar, and messages as read-outs.',
      'Flag arrows: at the edges of the picture, in each rival\'s colour, arrows point to its flag buildings (any of them may hide the flag), to a flag lying in the open, and home while your jeep carries one.',
      'Day or night (Options > View > Lighting): night is dark, lit by headlights, fires and the buildings\' windows and lamps.',
      'Thermal camera: in a match, switch the drone to a white-hot thermal picture that sees in the dark, with the thermal button beside the menu button or its key (see Keys).',
    ),
    el('p', {}, 'Online the lobby\'s host can set the visuals and the lighting for everyone (the lobby\'s Multiplayer view), or leave both to each player\'s own Options. Replays play back the way their match was seen.'));
}

function onlinePage(): HTMLElement {
  return el('div', { class: 'stack' },
    el('p', {}, 'Online play needs an account (Online > Create an Account) and a game server: the Docker stack or npm start, not the Vite dev server alone. Training and two-player games need neither.'),
    ul(
      'Quick Match joins the first open game, Find a Game lists open lobbies, Host a Game makes your own, and Join with a Code takes a private lobby\'s code or invite link.',
      'The host picks the map, the team layout, the difficulty, who can join, the handicap, and the visuals and lighting. Empty seats get computer players, so 1 to 4 people can play.',
      'Chat in every lobby and match to everyone, your team or one player, with mute, block and report. Hold the scoreboard key to see the scores.',
      'Friends (Online > Friends) shows who is online and lets you invite them. Your profile keeps your stats; the leaderboards keep the fastest solo wins and the ladder.',
      'A dropped player\'s seat is held for a minute while a computer player drives for them. There is no pause online.',
    ));
}

function morePage(): HTMLElement {
  return el('div', { class: 'stack' },
    h('Replays'),
    el('p', {}, 'Every match is recorded in your browser: the last 20, plus any you star. Title > Replays plays one back from ¼× to 8× with pause, ten-second jumps, a timeline and a choice of player to follow. Save a replay as a file, or to your account when signed in.'),
    h('Level Editor'),
    el('p', {}, 'Title > Level Editor (on a computer) paints land and water with automatic coastlines, lays bridges, places buildings and up to four bases, mirrors or turns your edits for a fair map, checks it for problems and test plays it against the computer. Maps save in your browser, export as files and play from the Level Selector\'s Add-Ons. Signed in, save them to your library as private, unlisted or public; public maps can be searched, liked and played in lobbies.'),
    h('Sound and music'),
    el('p', {}, 'The music follows the action as the original\'s did: a piece for each vehicle, the bunker, the flag, deaths and the win. The classic view plays a military band of public-domain marches on the built-in synthesiser, or sampled from the GeneralUser GS SoundFont with Options > Sound and Music > Instruments > Sampled (32 MB the first time, then kept by your browser). The modern view has its own hardcore and metalcore soundtrack. Options > Sound and Music sets the master, effects and music volume and switches the music off, and the mute key silences everything.'),
    h('Your settings'),
    el('p', {}, 'Names, options, keys and the Hall of Fame are kept in this browser; signed in, your settings follow your account. Help > System Info shows what this browser and server offer the game.'));
}

/** What the game can find out about the server it came from, for System Info (main.ts). */
export interface ServerInfo {
  /** A game server answered: online play is open. */
  online: boolean;
  /** The server has a SoundFont for Options > Instruments > Sampled. */
  soundfont: boolean;
  /** Who is signed in, if anyone. */
  account?: string;
}

/** System Info: the game's version and what this browser and server offer it. */
export async function systemInfo(server: ServerInfo, s: Settings): Promise<void> {
  const webgl = modernAvailable();
  const rows: [string, string][] = [
    ['Version', `Return Fire: Redux ${VERSION}`],
    ['Game data', `The game's own, built in${artSprites ? ` (${artSprites} sprites)` : ''}: no import needed`],
    ['Online', server.online ? `Game server found${server.account ? `, signed in as ${server.account}` : ', not signed in'}` : 'No game server (solo and two-player only)'],
    ['View', `${s.visuals === 'modern' && webgl ? 'Modern' : 'Classic'}${s.visuals === 'modern' && webgl ? ` (drone feed, ${s.lighting})` : ' (CRT pixels)'}`],
    ['Modern view', webgl ? 'Available (WebGL)' : 'Not available: this browser has no WebGL'],
    ['Instruments', server.soundfont ? (s.instruments === 'sampled' ? 'Sampled (GeneralUser GS)' : 'Built-in synthesiser (sampled available)') : 'Built-in synthesiser (no SoundFont on this server)'],
    ['Audio', 'AudioContext' in window ? 'Web Audio' : 'None: the game plays silent'],
    ['Browser', navigator.userAgent], ['Window', `${innerWidth} × ${innerHeight} at ${devicePixelRatio}x`],
    ['Screen', `${screen.width} × ${screen.height}`], ['Touch points', String(navigator.maxTouchPoints)],
    ['Processors', String(navigator.hardwareConcurrency ?? '?')],
  ];
  await dialog('System Info', el('table', { class: 'grid sysinfo' }, el('tbody', {}, ...rows.map(([a, b]) => el('tr', {}, el('th', {}, a), el('td', {}, b))))),
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
