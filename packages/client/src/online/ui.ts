// The online screens, as panels over the title art like the rest of the game's menus (dialogs.ts, ui.css): sign-in
// and sign-up, the profile, leaderboards, the lobby browser, hosting a lobby with its map picker, the lobby itself
// with a card for each of up to four seats and its chat, and the results after a match.

import { DIFFICULTY, MAX_BASES, TICK_MS, parseMap, type RfwMap } from '@rfw/sim';
import { type LobbyLighting, type LobbyVisuals,
  layoutsFor,
  type ChatChannel, type ChatMessage, type Identity, type LobbyInfo, type LobbySlot, type LobbySummary, type MatchResult, type MatchStart,
} from '@rfw/net';
import { loadCommon, loadMap } from '../assets.js';
import { dialog, el, field, finish, notice, radio, skinClass, viewPicker, type ViewChoice } from '../dialogs.js';
import { MapPreview } from '../mappreview.js';
import { modernAvailable } from '../modern/layout.js';
import { loadModern } from '../modern/load.js';
import { TEAMS as COLOURS } from '../paint.js';
import { formatTime } from '../scores.js';
import { api, ApiError } from './api.js';
import type { Net } from './net.js';

const TEAMS = 'ABCD';

export interface LobbyMap {
  id: string;
  name: string;
  level?: number;
  bases: number;
  featured?: boolean;
  source?: string;
}

/** Maps a lobby can use: the server's built-ins (featured first), your own library maps and the shared public ones. */
export async function lobbyMaps(): Promise<LobbyMap[]> {
  type Shared = { id: string; name: string; bases?: number; players?: { max: number }; featured?: boolean; playable?: boolean };
  const shared = (source: string) => (r: { maps: Shared[] }) => r.maps.filter((m) => m.playable !== false)
    .map((m) => ({ id: m.id, name: m.name, bases: m.bases ?? m.players?.max ?? 2, featured: m.featured, source }));
  const [builtIn, mine, custom] = await Promise.all([
    api<{ maps: LobbyMap[] }>('/api/lobby-maps').then((r) => r.maps).catch(() => []),
    api<{ maps: Shared[] }>('/api/maps?mine=1&limit=200').then(shared('mine')).catch(() => []),
    api<{ maps: Shared[] }>('/api/maps?visibility=public&sort=likes&limit=200').then(shared('shared')).catch(() => []),
  ]);
  const own = new Set(mine.map((m) => m.id));
  const all = [...builtIn, ...custom.filter((m) => !own.has(m.id))];
  return [...all.filter((m) => m.featured), ...all.filter((m) => !m.featured), ...mine.map((m) => ({ ...m, featured: false }))];
}

/** The host's picks of how everyone sees the match. */
const LOBBY_VIEWS: ViewChoice[] = [
  { value: 'retro', label: 'Classic', hint: 'The original pixel look', image: 'retro' },
  { value: 'modern', label: 'Modern', hint: '3D drone feed at 720p', image: 'modern' },
];
const LIGHTING: [LobbyLighting, string][] = [['day', 'Day'], ['night', 'Night']];

function skillSelect(value: number): HTMLSelectElement {
  const s = el('select', {});
  for (let d = DIFFICULTY.min; d <= DIFFICULTY.max; d++) s.add(new Option(String(d), String(d), false, d === value));
  return s;
}

const input = (type: string, value = '', max = 200) => el('input', { type, value, maxLength: max });

