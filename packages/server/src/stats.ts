// Player profiles, stats and leaderboards (profiles, leaderboards). A profile keeps a signed-in player's settings
// (key bindings, difficulty, volume, solo progress) as the client sends them, plus stats from online matches: wins,
// losses, flags captured, vehicles lost and the vehicle launched most. The online ladder rates signed-in players
// (Elo, starting at 1000) from matches with at least two signed-in players on opposing teams. Solo best times are
// accepted only after the server has replayed the run in the sim (net/solo.ts) and seen the player win.

import { TICK_MS, VEHICLE_KINDS } from '@rfw/sim';
import { SOLO_MAX_TICKS, replaySolo, type MatchResult, type SoloLog } from '@rfw/net';
import type { Accounts } from './accounts.js';
import type { Chat } from './chat.js';
import type { Db } from './db.js';
import { HttpError, requireUser, type App } from './http.js';
import { Limiter } from './limits.js';
import type { Maps } from './maps.js';

const START_RATING = 1000;
const K = 32;
const MAX_SETTINGS = 16 * 1024;

export interface PlayerStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  quits: number;
  captures: number;
  lost: number;
  rating: number;
  rated: number;
  launches: number[];
  favourite: string | null;
}

interface StatsRow {
  user_id: string; games: number; wins: number; losses: number; draws: number; quits: number; captures: number; lost: number;
  rating: number; rated: number; launches: string;
}

function toStats(r: StatsRow | undefined): PlayerStats {
  const launches = r ? (JSON.parse(r.launches) as number[]) : VEHICLE_KINDS.map(() => 0);
  const top = Math.max(...launches);
  return {
    games: r?.games ?? 0, wins: r?.wins ?? 0, losses: r?.losses ?? 0, draws: r?.draws ?? 0, quits: r?.quits ?? 0, captures: r?.captures ?? 0,
    lost: r?.lost ?? 0, rating: r?.rating ?? START_RATING, rated: r?.rated ?? 0, launches, favourite: top > 0 ? VEHICLE_KINDS[launches.indexOf(top)]! : null,
  };
}

