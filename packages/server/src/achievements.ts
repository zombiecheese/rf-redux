// Achievements kept on a signed-in player's account (net/achievements.ts has the list and the rules).
//
// Online matches are tallied here, from the server's own copy of the match (room.ts), and only they can unlock
// the online achievements or add to their counters. A browser sends its offline matches' tallies, the menu
// achievements and, once on signing in, a guest's progress from before; those are bounded and can never reach the
// online ones.

import { award, cleanProgress, cleanTally, emptyProgress, type Progress, type Tally } from '@rfw/net';
import type { Db } from './db.js';
import { HttpError, requireUser, type App } from './http.js';
import { Limiter } from './limits.js';

export class Achievements {
  /** A tally after each offline match or menu action: a few a minute is plenty. */
  private readonly limit = new Limiter(1 / 5, 20);

  constructor(private readonly db: Db) {
    db.migrate('achievements', [
      `CREATE TABLE achievements (
        user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE, progress TEXT NOT NULL, updated INTEGER NOT NULL
      );`,
    ]);
  }

  get(userId: string): Progress {
    const r = this.db.get<{ progress: string }>('SELECT progress FROM achievements WHERE user_id = ?', userId);
    return r ? cleanProgress(JSON.parse(r.progress)) : emptyProgress();
  }

  /** How many a player has unlocked, for profiles. */
  count(userId: string): number {
    return Object.keys(this.get(userId).unlocked).length;
  }

  /** Adds a tally to a player's progress and returns what it unlocked. trusted: from the server's own match. */
  apply(userId: string, tally: Tally, trusted: boolean): { progress: Progress; fresh: string[] } {
    return this.db.tx(() => {
      const progress = this.get(userId);
      const fresh = award(progress, trusted ? tally : cleanTally(tally), Date.now(), trusted);
      this.db.run('INSERT INTO achievements (user_id, progress, updated) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET progress = excluded.progress, updated = excluded.updated',
        userId, JSON.stringify(progress), Date.now());
      return { progress, fresh };
    });
  }

  install(app: App): void {
    app.route('GET', '/api/achievements', (ctx) => ({ progress: this.get(requireUser(ctx).id) }));

    // An offline match's tally, a menu achievement, or a guest's progress handed over on signing in.
    app.route('POST', '/api/achievements', (ctx) => {
      const me = requireUser(ctx);
      if (!this.limit.take(me.id)) throw new HttpError(429, 'Too many achievement updates; try again in a minute');
      return this.apply(me.id, cleanTally(ctx.body.tally), false);
    });
  }
}
