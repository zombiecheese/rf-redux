// Replays in this browser: the last MAX_KEPT matches are kept in IndexedDB (a replay of a long online match runs to
// a few hundred KB, past what localStorage holds), plus any the player chose to keep. Replays → Watch plays one; it
// can also be saved as a .rfwreplay.json file and opened again here or in another browser, or, signed in, saved to
// the account on the server (packages/server/src/replays.ts) to watch from any browser. The replay format and
// player are in packages/net/src/replay.ts; the bar of controls over a playing replay is ReplayBar.

import { TICK_MS } from '@rfw/sim';
import { checkReplay, type Replay } from '@rfw/net';
import { dialog, el } from './dialogs.js';
import { api } from './online/api.js';
import { REPLAY_SPEEDS, type ReplayControl } from './game.js';
import { REPLAY_KEYS, keyName } from './keys.js';
import { formatTime } from './scores.js';

/** Replays kept without being picked to keep. */
const MAX_KEPT = 20;
const DB = 'rfw-replays';
const STORE = 'replays';

export interface ReplayEntry {
  id: number;
  replay: Replay;
  /** Picked to keep: not cleared out by newer ones. */
  kept: boolean;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function listReplays(): Promise<ReplayEntry[]> {
  try {
    const all = await run('readonly', (s) => s.getAll() as IDBRequest<ReplayEntry[]>);
    return all.sort((a, b) => b.replay.at - a.replay.at);
  } catch {
    return [];
  }
}

/** Keeps a finished match, and clears out the oldest beyond MAX_KEPT that were not picked to keep. */
export async function saveReplay(replay: Replay): Promise<void> {
  try {
    await run('readwrite', (s) => s.add({ replay, kept: false }));
    const old = (await listReplays()).filter((e) => !e.kept).slice(MAX_KEPT);
    for (const e of old) await deleteReplay(e.id);
  } catch {
    // No IndexedDB (a private window in some browsers): the match is not kept.
  }
}

export async function deleteReplay(id: number): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

export async function keepReplay(e: ReplayEntry, kept: boolean): Promise<void> {
  await run('readwrite', (s) => s.put({ ...e, kept }));
}

function fileName(r: Replay): string {
  const d = new Date(r.at);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${r.mapName.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'match'}-${stamp}.rfwreplay.json`;
}

export function downloadReplay(r: Replay): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
  const a = el('a', { href: url, download: fileName(r) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Asks for a .rfwreplay.json file; resolves with its replay, null if none was picked, or throws if it is not one. */
export function openReplayFile(): Promise<Replay | null> {
  return new Promise((resolve, reject) => {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((t) => resolve(checkReplay(JSON.parse(t))), () => reject(new Error('Could not read the file'))).catch(reject);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

const MODES: Record<Replay['mode'], string> = { training: 'Training', tournament: 'Split screen', online: 'Online', test: 'Test play' };

/** A replay saved to the signed-in account (packages/server/src/replays.ts). */
interface SavedReplay {
  id: string;
  at: number;
  mode: Replay['mode'];
  mapName: string;
  players: string[];
  frames: number;
}

/**
 * The Replays window: this browser's recent matches, and, signed in, the ones saved to the account. Resolves with
 * the replay to watch, or null.
 */
export async function replaysDialog(signedIn: boolean): Promise<Replay | null> {
  const local = el('tbody');
  const saved = el('tbody');
  const error = el('p', { class: 'hint warn' });
  let picked: Replay | null = null;
  const win = el('div', { class: 'stack replays' });
  const watch = (r: Replay) => {
    picked = r;
    win.dispatchEvent(new CustomEvent('dialog-done', { detail: 'watch', bubbles: true }));
  };
  const btn = (label: string, title: string, fn: () => unknown, cls = 'quiet') => {
    const b = el('button', { type: 'button', class: `btn small ${cls}`, title }, label);
    b.addEventListener('click', () => {
      error.textContent = '';
      Promise.resolve(fn()).catch((err: Error) => (error.textContent = err.message));
    });
    return b;
  };
  const row = (at: number, mode: Replay['mode'], mapName: string, players: string[], frames: number, ...buttons: HTMLElement[]) => el('tr', {},
    el('td', {}, new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })),
    el('td', {}, `${MODES[mode]}: ${mapName}`, el('div', { class: 'hint' }, players.join(', '))),
    el('td', { class: 'num' }, formatTime(frames * TICK_MS)),
    el('td', {}, el('div', { class: 'row' }, ...buttons)));
  const none = (text: string) => el('tr', {}, el('td', { class: 'none', colSpan: 4 }, text));
  let limit = 0;
  const fillSaved = async () => {
    if (!signedIn) return;
    const r = await api<{ replays: SavedReplay[]; limit: number }>('/api/replays').catch(() => null);
    limit = r?.limit ?? 0;
    saved.replaceChildren();
    if (!r) return void saved.append(none('Your saved replays cannot be reached right now.'));
    if (!r.replays.length) saved.append(none(limit ? `None yet. Press ☁ on a match above to save it here (up to ${limit}).` : 'This server does not keep replays.'));
    for (const x of r.replays) {
      const load = () => api<{ replay: Replay }>(`/api/replays/${encodeURIComponent(x.id)}`).then((a) => checkReplay(a.replay));
      saved.append(row(x.at, x.mode, x.mapName, x.players, x.frames,
        btn('Watch', 'Watch it', () => load().then(watch), 'default'),
        btn('File', 'Save as a file', () => load().then(downloadReplay)),
        btn('✕', 'Delete from your account', () => api(`/api/replays/${encodeURIComponent(x.id)}`, {}, 'DELETE').then(fillSaved))));
    }
  };
  const fillLocal = async () => {
    const list = await listReplays();
    local.replaceChildren();
    if (!list.length) local.append(none('No replays yet. Every match you play is kept here.'));
    for (const e of list) {
      const r = e.replay;
      local.append(row(r.at, r.mode, r.mapName, r.seats.map((x) => x.name), r.frames,
        btn('Watch', 'Watch it', () => watch(r), 'default'),
        btn('File', 'Save as a file', () => downloadReplay(r)),
        ...(signedIn ? [btn('☁', 'Save to your account', () => api('/api/replays', r).then(fillSaved))] : []),
        btn(e.kept ? '★' : '☆', e.kept ? 'Let it be cleared out' : `Keep it past the last ${MAX_KEPT}`, () => keepReplay(e, !e.kept).then(fillLocal)),
        btn('✕', 'Delete', () => deleteReplay(e.id).then(fillLocal))));
    }
  };
  await Promise.all([fillLocal(), fillSaved()]);
  const head = () => el('thead', {}, el('tr', {}, el('th', {}, 'Played'), el('th', {}, 'Match'), el('th', {}, 'Length'), el('th', {}, '')));
  const openFile = btn('Open a Replay File…', 'Watch a .rfwreplay.json file', () => openReplayFile().then((r) => r && watch(r)));
  openFile.classList.remove('small');
  win.append(
    el('h3', {}, 'In this browser'),
    el('div', { class: 'scroll' }, el('table', { class: 'grid' }, head(), local)),
    el('p', { class: 'hint' }, `The last ${MAX_KEPT} matches are kept in this browser, and any you star. Save one as a file to keep it anywhere or share it.`),
    ...(signedIn ? [el('h3', {}, 'On your account'), el('div', { class: 'scroll' }, el('table', { class: 'grid' }, head(), saved)),
      el('p', { class: 'hint' }, 'Replays saved to your account can be watched from any browser you sign in on.')] : []),
    openFile, error);
  const r = await dialog('Replays', win, [['Close', 'cancel']]);
  return r === 'watch' ? picked : null;
}

/** The controls over a playing replay: back, play and pause, on, speed, a timeline and who to follow. */
export class ReplayBar {
  readonly root = el('div', { class: 'ui replay-bar', role: 'toolbar' } as Partial<HTMLElement>);
  private readonly time = el('span', { class: 'time' });
  private readonly speedText = el('span', { class: 'speed' });
  private readonly slider = el('input', { type: 'range', min: '0', step: '1' });
  private readonly playBtn = el('button', { type: 'button', class: 'btn small' });
  private readonly warning = el('span', { class: 'hint warn' });
  private readonly followers: HTMLButtonElement[] = [];
  private raf = 0;
  private dragging = false;

  constructor(private readonly ctl: ReplayControl, replay: Replay, private readonly paused: () => boolean, togglePause: () => void,
    leave: () => void) {
    const jump = Math.round(10_000 / TICK_MS);
    const button = (label: string, title: string, fn: () => void) => {
      const b = el('button', { type: 'button', class: 'btn small', title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const step = (dir: number) => {
      const at = REPLAY_SPEEDS.indexOf(ctl.speed as (typeof REPLAY_SPEEDS)[number]);
      ctl.setSpeed(REPLAY_SPEEDS[Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, at + dir))]!);
    };
    this.playBtn.title = 'Pause / play (P)';
    this.playBtn.addEventListener('click', togglePause);
    this.slider.max = String(replay.frames);
    this.slider.setAttribute('aria-label', 'Position');
    this.slider.addEventListener('input', () => (this.dragging = true));
    this.slider.addEventListener('change', () => {
      this.dragging = false;
      ctl.seek(Number(this.slider.value));
    });
    const follow = el('div', { class: 'row follow' });
    replay.seats.forEach((s, i) => {
      const b = button(s.name, `Follow ${s.name} (${i + 1})`, () => ctl.follow(i));
      this.followers.push(b);
      follow.append(b);
    });
    const k = REPLAY_KEYS;
    this.root.append(
      el('div', { class: 'row' },
        button('⏪', `Ten seconds back (${keyName(k.back[0])})`, () => ctl.seek(ctl.frame - jump)),
        this.playBtn,
        button('⏩', `Ten seconds on (${keyName(k.forward[0])})`, () => ctl.seek(ctl.frame + jump)),
        button('−', `Slower (${keyName(k.slower[0])})`, () => step(-1)), this.speedText, button('+', `Faster (${keyName(k.faster[0])})`, () => step(1)),
        this.time, button('✕', 'Leave the replay (Esc)', leave)),
      this.slider, follow, this.warning);
    // Clicks on the bar are the bar's, not a tap on the game.
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(this.root);
    const tick = () => {
      this.update();
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  private update(): void {
    const { ctl } = this;
    if (!this.dragging) this.slider.value = String(ctl.frame);
    this.time.textContent = `${formatTime(ctl.frame * TICK_MS)} / ${formatTime(ctl.frames * TICK_MS)}`;
    this.speedText.textContent = `${ctl.speed}×`;
    this.playBtn.textContent = this.paused() ? '▶' : '❚❚';
    this.followers.forEach((b, i) => b.classList.toggle('default', i === ctl.watching));
    this.warning.textContent = ctl.outOfStep ? 'Recorded on another version of the game: this may not be what happened.' : '';
  }

  close(): void {
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }
}