export class Stats {
  private readonly soloLimit = new Limiter(1 / 30, 3);
  private replaying: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: Db, private readonly accounts: Accounts, private readonly maps: Maps, private readonly chat: Chat) {
    db.migrate('stats', [
      `CREATE TABLE profiles (user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE, settings TEXT NOT NULL DEFAULT '{}', updated INTEGER NOT NULL);
      CREATE TABLE player_stats (
        user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, quits INTEGER NOT NULL DEFAULT 0, captures INTEGER NOT NULL DEFAULT 0,
        lost INTEGER NOT NULL DEFAULT 0, rating REAL NOT NULL DEFAULT ${START_RATING}, rated INTEGER NOT NULL DEFAULT 0, launches TEXT NOT NULL DEFAULT '[0,0,0,0]'
      );
      CREATE TABLE games (
        id TEXT PRIMARY KEY, at INTEGER NOT NULL, map_id TEXT NOT NULL, map_name TEXT NOT NULL, ticks INTEGER NOT NULL,
        winner INTEGER, aborted TEXT, seats TEXT NOT NULL
      );
      CREATE INDEX games_at ON games (at);
      CREATE TABLE game_players (game_id TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE, user_id TEXT NOT NULL, PRIMARY KEY (game_id, user_id));
      CREATE INDEX game_players_user ON game_players (user_id);
      CREATE TABLE solo_times (
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, map_id TEXT NOT NULL, difficulty INTEGER NOT NULL, ms INTEGER NOT NULL,
        at INTEGER NOT NULL, PRIMARY KEY (user_id, map_id, difficulty)
      );
      CREATE INDEX solo_times_map ON solo_times (map_id, difficulty, ms);`,
    ]);
  }

  stats(userId: string): PlayerStats {
    return toStats(this.db.get<StatsRow>('SELECT * FROM player_stats WHERE user_id = ?', userId));
  }

  /** Records a finished match: the game, each signed-in player's stats, and ladder ratings. */
  record(result: MatchResult, mapId: string, mapName: string): void {
    const accounts = result.seats.filter((s) => s.userId && !s.bot && this.accounts.byId(s.userId));
    this.db.tx(() => {
      this.db.run('INSERT OR REPLACE INTO games (id, at, map_id, map_name, ticks, winner, aborted, seats) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        result.gameId, Date.now(), mapId, mapName, result.ticks, result.winner, result.aborted ?? null, JSON.stringify(result.seats));
      for (const s of accounts) {
        this.db.run('INSERT OR IGNORE INTO game_players (game_id, user_id) VALUES (?, ?)', result.gameId, s.userId!);
        const old = this.stats(s.userId!);
        const won = result.winner !== null && s.team === result.winner;
        const drew = result.winner === null && !result.aborted;
        const launches = old.launches.map((n, i) => n + (s.launches[i] ?? 0));
        this.db.run(
          `INSERT INTO player_stats (user_id, games, wins, losses, draws, quits, captures, lost, launches) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET games = games + 1, wins = wins + excluded.wins, losses = losses + excluded.losses,
           draws = draws + excluded.draws, quits = quits + excluded.quits, captures = captures + excluded.captures, lost = lost + excluded.lost,
           launches = excluded.launches`,
          s.userId!, won ? 1 : 0, !won && !drew && !result.aborted ? 1 : 0, drew ? 1 : 0, s.quit ? 1 : 0, s.captures, s.lost, JSON.stringify(launches),
        );
      }
      this.rate(result, accounts.map((s) => s.userId!));
    });
  }

  /** Elo by team averages, for matches with signed-in players on at least two teams and a winner. */
  private rate(result: MatchResult, users: string[]): void {
    if (result.winner === null || result.aborted) return;
    const seats = result.seats.filter((s) => s.userId && users.includes(s.userId));
    const teams = new Map<number, string[]>();
    for (const s of seats) teams.set(s.team, [...(teams.get(s.team) ?? []), s.userId!]);
    if (teams.size < 2 || !teams.has(result.winner)) return;
    const rating = (u: string) => this.stats(u).rating;
    const avg = (us: string[]) => us.reduce((a, u) => a + rating(u), 0) / us.length;
    const winners = teams.get(result.winner)!;
    const losers = [...teams.entries()].filter(([t]) => t !== result.winner).flatMap(([, us]) => us);
    const expected = 1 / (1 + 10 ** ((avg(losers) - avg(winners)) / 400));
    const delta = K * (1 - expected);
    for (const u of winners) this.db.run('UPDATE player_stats SET rating = rating + ?, rated = rated + 1 WHERE user_id = ?', delta, u);
    for (const u of losers) this.db.run('UPDATE player_stats SET rating = rating - ?, rated = rated + 1 WHERE user_id = ?', delta / Math.max(1, losers.length / winners.length), u);
  }

  ladder(limit = 50): { name: string; rating: number; wins: number; losses: number; games: number }[] {
    return this.db.all<{ name: string; rating: number; wins: number; losses: number; games: number }>(
      `SELECT u.name, s.rating, s.wins, s.losses, s.games FROM player_stats s JOIN users u ON u.id = s.user_id
       WHERE s.rated > 0 AND u.banned = 0 ORDER BY s.rating DESC LIMIT ?`, limit,
    ).map((r) => ({ ...r, rating: Math.round(r.rating) }));
  }

  soloBoard(mapId: string, difficulty?: number, limit = 20): { name: string; ms: number; difficulty: number; at: number }[] {
    return this.db.all<{ name: string; ms: number; difficulty: number; at: number }>(
      `SELECT u.name, t.ms, t.difficulty, t.at FROM solo_times t JOIN users u ON u.id = t.user_id
       WHERE t.map_id = ? ${difficulty ? 'AND t.difficulty = ?' : ''} AND u.banned = 0 ORDER BY t.ms LIMIT ?`,
      ...(difficulty ? [mapId, difficulty, limit] : [mapId, limit]),
    );
  }

  recentGames(userId: string | null, limit = 20): { id: string; at: number; mapName: string; ticks: number; winner: number | null; aborted: string | null; seats: unknown }[] {
    const rows = userId
      ? this.db.all<{ id: string; at: number; map_name: string; ticks: number; winner: number | null; aborted: string | null; seats: string }>(
        'SELECT g.* FROM games g JOIN game_players p ON p.game_id = g.id WHERE p.user_id = ? ORDER BY g.at DESC LIMIT ?', userId, limit)
      : this.db.all<{ id: string; at: number; map_name: string; ticks: number; winner: number | null; aborted: string | null; seats: string }>(
        'SELECT * FROM games ORDER BY at DESC LIMIT ?', limit);
    return rows.map((r) => ({ id: r.id, at: r.at, mapName: r.map_name, ticks: r.ticks, winner: r.winner, aborted: r.aborted, seats: JSON.parse(r.seats) }));
  }

  /** Replays a solo run (one at a time, in slices so matches keep their clock) and keeps the time if it won. */
  async submitSolo(userId: string, log: SoloLog): Promise<{ ms: number; best: boolean }> {
    const map = this.maps.get(log.mapId);
    if (!map || !this.maps.builtIn(log.mapId)) throw new HttpError(400, 'Times are kept for the built-in maps only');
    const total = log.runs.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    if (total > SOLO_MAX_TICKS) throw new HttpError(400, 'That run is too long');
    const run = this.replaying.then(() => new Promise<ReturnType<typeof replaySolo>>((resolve, reject) => setImmediate(() => {
      try {
        resolve(replaySolo(log, map, this.maps.defs, this.maps.shore));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    })));
    this.replaying = run.catch(() => {});
    const m = await run;
    if (m.winner !== 0) throw new HttpError(400, 'The replay did not end in a win');
    const ms = m.tick * TICK_MS;
    const old = this.db.get<{ ms: number }>('SELECT ms FROM solo_times WHERE user_id = ? AND map_id = ? AND difficulty = ?', userId, log.mapId, log.difficulty);
    if (old && old.ms <= ms) return { ms, best: false };
    this.db.run('INSERT INTO solo_times (user_id, map_id, difficulty, ms, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET ms = excluded.ms, at = excluded.at',
      userId, log.mapId, log.difficulty, ms, Date.now());
    return { ms, best: true };
  }

  install(app: App): void {
    app.route('GET', '/api/profile', (ctx) => {
      const me = requireUser(ctx);
      const p = this.db.get<{ settings: string }>('SELECT settings FROM profiles WHERE user_id = ?', me.id);
      return { user: me, settings: p ? JSON.parse(p.settings) : {}, stats: this.stats(me.id), blocked: [...this.chat.blocked(me.id)] };
    });

    app.route('PUT', '/api/profile', (ctx) => {
      const me = requireUser(ctx);
      const settings = ctx.body.settings;
      const text = JSON.stringify(settings ?? {});
      if (typeof settings !== 'object' || settings === null || Array.isArray(settings) || text.length > MAX_SETTINGS) throw new HttpError(400, 'Settings must be a small JSON object');
      this.db.run('INSERT INTO profiles (user_id, settings, updated) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET settings = excluded.settings, updated = excluded.updated',
        me.id, text, Date.now());
      return { ok: true };
    });

    app.route('GET', '/api/players/:name', (ctx) => {
      const u = this.accounts.byName(ctx.params.name!);
      if (!u || u.banned) throw new HttpError(404, 'No such player');
      return { name: u.name, joined: u.created, role: u.role, stats: this.stats(u.id), games: this.recentGames(u.id, 10) };
    });

    app.route('POST', '/api/players/:name/block', (ctx) => {
      const me = requireUser(ctx);
      const u = this.accounts.byName(ctx.params.name!);
      if (!u) throw new HttpError(404, 'No such player');
      this.chat.setBlocked(me.id, u.id, ctx.body.blocked !== false);
      return { ok: true };
    });

    app.route('GET', '/api/leaderboards/ladder', () => ({ ladder: this.ladder() }));

    app.route('GET', '/api/leaderboards/solo/:map', (ctx) => {
      const d = Number(ctx.query.get('difficulty') ?? 0);
      return { times: this.soloBoard(ctx.params.map!, Number.isInteger(d) && d >= 1 && d <= 9 ? d : undefined) };
    });

    app.route('POST', '/api/solo', async (ctx) => {
      const me = requireUser(ctx);
      if (!this.soloLimit.take(me.id)) throw new HttpError(429, 'Too many runs sent; try again in a minute');
      const log = ctx.body as unknown as SoloLog;
      const ok = typeof log.mapId === 'string' && Number.isInteger(log.seed) && Number.isInteger(log.difficulty) && log.difficulty >= 1 && log.difficulty <= 9
        && Array.isArray(log.runs) && log.runs.every((n) => Number.isInteger(n) && n >= 0 && n < 0x10000000)
        && Array.isArray(log.commands) && log.commands.every((c) => Array.isArray(c) && c.length === 2 && c.every((n) => Number.isInteger(n) && n >= 0));
      if (!ok) throw new HttpError(400, 'Not a solo run');
      return this.submitSolo(me.id, log);
    });

    app.route('GET', '/api/games/recent', () => ({ games: this.recentGames(null, 20) }));
  }
}