async function tryApi<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    await notice('Return Fire: Redux Online', err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ---- Accounts ----

/** Sign In. Resolves with the user, or null if cancelled; may hand over to Sign Up or Reset. */
export async function signIn(): Promise<Identity | null> {
  const login = input('text', '', 200);
  const pass = input('password');
  const body = el('div', { class: 'stack' }, field('Name or email:', login), field('Password:', pass));
  const r = await dialog('Sign In', body, [['Sign In', 'ok'], ['Create an Account', 'signup'], ['Forgot Password', 'reset'], ['Cancel', 'cancel']]);
  if (r === 'signup') return signUp();
  if (r === 'reset') return resetPassword();
  if (!r) return null;
  const out = await tryApi(() => api<{ user: Identity }>('/api/auth/signin', { login: login.value, password: pass.value }));
  return out ? out.user : signIn();
}

export async function signUp(): Promise<Identity | null> {
  const opts = await api<{ signups: string }>('/api/auth/options').catch(() => ({ signups: 'open' }));
  if (opts.signups === 'closed') {
    await notice('Sign Up', 'New accounts are closed on this server for now.');
    return null;
  }
  const name = input('text', '', 16);
  const email = input('email');
  const pass = input('password');
  const invite = input('text', '', 20);
  const body = el('div', { class: 'stack' },
    field('Player name:', name), field('Email:', email), field('Password:', pass),
    ...(opts.signups === 'invite' ? [field('Invite code:', invite)] : []),
    el('p', {}, 'Your name shows in lobbies, chat and the leaderboards. Passwords are at least 8 characters.'));
  if (!(await dialog('Create an Account', body, [['Create Account', 'ok'], ['Cancel', 'cancel']]))) return null;
  const out = await tryApi(() => api<{ user: Identity }>('/api/auth/signup', { name: name.value, email: email.value, password: pass.value, invite: invite.value }));
  return out ? out.user : signUp();
}

export async function resetPassword(): Promise<Identity | null> {
  const code = input('text', '', 40);
  const pass = input('password');
  const body = el('div', { class: 'stack' },
    el('p', {}, 'Ask an admin for a reset code, then choose a new password.'), field('Reset code:', code), field('New password:', pass));
  if (!(await dialog('Reset Password', body, [['Reset', 'ok'], ['Cancel', 'cancel']]))) return null;
  const out = await tryApi(() => api<{ user: Identity }>('/api/auth/reset', { code: code.value, password: pass.value }));
  return out ? out.user : null;
}

export async function signOut(): Promise<void> {
  await api('/api/auth/signout', {}).catch(() => {});
}

interface Stats { games: number; wins: number; losses: number; draws: number; quits: number; captures: number; lost: number; rating: number; rated: number; favourite: string | null }

const statRows = (s: Stats): [string, string][] => [
  ['Games', String(s.games)], ['Won / lost / drawn', `${s.wins} / ${s.losses} / ${s.draws}`], ['Left early', String(s.quits)],
  ['Flags captured', String(s.captures)], ['Vehicles lost', String(s.lost)], ['Ladder rating', s.rated ? String(Math.round(s.rating)) : 'unrated'],
  ['Favourite vehicle', s.favourite ?? '-'],
];

const table = (rows: [string, string][]) => el('table', { class: 'grid' }, el('tbody', {}, ...rows.map(([a, b]) => el('tr', {}, el('th', {}, a), el('td', {}, b)))));

/** Profile: stats, and changing the password. */
export async function profile(): Promise<'signout' | null> {
  const p = await tryApi(() => api<{ user: Identity; stats: Stats }>('/api/profile'));
  if (!p) return null;
  const r = await dialog(`Profile: ${p.user.name}`, el('div', { class: 'stack' }, table(statRows(p.stats))),
    [['Close', 'ok'], ['Change Password', 'password'], ['Sign Out', 'signout']]);
  if (r === 'signout') return 'signout';
  if (r === 'password') {
    const cur = input('password');
    const next = input('password');
    if (await dialog('Change Password', el('div', { class: 'stack' }, field('Current:', cur), field('New:', next)), [['OK', 'ok'], ['Cancel', 'cancel']])) {
      if (await tryApi(() => api('/api/auth/password', { current: cur.value, password: next.value }))) await notice('Profile', 'Password changed.');
    }
  }
  return null;
}

// ---- Leaderboards ----

export async function leaderboards(maps: { id: string; name: string; level?: number }[]): Promise<void> {
  const ladder = await tryApi(() => api<{ ladder: { name: string; rating: number; wins: number; losses: number; games: number }[] }>('/api/leaderboards/ladder'));
  if (!ladder) return;
  const grid = el('table', { class: 'grid' });
  const show = (head: string[], rows: string[][]) => {
    grid.replaceChildren(el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))));
    const tb = el('tbody');
    for (const r of rows) tb.append(el('tr', {}, ...r.map((v) => el('td', {}, v))));
    if (!rows.length) tb.append(el('tr', {}, el('td', { colSpan: head.length, class: 'none' }, 'Nothing yet')));
    grid.append(tb);
  };
  const ladderRows = () => ladder.ladder.map((r, i) => [String(i + 1), r.name, String(r.rating), String(r.wins), String(r.losses)]);
  show(['#', 'Player', 'Rating', 'Won', 'Lost'], ladderRows());
  const mapSel = el('select', {});
  for (const m of maps) mapSel.add(new Option(m.level ? `${m.level}: ${m.name}` : m.name, m.id));
  mapSel.hidden = true;
  const modes = el('div', { class: 'row' }, radio('lb', 'Online ladder', true, 'ladder'), radio('lb', 'Best Training times', false, 'solo'), mapSel);
  const refresh = async () => {
    const mode = modes.querySelector<HTMLInputElement>('input:checked')!.value;
    mapSel.hidden = mode !== 'solo';
    if (mode === 'ladder') return show(['#', 'Player', 'Rating', 'Won', 'Lost'], ladderRows());
    const r = await api<{ times: { name: string; ms: number; difficulty: number; at: number }[] }>(`/api/leaderboards/solo/${encodeURIComponent(mapSel.value)}`).catch(() => ({ times: [] }));
    show(['#', 'Player', 'Time', 'Skill', 'When'], r.times.map((t, i) => [String(i + 1), t.name, formatTime(t.ms), String(t.difficulty), new Date(t.at).toLocaleDateString()]));
  };
  modes.addEventListener('change', () => void refresh());
  await dialog('Leaderboards', el('div', { class: 'stack' }, modes, el('div', { class: 'scroll' }, grid)), [['Close', 'ok']]);
}

