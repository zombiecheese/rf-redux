// The player's achievements (net/achievements.ts has the list and the rules), the Achievements screen and the
// pop-up when one unlocks.
//
// A guest's progress lives in this browser (localStorage). A signed-in player's lives on their account: offline
// matches and menu achievements are sent to the server as tallies (kept in a queue until it takes them, so one
// made offline is not lost), and online matches are tallied by the server itself, which says what they unlocked.
// On signing in, a guest's progress so far is handed to the account once and then belongs to it.
// Everything still works without storage: progress then lasts until the page is closed.

import {
  ACHIEVEMENTS, ACHIEVEMENT_BY_ID, GROUPS, award, cleanProgress, emptyTally, progressAsTally, progressOf,
  type Achievement, type Progress, type Tally,
} from '@rfw/net';
import { dialog, el } from './dialogs.js';
import { api } from './online/api.js';

const GUEST_KEY = 'rf.achievements';
const userKey = (id: string) => `rf.achievements.user.${id}`;
const queueKey = (id: string) => `rf.achievements.queue.${id}`;

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: progress lasts for this visit.
  }
}

const isEmpty = (p: Progress) => !Object.keys(p.unlocked).length && !Object.keys(p.counters).length && !Object.keys(p.sets).length;
const tallyEmpty = (t: Tally) => !t.earned.length && !Object.keys(t.counters).length && !Object.keys(t.sets).length;

type Listener = () => void;

class AchievementStore {
  /** The signed-in player's id, or null for a guest. */
  private user: string | null = null;
  private progress: Progress = cleanProgress(read(GUEST_KEY));
  private sending = false;
  private readonly listeners = new Set<Listener>();

  get signedIn(): boolean {
    return this.user !== null;
  }

  get current(): Progress {
    return this.progress;
  }

