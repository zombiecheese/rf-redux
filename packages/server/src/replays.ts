// Replays signed-in players save to their account, so they can watch them from any browser. The browser keeps its
// own recent replays too (client replays.ts); this is the copy a player chose to save. A replay is private to its
// owner and stored gzipped. The site setting replayLimit caps how many one account keeps (0 turns saving off).

import { randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { checkReplay, type Replay } from '@rfw/net';
import type { Db } from './db.js';
import { HttpError, requireUser, type App } from './http.js';
import type { Settings } from './settings.js';

/** Request body limit for an upload: about an hour of a four-player match. */
export const REPLAY_BODY_LIMIT = 8 << 20;

/** A saved replay as the list shows it. */
export interface ReplaySummary {
  id: string;
  at: number;
  mode: Replay['mode'];
  mapName: string;
  players: string[];
  frames: number;
  saved: number;
}

interface Row {
  id: string;
  at: number;
  mode: string;
  map_name: string;
  players: string;
  frames: number;
  saved: number;
}

const summary = (r: Row): ReplaySummary => ({
  id: r.id, at: r.at, mode: r.mode as Replay['mode'], mapName: r.map_name, players: JSON.parse(r.players) as string[], frames: r.frames, saved: r.saved,
});

export class Replays {
  constructor(private readonly db: Db, private readonly settings: Settings) {
    db.migrate('replays', [
      `CREATE TABLE replays (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, at INTEGER NOT NULL, mode TEXT NOT NULL,
        map_name TEXT NOT NULL, players TEXT NOT NULL, frames INTEGER NOT NULL, saved INTEGER NOT NULL, data BLOB NOT NULL
      );
      CREATE INDEX replays_user ON replays (user_id, saved);`,
    ]);
  }

  list(userId: string): ReplaySummary[] {
    return this.db.all<Row>('SELECT id, at, mode, map_name, players, frames, saved FROM replays WHERE user_id = ? ORDER BY at DESC', userId).map(summary);
  }

  save(userId: string, body: unknown): ReplaySummary {
    const limit = this.settings.get().replayLimit;
    if (limit <= 0) throw new HttpError(403, 'Saving replays is turned off on this server');
    let r: Replay;
    try {
      r = checkReplay(body);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    const count = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM replays WHERE user_id = ?', userId)!.n;
    if (count >= limit) throw new HttpError(409, `Your account keeps up to ${limit} replays: delete one to save another`);
    // The same match saved twice is kept once.
    const same = this.db.get<Row>('SELECT id, at, mode, map_name, players, frames, saved FROM replays WHERE user_id = ? AND at = ? AND frames = ?', userId, r.at, r.frames);
    if (same) return summary(same);
    const row: Row = {
      id: randomBytes(9).toString('base64url'), at: Math.trunc(r.at), mode: r.mode, map_name: String(r.mapName).slice(0, 100),
      players: JSON.stringify(r.seats.map((s) => String(s.name).slice(0, 40))), frames: r.frames, saved: Date.now(),
    };
    this.db.run('INSERT INTO replays (id, user_id, at, mode, map_name, players, frames, saved, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      row.id, userId, row.at, row.mode, row.map_name, row.players, row.frames, row.saved, gzipSync(JSON.stringify(r)));
    return summary(row);
  }

  get(userId: string, id: string): Replay | null {
    const r = this.db.get<{ data: Uint8Array }>('SELECT data FROM replays WHERE id = ? AND user_id = ?', id, userId);
    return r ? (JSON.parse(gunzipSync(r.data).toString('utf8')) as Replay) : null;
  }

  delete(userId: string, id: string): boolean {
    return this.db.run('DELETE FROM replays WHERE id = ? AND user_id = ?', id, userId).changes > 0;
  }

  install(app: App): void {
    app.route('GET', '/api/replays', (ctx) => {
      const me = requireUser(ctx);
      return { replays: this.list(me.id), limit: this.settings.get().replayLimit };
    });
    app.route('POST', '/api/replays', (ctx) => ({ replay: this.save(requireUser(ctx).id, ctx.body) }));
    app.route('GET', '/api/replays/:id', (ctx) => {
      const r = this.get(requireUser(ctx).id, ctx.params.id!);
      if (!r) throw new HttpError(404, 'No such replay');
      return { replay: r };
    });
    app.route('DELETE', '/api/replays/:id', (ctx) => {
      if (!this.delete(requireUser(ctx).id, ctx.params.id!)) throw new HttpError(404, 'No such replay');
      return { ok: true };
    });
  }
}