// ---- Lobbies ----

/** The lobby browser: open lobbies, live. Resolves with what to do. */
// ---- Lobbies ----

/** Each base's name and colour on its seat card: the game's own (paint.ts), Brown, Green, Blue and Red. */
const side = (base: number) => ({ name: COLOURS[base]?.name ?? `Base ${base + 1}`, colour: COLOURS[base]?.css ?? '#888' });

const badge = (text: string, kind = '') => el('span', { class: `badge ${kind}` }, text);

const button = (label: string, onClick: () => void, cls = 'btn') => {
  const b = el('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
};

/** "2 players + 1 computer" from a lobby summary. */
function seatsText(l: LobbySummary): string {
  const taken = `${l.players} player${l.players === 1 ? '' : 's'}${l.bots ? ` + ${l.bots} computer` : ''}`;
  return l.free ? `${taken}, ${l.free} free` : `${taken}, full`;
}

/** The lobby browser: open lobbies, live, each with Join and Watch. Resolves with what to do. */
export async function browse(net: Net): Promise<{ join: string } | { watch: string } | 'create' | 'code' | 'quick' | null> {
  const search = input('search', '', 40);
  search.placeholder = 'Search games, maps or hosts';
  const list = el('div', { class: 'lobby-list', role: 'list' } as Partial<HTMLElement>);
  const fill = (all: LobbySummary[]) => {
    const q = search.value.trim().toLowerCase();
    const shown = all.filter((l) => !q || [l.name, l.mapName, l.ownerName].some((v) => v.toLowerCase().includes(q)));
    list.replaceChildren();
    for (const l of shown) {
      const playing = l.state === 'playing';
      const actions = el('div', { class: 'lobby-row-actions' });
      if (!playing && l.free) actions.append(button('Join', () => finish(list, `join:${l.id}`), 'btn default'));
      if (playing) actions.append(button('Watch', () => finish(list, `watch:${l.id}`)));
      list.append(el('div', { class: 'lobby-row', role: 'listitem' } as Partial<HTMLElement>,
        el('div', { class: 'lobby-row-main' },
          el('div', { class: 'lobby-row-name' }, l.name, playing ? badge('Playing', 'live') : badge('Waiting')),
          el('div', { class: 'lobby-row-meta' }, `${l.mapName} · hosted by ${l.ownerName} · ${seatsText(l)}`)),
        actions));
    }
    if (!shown.length) {
      list.append(el('div', { class: 'empty' }, all.length ? 'No games match that search.' : 'No open games right now. Host one, or try Quick Match.'));
    }
  };
  search.addEventListener('input', () => fill(net.lobbies));
  fill(net.lobbies);
  const off = net.on('lobbies', fill);
  net.watchLobbies(true);
  const top = el('div', { class: 'toolbar' }, search,
    button('Quick Match', () => finish(list, 'quick'), 'btn default'), button('Host a Game', () => finish(list, 'create')),
    button('Enter Code', () => finish(list, 'code')));
  const r = await dialog('Find a Game', el('div', { class: 'stack browse' }, top, list), [['Close', 'cancel']]);
  off();
  net.watchLobbies(false);
  if (r?.startsWith('join:')) return { join: r.slice(5) };
  if (r?.startsWith('watch:')) return { watch: r.slice(6) };
  return r as 'create' | 'code' | 'quick' | null;
}

export async function enterCode(): Promise<string | null> {
  const code = input('text', '', 8);
  code.classList.add('code-input');
  code.autocomplete = 'off';
  code.placeholder = 'ABC123';
  const r = await dialog('Join with a Code', el('div', { class: 'stack' }, el('p', {}, 'Type the code your friend gave you, or open their invite link.'), code),
    [['Join', 'ok'], ['Cancel', 'cancel']]);
  return r && code.value.trim() ? code.value.trim().toUpperCase() : null;
}

/** The group a map is listed under. */
const mapGroup = (m: LobbyMap) => m.featured ? 'Featured' : m.source === 'mine' ? 'My maps' : m.source === 'shared' ? 'Shared'
  : m.source === 'generated' ? '3 & 4 players' : m.level ? `Level ${m.level}` : 'Maps';

/** A lobby map for its preview: the built-ins from the game data, the rest from the map library. */
function fetchLobbyMap(id: string, source?: string): Promise<RfwMap | null> {
  const library = () => api<{ map: unknown }>(`/api/maps/${encodeURIComponent(id)}`).then((r) => parseMap(r.map));
  if (source === 'mine' || source === 'shared') return library();
  return source ? loadMap(id) : loadMap(id).catch(library);
}

function showLobbyMap(preview: MapPreview, m: LobbyMap): void {
  preview.show(m.id, { name: m.name, bases: Math.min(MAX_BASES, m.bases), note: mapGroup(m) }, () => fetchLobbyMap(m.id, m.source));
}

/**
 * The map picker: a search box, filters by group and by player count, the maps as a list with their bases, and a
 * preview of the picked one. Used when hosting a game and when the host changes the map.
 */
function mapPicker(maps: LobbyMap[], current?: string): { root: HTMLElement; value: () => string; onChange: (fn: () => void) => void } {
  let picked = maps.find((m) => m.id === current)?.id ?? maps[0]?.id ?? '';
  const listeners: (() => void)[] = [];
  const search = input('search', '', 40);
  search.placeholder = 'Search maps';
  const group = el('select', {});
  group.add(new Option('All maps', ''));
  for (const g of [...new Set(maps.map(mapGroup))]) group.add(new Option(g, g));
  const players = el('select', {});
  players.add(new Option('Any size', '0'));
  for (const n of [...new Set(maps.map((m) => Math.min(MAX_BASES, m.bases)))].sort()) players.add(new Option(`${n} players`, String(n)));
  const list = el('div', { class: 'map-list', role: 'listbox' } as Partial<HTMLElement>);
  const preview = new MapPreview(loadCommon);
  const showPicked = () => {
    const m = maps.find((x) => x.id === picked);
    if (m) showLobbyMap(preview, m);
    else preview.clear('No map picked');
  };
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    const n = Number(players.value);
    const shown = maps.filter((m) => (!group.value || mapGroup(m) === group.value) && (!n || Math.min(MAX_BASES, m.bases) === n)
      && (!q || m.name.toLowerCase().includes(q)));
    list.replaceChildren();
    for (const m of shown.slice(0, 300)) {
      const b = el('button', { type: 'button', class: 'map-row' + (m.id === picked ? ' picked' : '') },
        el('span', { class: 'map-name' }, m.name), el('span', { class: 'map-group' }, mapGroup(m)),
        badge(`${Math.min(MAX_BASES, m.bases)}P`, `bases-${Math.min(MAX_BASES, m.bases)}`));
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(m.id === picked));
      b.addEventListener('click', () => {
        picked = m.id;
        list.querySelectorAll('.map-row').forEach((x) => (x.classList.remove('picked'), x.setAttribute('aria-selected', 'false')));
        b.classList.add('picked');
        b.setAttribute('aria-selected', 'true');
        showPicked();
        listeners.forEach((f) => f());
      });
      b.addEventListener('dblclick', () => list.closest('.window')?.querySelector<HTMLButtonElement>('.btn.default')?.click());
      list.append(b);
    }
    if (!shown.length) list.append(el('div', { class: 'empty' }, 'No maps match.'));
  };
  search.addEventListener('input', fill);
  group.addEventListener('change', fill);
  players.addEventListener('change', fill);
  fill();
  showPicked();
  queueMicrotask(() => list.querySelector('.picked')?.scrollIntoView({ block: 'nearest' }));
  return {
    root: el('div', { class: 'map-picker' }, el('div', { class: 'toolbar' }, search, group, players),
      el('div', { class: 'map-picker-body' }, list, preview.root)),
    value: () => picked,
    onChange: (fn) => listeners.push(fn),
  };
}