  get count(): number {
    return Object.keys(this.progress.unlocked).length;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Who is playing: a signed-in account (by id) or a guest (null). Signing in hands any guest progress to the
   * account, once, and fetches the account's own.
   */
  async account(userId: string | null): Promise<void> {
    if (userId === this.user) return;
    this.user = userId;
    if (!userId) {
      this.progress = cleanProgress(read(GUEST_KEY));
      this.changed();
      return;
    }
    this.progress = cleanProgress(read(userKey(userId)));
    const guest = cleanProgress(read(GUEST_KEY));
    if (!isEmpty(guest)) {
      // Into the account's queue before it leaves the guest's store, so a failed send keeps it.
      const queue = read<Tally[]>(queueKey(userId)) ?? [];
      write(queueKey(userId), [...queue, progressAsTally(guest)]);
      write(GUEST_KEY, null);
      const carried = Object.keys(guest.unlocked).filter((id) => !this.progress.unlocked[id]).length;
      if (carried) notify(`${carried} achievement${carried === 1 ? '' : 's'} carried over to your account`);
    }
    this.changed();
    await this.flush();
    if (this.user === userId) await this.refresh();
  }

  /** For a page without the game's connection (the level editor): asks the server who is signed in, if there is one. */
  async identify(): Promise<void> {
    const r = await api<{ user: { id: string; guest?: boolean } | null }>('/api/me').catch(() => null);
    await this.account(r?.user && !r.user.guest ? r.user.id : null);
  }

  /** Fetches the account's progress from the server (after an online match, or on signing in). */
  async refresh(): Promise<void> {
    const user = this.user;
    if (!user) return;
    const r = await api<{ progress: unknown }>('/api/achievements').catch(() => null);
    if (!r || this.user !== user) return;
    // What is still queued here has not reached the server yet: keep showing it.
    const p = cleanProgress(r.progress);
    for (const t of read<Tally[]>(queueKey(user)) ?? []) award(p, t, Date.now());
    this.progress = p;
    write(userKey(user), p);
    this.changed();
  }

  /** Adds what an offline match or a menu action earned; shows what it unlocks. */
  record(t: Tally): void {
    if (tallyEmpty(t)) return;
    const fresh = award(this.progress, t);
    if (this.user) {
      write(userKey(this.user), this.progress);
      write(queueKey(this.user), [...(read<Tally[]>(queueKey(this.user)) ?? []), t]);
      void this.flush();
    } else {
      write(GUEST_KEY, this.progress);
    }
    for (const id of fresh) unlockedToast(id);
    this.changed();
  }

  /** One of the achievements earned outside a match (a replay watched, a map saved, the thermal camera at night). */
  unlock(id: string): void {
    if (this.progress.unlocked[id] || !ACHIEVEMENT_BY_ID.has(id)) return;
    this.record({ ...emptyTally(), earned: [id] });
  }

  /** The server unlocked these from an online match. */
  fromServer(ids: string[]): void {
    for (const id of ids) {
      if (!ACHIEVEMENT_BY_ID.has(id)) continue;
      this.progress.unlocked[id] ??= Date.now();
      unlockedToast(id);
    }
    if (this.user) write(userKey(this.user), this.progress);
    this.changed();
    void this.refresh();
  }

  /** Sends the queued tallies to the account, oldest first; what the server will not take now waits for next time. */
  private async flush(): Promise<void> {
    const user = this.user;
    if (!user || this.sending) return;
    this.sending = true;
    try {
      for (;;) {
        const queue = read<Tally[]>(queueKey(user)) ?? [];
        if (!queue.length || this.user !== user) break;
        const r = await api<{ progress: unknown }>('/api/achievements', { tally: queue[0] }).catch(() => null);
        if (!r) break;
        write(queueKey(user), (read<Tally[]>(queueKey(user)) ?? []).slice(1));
      }
    } finally {
      this.sending = false;
    }
  }
}

export const achievements = new AchievementStore();

// ---- The pop-up ---------------------------------------------------------------------------------------------------

function toastBox(): HTMLElement {
  let box = document.querySelector<HTMLElement>('.achievement-toasts');
  if (!box) {
    box = el('div', { class: 'achievement-toasts', ariaLive: 'polite' } as Partial<HTMLElement>);
    document.body.append(box);
  }
  return box;
}

/** A short line in the achievements' pop-up style (a guest's progress carried over). */
function notify(text: string): void {
  const t = el('div', { class: 'achievement-toast note', role: 'status' } as Partial<HTMLElement>, el('span', { class: 'ach-name' }, text));
  toastBox().append(t);
  setTimeout(() => t.remove(), 5000);
}

/**
 * The pop-up for one achievement. Modern: a computer-vision lock-on box with a tag; classic: a pixel panel with the
 * game's letters (themes.css dresses both from body[data-visuals]).
 */
export function unlockedToast(id: string): void {
  const x = ACHIEVEMENT_BY_ID.get(id);
  if (!x) return;
  const t = el('div', { class: `achievement-toast group-${x.group}`, role: 'status' } as Partial<HTMLElement>,
    el('span', { class: 'ach-tag' }, 'Achievement unlocked'),
    el('span', { class: 'ach-icon', ariaHidden: 'true' } as Partial<HTMLElement>, groupMark(x)),
    el('span', { class: 'ach-name' }, x.name),
    el('span', { class: 'ach-text' }, x.text));
  toastBox().append(t);
  // One after another reads better than a stack shown all at once.
  const delay = (toastBox().children.length - 1) * 350;
  // Both animations: in after the ones before it, out six seconds later (ui.css).
  t.style.animationDelay = `${delay}ms, ${6000 + delay}ms`;
  setTimeout(() => t.remove(), 6500 + delay);
}

/** A letter-mark for each group, drawn in the panel's ink in both looks. */
function groupMark(x: Achievement): string {
  return { missions: '★', combat: '✛', demolition: '▲', flags: '⚑', vehicles: '◆', online: '◎', extras: '●' }[x.group];
}

// ---- The screen -------------------------------------------------------------------------------------------------

/** Achievements: every one by group, unlocked or not, with progress towards those that count. */
export async function achievementsDialog(): Promise<void> {
  const p = achievements.current;
  const total = ACHIEVEMENTS.length;
  const got = Object.keys(p.unlocked).length;
  const bar = (have: number, goal: number) => {
    const fill = el('span', { class: 'ach-fill' });
    fill.style.width = `${Math.round((have / goal) * 100)}%`;
    return el('span', { class: 'ach-bar', role: 'progressbar', ariaValueNow: String(have), ariaValueMax: String(goal) } as Partial<HTMLElement>, fill);
  };
  const list = el('div', { class: 'ach-list' });
  for (const g of GROUPS) {
    const items = ACHIEVEMENTS.filter((x) => x.group === g.id);
    const done = items.filter((x) => p.unlocked[x.id]).length;
    list.append(el('h3', { class: 'ach-group' }, el('span', {}, g.name), el('span', { class: 'ach-count' }, `${done} / ${items.length}`)));
    for (const x of items) {
      const at = p.unlocked[x.id];
      if (x.hidden && !at) {
        list.append(el('div', { class: 'ach-row hidden' },
          el('span', { class: 'ach-icon', ariaHidden: 'true' } as Partial<HTMLElement>, '?'),
          el('span', { class: 'ach-name' }, 'Hidden achievement'),
          el('span', { class: 'ach-text' }, 'One of the hardest. Keep playing to find out what it is.'),
          el('span', { class: 'ach-state' }, 'Classified')));
        continue;
      }
      const prog = progressOf(p, x);
      list.append(el('div', { class: `ach-row${at ? ' got' : ''}` },
        el('span', { class: 'ach-icon', ariaHidden: 'true' } as Partial<HTMLElement>, at ? groupMark(x) : '?'),
        el('span', { class: 'ach-name' }, x.name),
        el('span', { class: 'ach-text' }, x.text + (x.online ? ' (online)' : '')),
        el('span', { class: 'ach-state' }, at ? new Date(at).toLocaleDateString() : prog ? `${prog[0]} / ${prog[1]}` : 'Locked'),
        ...(prog && !at ? [bar(prog[0], prog[1])] : [])));
    }
  }
  const where = achievements.signedIn
    ? 'Saved to your account.'
    : 'Kept in this browser. Sign in (Online) to keep them on your account; what you have so far comes with you.';
  const head = el('div', { class: 'ach-head' },
    el('span', { class: 'ach-total' }, `${got} / ${total}`), bar(got, total), el('span', { class: 'ach-where' }, where));
  await dialog('Achievements', el('div', { class: 'stack achievements' }, head, el('div', { class: 'scroll' }, list)), [['Close', 'ok']]);
}
