// Site settings the owner changes from the admin panel (admin-site): sign-up mode, maintenance, the
// message of the day and news, server limits, featured maps and defaults. Stored as JSON values by key.

import type { Db } from './db.js';

export interface SiteSettings {
  /** open: anyone may sign up; invite: only with an invite code; closed: nobody. */
  signups: 'open' | 'invite' | 'closed';
  /** Maintenance: new matches cannot start, and everyone sees the message counting down to at. */
  maintenance: { at: number; message: string } | null;
  /** Message of the day, shown on the title screen. */
  motd: string;
  news: { at: number; title: string; text: string }[];
  /** Matches running at once. */
  maxGames: number;
  /** WebSocket connections from one IP address. */
  maxPerIp: number;
  /** Map ids shown first in the lobby map picker. */
  featuredMaps: string[];
  defaultDifficulty: number;
  /** Chat: days kept in the log, words blanked out, and seconds between one player's messages (0 for none). */
  chatRetentionDays: number;
  wordFilter: string[];
  slowMode: number;
  /** Map library: maps one account may keep (staff can set one account's own limit), and words refused in shared
   * maps' names and descriptions (on top of the chat filter). */
  mapLimit: number;
  mapNameFilter: string[];
  /** Replays one account may keep on the server (0 turns saving them off). */
  replayLimit: number;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  signups: 'open', maintenance: null, motd: '', news: [], maxGames: 50, maxPerIp: 8, featuredMaps: [],
  defaultDifficulty: 5, chatRetentionDays: 30, wordFilter: [], slowMode: 0,
  mapLimit: 50, mapNameFilter: [], replayLimit: 30,
};

export class Settings {
  private cache: SiteSettings;
  private readonly listeners: ((s: SiteSettings) => void)[] = [];

  constructor(private readonly db: Db) {
    db.migrate('settings', ['CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)']);
    const stored = Object.fromEntries(db.all<{ key: string; value: string }>('SELECT key, value FROM settings').map((r) => [r.key, JSON.parse(r.value) as unknown]));
    // Keys no longer used (such as the old guests switch) are left out.
    const known = Object.fromEntries(Object.entries(stored).filter(([k]) => k in DEFAULT_SETTINGS));
    this.cache = { ...DEFAULT_SETTINGS, ...known } as SiteSettings;
  }

  get(): SiteSettings {
    return this.cache;
  }

  /** Saves the given keys; values are checked by the caller (admin.ts). */
  set(patch: Partial<SiteSettings>): SiteSettings {
    this.db.tx(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULT_SETTINGS)) continue;
        this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
      }
    });
    this.cache = { ...this.cache, ...patch };
    for (const l of this.listeners) l(this.cache);
    return this.cache;
  }

  onChange(fn: (s: SiteSettings) => void): void {
    this.listeners.push(fn);
  }
}