/** The host's Change Map. */
async function pickMap(maps: LobbyMap[], current: string): Promise<string | null> {
  const picker = mapPicker(maps, current);
  const r = await dialog('Choose a Map', picker.root, [['Use This Map', 'ok'], ['Cancel', 'cancel']]);
  return r && picker.value() !== current ? picker.value() : null;
}

function segmented(name: string, options: [string, string][], value: string): HTMLDivElement {
  return el('div', { class: 'segmented', role: 'radiogroup' } as Partial<HTMLDivElement>, ...options.map(([v, label]) => radio(name, label, v === value, v)));
}

const segValue = (s: HTMLElement) => s.querySelector<HTMLInputElement>('input:checked')!.value;

/** The lobby's Multiplayer view section: how every player sees the match, which only the host picks. */
function multiplayerView(look: HTMLElement): HTMLFieldSetElement {
  return el('fieldset', { class: 'view-set' }, el('legend', {}, 'Multiplayer view · set by the host'), look);
}

/** Host a Game: name, who may join, the map and the team layout. */
export async function createLobby(maps: LobbyMap[]): Promise<{ mapId: string; visibility: 'open' | 'private'; name: string; teams?: number[] } | null> {
  if (!maps.length) {
    await notice('Host a Game', 'The server has no maps: its art pack is missing.');
    return null;
  }
  const name = input('text', '', 40);
  name.placeholder = 'My game';
  const picker = mapPicker(maps);
  const layout = el('select', {});
  const fillLayouts = () => {
    const bases = Math.min(MAX_BASES, maps.find((m) => m.id === picker.value())?.bases ?? 2);
    layout.replaceChildren(...layoutsFor(bases).map((l) => new Option(l.name, l.teams.join(','))));
  };
  fillLayouts();
  picker.onChange(fillLayouts);
  const vis = segmented('vis', [['open', 'Open to anyone'], ['private', 'Friends with the code']], 'open');
  const body = el('div', { class: 'stack host' }, field('Name:', name), field('Who can join:', vis), field('Teams:', layout), picker.root);
  if (!(await dialog('Host a Game', body, [['Create Lobby', 'ok'], ['Cancel', 'cancel']]))) return null;
  return { mapId: picker.value(), name: name.value, visibility: segValue(vis) as 'open' | 'private', teams: layout.value.split(',').map(Number) };
}

/**
 * The lobby: seat cards for up to four bases, the match settings, chat, and Ready or Start. It stays up (not modal)
 * while the player is in a lobby and no match is running.
 */
export class LobbyWindow {
  private readonly layer: HTMLDivElement;
  private readonly title = el('span', { class: 'lobby-title' });
  private readonly badges = el('div', { class: 'lobby-badges' });
  private readonly invite = el('div', { class: 'lobby-invite' });
  private readonly seats = el('div', { class: 'seats' });
  private readonly settings = el('div', { class: 'lobby-settings' });
  private readonly log = el('div', { class: 'chatlog', role: 'log' } as Partial<HTMLElement>);
  private readonly say = el('input', { type: 'text', maxLength: 200, placeholder: 'Say something', autocomplete: 'off' });
  private readonly to = el('select', { ariaLabel: 'Send to' });
  private readonly controls = el('div', { class: 'lobby-actions' });
  private readonly offs: (() => void)[] = [];
  private maps: LobbyMap[] = [];
  /** The lobby's map, kept across renders so it is only drawn again when the map changes. */
  private readonly preview = new MapPreview(loadCommon, { compact: true });

  /** @param onMenu The Menu button: hides the lobby (still in it) for the game's menu. */
  constructor(private readonly net: Net, private readonly onLeave: () => void, onMenu: () => void) {
    const close = button('×', () => this.leave(), 'close');
    close.ariaLabel = 'Leave the lobby';
    const menu = button('☰ Menu', onMenu, 'btn quiet');
    const send = button('Send', () => this.send(), 'btn');
    const chat = el('section', { class: 'lobby-chat' }, el('h3', {}, 'Chat'), this.log, el('div', { class: 'chat-send' }, this.to, this.say, send));
    const win = el('div', { class: `${skinClass()} window lobby-window`, role: 'dialog' } as Partial<HTMLElement>,
      el('div', { class: 'titlebar' }, el('div', { class: 'lobby-heading' }, this.title, this.badges, this.invite), menu, close),
      el('div', { class: 'body' },
        el('div', { class: 'lobby-main' },
          el('section', { class: 'lobby-seats' }, el('h3', {}, 'Players'), this.seats, this.settings),
          el('div', { class: 'lobby-side' }, this.preview.root, chat)),
        this.controls));
    win.setAttribute('aria-label', 'Lobby');
    this.layer = el('div', { class: 'dialog-layer lobby-layer' }, win);
    this.layer.hidden = true;
    document.body.append(this.layer);
    this.say.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') this.send();
    });
    this.offs.push(net.on('lobby', (l) => this.render(l)), net.on('chat', (m) => this.addChat(m)));
    void lobbyMaps().then((m) => {
      this.maps = m;
      this.render(this.net.lobby);
    });
  }

  get visible(): boolean {
    return !this.layer.hidden;
  }

  show(on: boolean): void {
    this.layer.hidden = !on || !this.net.lobby;
    if (!this.layer.hidden) {
      this.render(this.net.lobby);
      this.log.replaceChildren();
      for (const m of this.net.chat) this.addChat(m);
    }
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    this.layer.remove();
  }

  private send(): void {
    if (!this.say.value.trim()) return;
    const [channel, to] = this.to.value.split(':') as [ChatChannel, string | undefined];
    this.net.send({ t: 'chat', channel, to, text: this.say.value });
    this.say.value = '';
  }

  private leave(): void {
    this.net.send({ t: 'leave' });
    this.layer.hidden = true;
    this.onLeave();
  }

  private addChat(m: ChatMessage): void {
    if (this.layer.hidden) return;
    const tag = m.channel === 'team' ? 'Team' : m.channel === 'whisper' ? `Whisper${m.to && m.from?.id === this.net.you?.id ? ` to ${m.to.name}` : ''}` : '';
    const line = el('div', { class: 'chat-line' + (m.system ? ' sys' : '') + (m.channel !== 'all' ? ` ${m.channel}` : '') },
      tag ? el('span', { class: 'chat-tag' }, tag) : '', m.from ? el('b', {}, `${m.from.name}: `) : '', m.text);
    if (m.from && m.from.id !== this.net.you?.id && !this.net.you?.guest) {
      line.title = 'Right-click or long-press to report or block';
      line.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        void this.moderate(m);
      });
    }
    this.log.append(line);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private async moderate(m: ChatMessage): Promise<void> {
    const why = input('text', '', 200);
    const r = await dialog(`Message from ${m.from!.name}`, el('div', { class: 'stack' }, el('p', {}, m.text), field('Reason:', why)),
      [['Report', 'report'], ['Block Player', 'block'], ['Cancel', 'cancel']]);
    if (r === 'report') this.net.send({ t: 'report', message: m.id, reason: why.value });
    if (r === 'block') this.net.send({ t: 'mute', user: m.from!.id, muted: true });
  }

  private render(l: LobbyInfo | null): void {
    // The host picked the modern view: its renderer's code is fetched while the lobby fills, ready for the start.
    if (l?.visuals === 'modern' && modernAvailable()) void loadModern();
    if (!l) {
      this.layer.hidden = true;
      return;
    }
    const me = this.net.you?.id;
    const owner = l.owner === me;
    const waiting = l.state === 'waiting';
    this.title.textContent = l.name;
    this.badges.replaceChildren(waiting ? badge('Waiting') : badge('Playing', 'live'),
      badge(l.visibility === 'private' ? 'Friends only' : 'Open'));

    const link = `${location.origin}/?join=${l.code}`;
    const copy = button('Copy Invite Link', () => void navigator.clipboard?.writeText(link).then(() => (copy.textContent = 'Copied')));
    this.invite.replaceChildren(el('span', { class: 'invite-label' }, 'Code'), el('span', { class: 'code' }, l.code), copy);

    // The match settings under the seats: the host changes them while the lobby waits; everyone else sees them.
    this.settings.replaceChildren();
    if (owner && waiting) {
      const maps = this.maps.length ? this.maps : [{ id: l.mapId, name: l.mapName, bases: l.slots.length }];
      const change = button('Change Map…', () => void pickMap(maps, l.mapId).then((id) => id && this.net.send({ t: 'settings', mapId: id })));
      const layout = el('select', {});
      layout.add(new Option('Choose…', ''));
      for (const x of layoutsFor(l.slots.length)) layout.add(new Option(x.name, x.teams.join(',')));
      layout.addEventListener('change', () => layout.value && this.net.send({ t: 'settings', teams: layout.value.split(',').map(Number) }));
      const skill = skillSelect(l.difficulty);
      skill.title = 'Match difficulty: drones, random mines, and the computer players\' starting skill';
      skill.addEventListener('change', () => this.net.send({ t: 'settings', difficulty: Number(skill.value) }));
      const vis = segmented('lobby-vis', [['open', 'Open'], ['private', 'Friends only']], l.visibility);
      vis.addEventListener('change', () => this.net.send({ t: 'settings', visibility: segValue(vis) as 'open' | 'private' }));
      this.preview.actions.replaceChildren(change);
      const handicap = el('input', { type: 'checkbox', checked: l.handicap });
      handicap.addEventListener('change', () => this.net.send({ t: 'settings', handicap: handicap.checked }));
      const handicapRow = el('label', { class: 'check' }, handicap, 'Handicap the smaller side');
      handicapRow.title = 'In an uneven match (2v1, say) the smaller team starts with more vehicles, in proportion, and its flag must be captured three times';
      const look = viewPicker(l.visuals, LOBBY_VIEWS, false);
      look.title = 'Every player sees the match this way';
      look.addEventListener('change', () => this.net.send({ t: 'settings', visuals: look.value as LobbyVisuals }));
      const light = segmented('lobby-light', LIGHTING, l.lighting);
      light.title = 'Day or night for the match';
      light.addEventListener('change', () => this.net.send({ t: 'settings', lighting: segValue(light) as LobbyLighting }));
      this.settings.append(field('Teams:', layout), field('Difficulty:', skill), field('Time of day:', light), field('Who can join:', vis), handicapRow,
        multiplayerView(look));
      this.settings.classList.add('host');
    } else {
      this.preview.actions.replaceChildren();
      this.settings.classList.remove('host');
      this.settings.append(field('Difficulty:', el('span', {}, String(l.difficulty))),
        field('Time of day:', el('span', { class: 'lobby-light' }, LIGHTING.find(([v]) => v === l.lighting)![1])));
      if (l.handicap) this.settings.append(el('p', { class: 'hint' }, 'Handicap on: the smaller side gets extra vehicles, and its flag must be captured more than once.'));
      // The host's picks, with a picture of the view.
      const shown = viewPicker(l.visuals, LOBBY_VIEWS.filter((c) => c.value === l.visuals), false);
      for (const b of shown.querySelectorAll('button')) b.tabIndex = -1;
      shown.classList.add('view-shown');
      this.settings.append(multiplayerView(shown));
    }
    const known = this.maps.find((m) => m.id === l.mapId);
    showLobbyMap(this.preview, known ?? { id: l.mapId, name: l.mapName, bases: l.slots.length });

    this.seats.replaceChildren(...l.slots.map((s, i) => this.seat(l, s, i, owner && waiting, me)));

    // Chat to everyone, the team, or one person.
    const prev = this.to.value;
    this.to.replaceChildren(new Option('All', 'all'), new Option('Team', 'team'));
    for (const s of l.slots) if (s.user && s.user.id !== me) this.to.add(new Option(`To ${s.user.name}`, `whisper:${s.user.id}`));
    if (Array.from(this.to.options).some((o) => o.value === prev)) this.to.value = prev;

    // Ready or Start, and Leave.
    this.controls.replaceChildren();
    const mine = l.slots.find((s) => s.user?.id === me);
    const humans = l.slots.filter((s) => s.kind === 'human' && s.user!.id !== l.owner);
    if (waiting && owner) {
      const notReady = humans.filter((s) => !s.ready).length;
      this.controls.append(el('span', { class: 'hint' }, notReady ? `Waiting for ${notReady} player${notReady === 1 ? '' : 's'} to be ready` : 'Everyone is ready'),
        button('Start Match', () => this.net.send({ t: 'start' }), 'btn default'));
    } else if (waiting && mine) {
      this.controls.append(el('span', { class: 'hint' }, mine.ready ? 'Waiting for the host to start' : 'Press Ready when you are set'),
        button(mine.ready ? 'Not Ready' : 'Ready', () => this.net.send({ t: 'ready', ready: !mine.ready }), 'btn default'));
    } else if (l.state === 'playing' && l.gameId) {
      this.controls.append(el('span', { class: 'hint' }, 'A match is running'), button('Watch', () => this.net.send({ t: 'spectate', gameId: l.gameId! }), 'btn default'));
    }
    this.controls.append(button('Leave Lobby', () => this.leave(), 'btn quiet'));
  }

  /** One base's card: its side and team, who sits there (or the host's choice for it), skill and ready. */
  private seat(l: LobbyInfo, s: LobbySlot, i: number, edit: boolean, me: string | undefined): HTMLElement {
    const sd = side(s.base);
    let team: HTMLElement;
    if (edit) {
      const sel = el('select', { ariaLabel: 'Team' });
      for (let t = 0; t < Math.min(MAX_BASES, l.slots.length); t++) sel.add(new Option(`Team ${TEAMS[t]}`, String(t), false, t === s.team));
      sel.addEventListener('change', () => this.net.send({ t: 'slot', slot: i, team: Number(sel.value) }));
      team = sel;
    } else team = badge(`Team ${TEAMS[s.team]}`, 'team');

    let who: HTMLElement;
    if (s.kind === 'human') who = el('span', { class: 'seat-name' }, s.user!.name, s.user!.id === me ? badge('You', 'you') : '', s.user!.id === l.owner ? badge('Host') : '');
    else if (edit) {
      const kind = el('select', { ariaLabel: 'Seat' });
      for (const [v, label] of [['open', 'Open seat'], ['bot', 'Computer'], ['closed', 'Closed']] as const) kind.add(new Option(label, v, false, v === s.kind));
      kind.addEventListener('change', () => this.net.send({ t: 'slot', slot: i, kind: kind.value as 'open' | 'bot' | 'closed' }));
      who = kind;
    } else if (s.kind === 'open' && l.state === 'waiting') who = button('Sit Here', () => this.net.send({ t: 'seat', slot: i }), 'btn default');
    else who = el('span', { class: 'seat-name muted' }, s.kind === 'bot' ? 'Computer' : s.kind === 'open' ? 'Open seat' : 'Closed');

    const extra = el('div', { class: 'seat-extra' });
    if (s.kind === 'bot') {
      if (edit) {
        const sel = skillSelect(s.difficulty ?? l.difficulty);
        sel.ariaLabel = 'Computer skill';
        sel.addEventListener('change', () => this.net.send({ t: 'slot', slot: i, difficulty: Number(sel.value) }));
        extra.append(el('label', { class: 'inline' }, 'Skill ', sel));
      } else extra.append(badge(`Skill ${s.difficulty ?? l.difficulty}`));
    }
    if (s.kind === 'human' && s.user!.id !== l.owner) extra.append(s.ready ? badge('Ready', 'ready') : badge('Not ready', 'wait'));
    if (edit && s.kind === 'human' && s.user!.id !== me) extra.append(button('Kick', () => this.net.send({ t: 'kick', user: s.user!.id }), 'btn quiet small'));

    const card = el('div', { class: `seat ${s.kind}` },
      el('div', { class: 'seat-side' }, el('span', { class: 'swatch' }), `Base ${s.base + 1} · ${sd.name}`, team),
      el('div', { class: 'seat-who' }, who), extra);
    card.style.setProperty('--side', sd.colour);
    return card;
  }
}

/** After a match: who won, and each seat's flags and losses. */
export async function results(r: MatchResult, start: MatchStart): Promise<void> {
  const winners = r.winner === null ? [] : r.seats.filter((s) => s.team === r.winner).map((s) => s.name);
  const title = r.aborted ? `Game over: ${r.aborted}` : (r.timeLimit ? 'Time limit: ' : '') + (r.winner === null ? 'A draw' : winners.length === 1 ? `${winners[0]} wins` : `Team ${TEAMS[r.winner]} wins (${winners.join(', ')})`);
  const rows = [...r.seats].sort((a, b) => a.team - b.team).map((s) => el('tr', { class: s.player === start.you ? 'picked' : '' },
    el('td', {}, `Team ${TEAMS[s.team]!}`),
    el('td', {}, s.name + (s.bot ? ' (computer)' : '') + (s.quit ? ' (left)' : '')),
    ...[s.captures, s.lost, s.left].map((v) => el('td', { class: 'num' }, String(v)))));
  const grid = el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, ...['Team', 'Player', 'Flags', 'Lost', 'Left'].map((h) => el('th', {}, h)))), el('tbody', {}, ...rows));
  await dialog('Results', el('div', { class: 'stack' }, el('div', { class: 'result-title' }, title), el('span', { class: 'hint' }, `Time ${formatTime(r.ticks * TICK_MS)}`),
    el('div', { class: 'scroll' }, grid)), [['Back to the Lobby', 'ok']]);
}

export function errorText(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : String(err);
}

/** A short message in the corner, for notices outside a match. */
export function toast(text: string): void {
  let box = document.querySelector<HTMLDivElement>('.toasts');
  if (!box) {
    box = el('div', { class: `toasts ${skinClass()}` });
    document.body.append(box);
  }
  const t = el('div', { class: 'toast', role: 'status' } as Partial<HTMLElement>, text);
  box.append(t);
  setTimeout(() => t.remove(), 6000);
}
