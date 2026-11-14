// The map library (ed-library, ed-browse, ed-moderation): maps made in the level editor, kept on the server with
// their past revisions and a small picture. A map is private (only its author), unlisted (anyone with its id) or
// public (listed in the browser for everyone to search, like and report). Lobbies can use any map their owner may
// see, through the Maps source added here. Moderators hide reported maps; admins also feature or delete them and
// set how many maps an account may keep. Every staff action goes to the audit log.

import { randomBytes } from 'node:crypto';
import type { Identity } from '@rfw/net';
import { VISIBILITIES, mapErrors, parseMap, type MapVisibility, type RfwMap } from '@rfw/sim';
import type { Accounts } from './accounts.js';
import type { Audit } from './audit.js';
import type { Db } from './db.js';
import { HttpError, hasRole, int, requireRole, requireUser, str, type App, type Ctx } from './http.js';
import { Limiter } from './limits.js';
import type { Maps } from './maps.js';
import type { Settings } from './settings.js';

/** Past revisions kept for each map. */
export const KEEP_REVISIONS = 20;
/** The largest picture accepted for a map (a PNG). */
export const MAX_THUMB = 48 * 1024;
/** Request body limit for uploads: a 128 × 128 map with every tile built on stays well under this. */
export const MAP_BODY_LIMIT = 2 << 20;
const PAGE = 30;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type MapSort = 'new' | 'likes' | 'plays' | 'name';
const SORTS: Record<MapSort, string> = {
  new: 'm.published DESC, m.updated DESC',
  likes: 'm.likes DESC, m.plays DESC, m.published DESC',
  plays: 'm.plays DESC, m.likes DESC, m.published DESC',
  name: 'm.name COLLATE NOCASE, m.published DESC',
};

/** A map as lists show it (no terrain). */
export interface LibraryEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  authorId: string;
  visibility: MapVisibility;
  revision: number;
  width: number;
  height: number;
  bases: number;
  players: { min: number; max: number };
  /** False while the map has errors (only private maps may); such maps cannot be played. */
  playable: boolean;
  plays: number;
  likes: number;
  liked: boolean;
  featured: boolean;
  hidden: boolean;
  /** Why staff hid it, shown to its author. */
  hiddenReason: string;
  created: number;
  updated: number;
  published: number | null;
  hasThumb: boolean;
}

interface MapRow {
  id: string; owner: string; owner_name: string; name: string; description: string; visibility: MapVisibility; revision: number;
  width: number; height: number; bases: number; min_players: number; max_players: number; playable: number; plays: number; likes: number;
  liked: number | null; featured: number; hidden: number; hidden_reason: string; created: number; updated: number; published: number | null;
  has_thumb: number; reports?: number;
}

const COLUMNS = `m.id, m.owner, u.name AS owner_name, m.name, m.description, m.visibility, m.revision, m.width, m.height, m.bases,
  m.min_players, m.max_players, m.playable, m.plays, m.likes, m.featured, m.hidden, m.hidden_reason, m.created, m.updated, m.published,
  length(m.thumb) > 0 AS has_thumb`;

function entry(r: MapRow): LibraryEntry {
  return {
    id: r.id, name: r.name, description: r.description, author: r.owner_name, authorId: r.owner, visibility: r.visibility, revision: r.revision,
    width: r.width, height: r.height, bases: r.bases, players: { min: r.min_players, max: r.max_players }, playable: !!r.playable,
    plays: r.plays, likes: r.likes, liked: !!r.liked, featured: !!r.featured, hidden: !!r.hidden, hiddenReason: r.hidden_reason,
    created: r.created, updated: r.updated, published: r.published, hasThumb: !!r.has_thumb,
  };
}

export class Library {
  private readonly saves = new Limiter(0.2, 10);
  private readonly reports = new Limiter(1 / 60, 5);
  private filter: RegExp | null = null;

  constructor(private readonly db: Db, private readonly maps: Maps, private readonly accounts: Accounts, private readonly settings: Settings, private readonly audit: Audit) {
    db.migrate('maps', [
      `CREATE TABLE user_maps (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'private', revision INTEGER NOT NULL DEFAULT 1,
        json TEXT NOT NULL, thumb BLOB NOT NULL DEFAULT x'', width INTEGER NOT NULL, height INTEGER NOT NULL, bases INTEGER NOT NULL,
        min_players INTEGER NOT NULL, max_players INTEGER NOT NULL, playable INTEGER NOT NULL DEFAULT 1,
        plays INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0, hidden_reason TEXT NOT NULL DEFAULT '',
        created INTEGER NOT NULL, updated INTEGER NOT NULL, published INTEGER
      );
      CREATE INDEX user_maps_owner ON user_maps (owner, updated);
      CREATE INDEX user_maps_listed ON user_maps (visibility, hidden, published);
      CREATE TABLE map_revisions (
        map_id TEXT NOT NULL REFERENCES user_maps (id) ON DELETE CASCADE, revision INTEGER NOT NULL, json TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (map_id, revision)
      );
      CREATE TABLE map_likes (
        map_id TEXT NOT NULL REFERENCES user_maps (id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        PRIMARY KEY (map_id, user_id)
      );
      CREATE TABLE map_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, map_id TEXT NOT NULL REFERENCES user_maps (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, reason TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0, resolution TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX map_reports_open ON map_reports (resolved, map_id);
      CREATE TABLE map_limits (user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE, max INTEGER NOT NULL);`,
    ]);
    this.compileFilter();
    settings.onChange(() => this.compileFilter());
    maps.addSource({ name: 'library', get: (id, userId) => this.playable(id, userId) });
  }

  private compileFilter(): void {
    const s = this.settings.get();
    const words = [...s.wordFilter, ...s.mapNameFilter].map((w) => w.trim()).filter(Boolean);
    const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.filter = words.length ? new RegExp(`\\b(${words.map(esc).join('|')})\\b`, 'i') : null;
  }

  // ---- Reading ----

  private row(id: string, viewer: string | null = null): MapRow | undefined {
    return this.db.get<MapRow>(
      `SELECT ${COLUMNS}, (SELECT 1 FROM map_likes l WHERE l.map_id = m.id AND l.user_id = ?) AS liked
       FROM user_maps m JOIN users u ON u.id = m.owner WHERE m.id = ?`, viewer, id);
  }

  /** Whether a user (null for a guest) may see a map: its author and staff always, others when it is shared and not hidden. */
  private canSee(r: MapRow, user: Identity | null): boolean {
    if (user && (user.id === r.owner || hasRole(user, 'moderator'))) return true;
    return r.visibility !== 'private' && !r.hidden;
  }

  private json(id: string): RfwMap | null {
    const r = this.db.get<{ json: string }>('SELECT json FROM user_maps WHERE id = ?', id);
    return r ? (JSON.parse(r.json) as RfwMap) : null;
  }

  /** The map for a lobby: one with no errors that the lobby's owner may see. */
  playable(id: string, userId: string | null): RfwMap | null {
    if (!id.startsWith('u-')) return null;
    const r = this.row(id);
    if (!r || !r.playable) return null;
    const mine = userId !== null && userId === r.owner;
    if (!mine && (r.visibility === 'private' || r.hidden)) return null;
    return this.json(id);
  }

  /** Counts a finished online game on a library map. */
  played(id: string): void {
    this.db.run('UPDATE user_maps SET plays = plays + 1 WHERE id = ?', id);
  }

  list(opts: { viewer: string | null; owner?: string; q?: string; sort?: MapSort; featured?: boolean; page?: number; limit?: number }): { maps: LibraryEntry[]; total: number } {
    const where: string[] = ['u.banned = 0'];
    const params: (string | number | null)[] = [];
    if (opts.owner) (where.push('m.owner = ?'), params.push(opts.owner));
    else where.push(`m.visibility = 'public' AND m.hidden = 0 AND m.playable = 1`);
    if (opts.featured) where.push('m.featured = 1');
    if (opts.q) {
      const like = `%${opts.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      where.push(`(m.name LIKE ? ESCAPE '\\' OR m.description LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')`);
      params.push(like, like, like);
    }
    const from = `FROM user_maps m JOIN users u ON u.id = m.owner WHERE ${where.join(' AND ')}`;
    const total = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, ...params)!.n;
    const limit = Math.min(opts.limit ?? PAGE, 200);
    const order = opts.owner ? 'm.updated DESC' : `m.featured DESC, ${SORTS[opts.sort ?? 'new']}`;
    const rows = this.db.all<MapRow>(
      `SELECT ${COLUMNS}, (SELECT 1 FROM map_likes l WHERE l.map_id = m.id AND l.user_id = ?) AS liked ${from} ORDER BY ${order} LIMIT ? OFFSET ?`,
      opts.viewer, ...params, limit, (opts.page ?? 0) * limit);
    return { maps: rows.map(entry), total };
  }

  // ---- Writing ----

  /** How many maps a user may keep: their own limit if staff set one, else the site's. */
  limitFor(userId: string): number {
    return this.db.get<{ max: number }>('SELECT max FROM map_limits WHERE user_id = ?', userId)?.max ?? this.settings.get().mapLimit;
  }

  /** Reads and checks an uploaded map; private maps may still have errors, shared ones may not. */
  private checked(ctx: Ctx, user: Identity): { map: RfwMap; visibility: MapVisibility; playable: boolean; thumb: Buffer | null } {
    if (!this.maps.ready) throw new HttpError(503, 'The server has no game data to check maps against');
    let map: RfwMap;
    try {
      map = parseMap(ctx.body.map);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    const visibility = (ctx.body.visibility ?? map.visibility ?? 'private') as MapVisibility;
    if (!VISIBILITIES.includes(visibility)) throw new HttpError(400, `visibility must be one of ${VISIBILITIES.join(', ')}`);
    map.name = map.name.trim();
    if (!map.name) throw new HttpError(400, 'Give the map a name');
    const errors = mapErrors(map, this.maps.defs, this.maps.shore);
    if (errors.length && visibility !== 'private') {
      throw new HttpError(422, `Fix the map's ${errors.length === 1 ? 'error' : `${errors.length} errors`} before sharing it: ${errors[0]!.message}`);
    }
    if (visibility !== 'private' && this.filter && (this.filter.test(map.name) || this.filter.test(map.description ?? ''))) {
      throw new HttpError(422, 'The map\'s name or description has words this site does not allow');
    }
    map.version = 2;
    map.author = user.name;
    map.authorId = user.id;
    map.visibility = visibility;
    let thumb: Buffer | null = null;
    const t = ctx.body.thumb;
    if (typeof t === 'string' && t) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(t);
      thumb = m ? Buffer.from(m[1]!, 'base64') : null;
      if (!thumb || thumb.length > MAX_THUMB || !thumb.subarray(0, 8).equals(PNG)) throw new HttpError(400, 'thumb must be a small PNG data URL');
    }
    return { map, visibility, playable: errors.length === 0, thumb };
  }

  private limitSaves(user: Identity): void {
    if (!this.saves.take(user.id)) throw new HttpError(429, 'Saving too often; wait a moment');
  }

  private ownRow(ctx: Ctx, user: Identity): MapRow {
    const r = this.row(ctx.params.id!);
    if (!r || (r.owner !== user.id && !this.canSee(r, user))) throw new HttpError(404, 'No such map');
    if (r.owner !== user.id) throw new HttpError(403, 'That map is not yours');
    return r;
  }

  create(ctx: Ctx): { id: string; revision: number; map: LibraryEntry } {
    const user = requireUser(ctx);
    this.limitSaves(user);
    const { map, visibility, playable, thumb } = this.checked(ctx, user);
    const have = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM user_maps WHERE owner = ?', user.id)!.n;
    const max = this.limitFor(user.id);
    if (have >= max) throw new HttpError(403, max ? `You can keep at most ${max} maps here; delete one first` : 'You cannot save maps here');
    let id: string;
    do id = `u-${randomBytes(6).toString('base64url')}`;
    while (this.maps.builtIn(id) || this.db.get('SELECT 1 FROM user_maps WHERE id = ?', id));
    map.id = id;
    map.revision = 1;
    const now = Date.now();
    this.db.run(
      `INSERT INTO user_maps (id, owner, name, description, visibility, revision, json, thumb, width, height, bases, min_players, max_players, playable, created, updated, published)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, user.id, map.name, map.description ?? '', visibility, JSON.stringify(map), thumb ?? Buffer.alloc(0), map.width, map.height, map.bases.length,
      map.players.min, map.players.max, playable ? 1 : 0, now, now, visibility === 'public' ? now : null);
    return { id, revision: 1, map: entry(this.row(id, user.id)!) };
  }

  /** Saves a new revision; the client sends the revision it started from, and a newer one on the server is a conflict. */
  update(ctx: Ctx): { id: string; revision: number; map: LibraryEntry } {
    const user = requireUser(ctx);
    const r = this.ownRow(ctx, user);
    this.limitSaves(user);
    const base = int(ctx, 'revision', 0, 1e9);
    if (base !== r.revision) throw new HttpError(409, `The library has a newer revision (${r.revision}) of this map, saved from somewhere else`);
    const { map, visibility, playable, thumb } = this.checked(ctx, user);
    if (r.hidden && visibility !== 'private') throw new HttpError(403, `Staff hid this map${r.hidden_reason ? `: ${r.hidden_reason}` : ''}. It can only be private.`);
    const revision = r.revision + 1;
    map.id = r.id;
    map.revision = revision;
    const now = Date.now();
    this.db.tx(() => {
      this.db.run('INSERT OR REPLACE INTO map_revisions (map_id, revision, json, at) SELECT id, revision, json, updated FROM user_maps WHERE id = ?', r.id);
      this.db.run('DELETE FROM map_revisions WHERE map_id = ? AND revision <= ?', r.id, r.revision - KEEP_REVISIONS);
      this.db.run(
        `UPDATE user_maps SET name = ?, description = ?, visibility = ?, revision = ?, json = ?, thumb = coalesce(?, thumb), width = ?, height = ?,
         bases = ?, min_players = ?, max_players = ?, playable = ?, updated = ?, published = CASE WHEN ? = 'public' THEN coalesce(published, ?) ELSE published END
         WHERE id = ?`,
        map.name, map.description ?? '', visibility, revision, JSON.stringify(map), thumb, map.width, map.height, map.bases.length,
        map.players.min, map.players.max, playable ? 1 : 0, now, visibility, now, r.id);
    });
    return { id: r.id, revision, map: entry(this.row(r.id, user.id)!) };
  }

  /** Changes only who can see a map. */
  setVisibility(ctx: Ctx): LibraryEntry {
    const user = requireUser(ctx);
    const r = this.ownRow(ctx, user);
    const visibility = str(ctx, 'visibility') as MapVisibility;
    if (!VISIBILITIES.includes(visibility)) throw new HttpError(400, `visibility must be one of ${VISIBILITIES.join(', ')}`);
    if (visibility !== 'private') {
      if (r.hidden) throw new HttpError(403, `Staff hid this map${r.hidden_reason ? `: ${r.hidden_reason}` : ''}. It can only be private.`);
      if (!r.playable) throw new HttpError(422, 'Fix the map\'s errors before sharing it');
      if (this.filter && (this.filter.test(r.name) || this.filter.test(r.description))) throw new HttpError(422, 'The map\'s name or description has words this site does not allow');
    }
    const map = this.json(r.id)!;
    map.visibility = visibility;
    this.db.run(`UPDATE user_maps SET visibility = ?, json = ?, published = CASE WHEN ? = 'public' THEN coalesce(published, ?) ELSE published END WHERE id = ?`,
      visibility, JSON.stringify(map), visibility, Date.now(), r.id);
    return entry(this.row(r.id, user.id)!);
  }

  like(id: string, user: Identity, like: boolean): number {
    this.db.tx(() => {
      const changed = like
        ? this.db.run('INSERT OR IGNORE INTO map_likes (map_id, user_id) VALUES (?, ?)', id, user.id).changes
        : this.db.run('DELETE FROM map_likes WHERE map_id = ? AND user_id = ?', id, user.id).changes;
      if (changed) this.db.run('UPDATE user_maps SET likes = likes + ? WHERE id = ?', like ? 1 : -1, id);
    });
    return this.db.get<{ likes: number }>('SELECT likes FROM user_maps WHERE id = ?', id)?.likes ?? 0;
  }

  openReports(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(DISTINCT map_id) AS n FROM map_reports WHERE resolved = 0')!.n;
  }

  // ---- Routes ----

  install(app: App): void {
    const sortOf = (v: string | null): MapSort => (v && v in SORTS ? (v as MapSort) : 'new');
    const visible = (ctx: Ctx) => {
      const r = this.row(ctx.params.id!, ctx.user?.id ?? null);
      if (!r || !this.canSee(r, ctx.user)) throw new HttpError(404, 'No such map');
      return r;
    };

    /** Public maps (search, sort, featured), or with mine=1 the signed-in user's own. */
    app.route('GET', '/api/maps', (ctx) => {
      const q = ctx.query;
      const mine = q.get('mine') === '1';
      const user = mine ? requireUser(ctx) : ctx.user;
      const out = this.list({
        viewer: user?.id ?? null, owner: mine ? user!.id : undefined, q: (q.get('q') ?? '').trim().slice(0, 100) || undefined,
        sort: sortOf(q.get('sort')), featured: q.get('featured') === '1', page: int(ctx, 'page', 0, 10000, 0), limit: int(ctx, 'limit', 1, 200, PAGE),
      });
      return mine ? { ...out, limit: this.limitFor(user!.id) } : out;
    });
    app.route('POST', '/api/maps', (ctx) => this.create(ctx));
    app.route('GET', '/api/maps/:id', (ctx) => {
      const r = visible(ctx);
      return { info: entry(r), map: this.json(r.id) };
    });
    app.route('PUT', '/api/maps/:id', (ctx) => this.update(ctx));
    app.route('DELETE', '/api/maps/:id', (ctx) => {
      const user = requireUser(ctx);
      const r = this.ownRow(ctx, user);
      this.db.run('DELETE FROM user_maps WHERE id = ?', r.id);
      return { ok: true };
    });
    app.route('POST', '/api/maps/:id/visibility', (ctx) => ({ map: this.setVisibility(ctx) }));
    app.route('GET', '/api/maps/:id/thumb', (ctx) => {
      const r = visible(ctx);
      const t = this.db.get<{ thumb: Uint8Array }>('SELECT thumb FROM user_maps WHERE id = ?', r.id)?.thumb;
      if (!t?.length) throw new HttpError(404, 'No picture');
      ctx.res.writeHead(200, { 'content-type': 'image/png', 'content-length': t.length, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' });
      ctx.res.end(Buffer.from(t));
    });
    app.route('GET', '/api/maps/:id/revisions', (ctx) => {
      const r = this.ownRow(ctx, requireUser(ctx));
      return { current: r.revision, revisions: this.db.all<{ revision: number; at: number }>('SELECT revision, at FROM map_revisions WHERE map_id = ? ORDER BY revision DESC', r.id) };
    });
    app.route('GET', '/api/maps/:id/revisions/:rev', (ctx) => {
      const r = this.ownRow(ctx, requireUser(ctx));
      const old = this.db.get<{ json: string }>('SELECT json FROM map_revisions WHERE map_id = ? AND revision = ?', r.id, Number(ctx.params.rev));
      if (!old) throw new HttpError(404, 'No such revision');
      return { map: JSON.parse(old.json) as RfwMap };
    });
    app.route('POST', '/api/maps/:id/like', (ctx) => {
      const user = requireUser(ctx);
      const r = visible(ctx);
      if (r.owner === user.id) throw new HttpError(400, 'You cannot like your own map');
      return { likes: this.like(r.id, user, ctx.body.like !== false) };
    });
    app.route('POST', '/api/maps/:id/report', (ctx) => {
      const user = requireUser(ctx);
      const r = visible(ctx);
      if (r.owner === user.id) throw new HttpError(400, 'You cannot report your own map');
      const reason = str(ctx, 'reason', { min: 3, max: 300 });
      if (this.db.get('SELECT 1 FROM map_reports WHERE map_id = ? AND user_id = ? AND resolved = 0', r.id, user.id)) return { ok: true };
      if (!this.reports.take(user.id)) throw new HttpError(429, 'Too many reports; try again later');
      this.db.run('INSERT INTO map_reports (map_id, user_id, reason, at) VALUES (?, ?, ?, ?)', r.id, user.id, reason, Date.now());
      return { ok: true };
    });

    this.installAdmin(app);
  }

  // ---- Moderation ----

  private installAdmin(app: App): void {
    const reauth = (ctx: Ctx) => {
      if (!this.accounts.reauthed(ctx.session)) throw new HttpError(428, 'Enter your password again to do that');
    };

    /** Every map with its open reports: filter reported, hidden, featured, or all; search by name or author. */
    app.route('GET', '/api/admin/maps', (ctx) => {
      requireRole(ctx, 'moderator');
      const q = ctx.query;
      const where: string[] = [];
      const params: (string | number)[] = [];
      const filter = q.get('filter') ?? 'reported';
      if (filter === 'reported') where.push('x.reports > 0');
      if (filter === 'hidden') where.push('x.hidden = 1');
      if (filter === 'featured') where.push('x.featured = 1');
      if (filter === 'shared') where.push(`x.visibility != 'private'`);
      const text = (q.get('q') ?? '').trim();
      if (text) {
        const like = `%${text.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
        where.push(`(x.name LIKE ? ESCAPE '\\' OR x.owner_name LIKE ? ESCAPE '\\' OR x.id = ?)`);
        params.push(like, like, text);
      }
      const rows = this.db.all<MapRow>(
        `SELECT * FROM (SELECT ${COLUMNS}, NULL AS liked, (SELECT COUNT(*) FROM map_reports r WHERE r.map_id = m.id AND r.resolved = 0) AS reports
         FROM user_maps m JOIN users u ON u.id = m.owner) x ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY x.reports DESC, x.updated DESC LIMIT 200`, ...params);
      return { maps: rows.map((r) => ({ ...entry(r), reports: r.reports ?? 0 })), openReports: this.openReports(), defaultLimit: this.settings.get().mapLimit };
    });

    app.route('GET', '/api/admin/maps/:id/reports', (ctx) => {
      requireRole(ctx, 'moderator');
      return {
        reports: this.db.all<{ id: number; at: number; reporter: string; reason: string; resolved: number; resolution: string }>(
          `SELECT r.id, r.at, u.name AS reporter, r.reason, r.resolved, r.resolution FROM map_reports r JOIN users u ON u.id = r.user_id
           WHERE r.map_id = ? ORDER BY r.resolved, r.id DESC LIMIT 100`, ctx.params.id!),
      };
    });

    /** dismiss (reports), hide, unhide, unpublish (make private): moderators. feature, unfeature, delete: admins. */
    app.route('POST', '/api/admin/maps/:id/action', (ctx) => {
      const me = requireRole(ctx, 'moderator');
      const r = this.row(ctx.params.id!);
      if (!r) throw new HttpError(404, 'No such map');
      const action = str(ctx, 'action');
      const reason = str(ctx, 'reason', { optional: true, max: 300 });
      const resolve = (how: string) => this.db.run('UPDATE map_reports SET resolved = 1, resolution = ? WHERE map_id = ? AND resolved = 0', how, r.id);
      const setJsonVisibility = (v: MapVisibility) => {
        const map = this.json(r.id)!;
        map.visibility = v;
        this.db.run('UPDATE user_maps SET visibility = ?, json = ? WHERE id = ?', v, JSON.stringify(map), r.id);
      };
      switch (action) {
        case 'dismiss':
          resolve(`dismissed by ${me.name}`);
          break;
        case 'hide':
          if (!reason) throw new HttpError(400, 'Say why, for the author');
          this.db.run('UPDATE user_maps SET hidden = 1, hidden_reason = ?, featured = 0 WHERE id = ?', reason, r.id);
          resolve(`hidden by ${me.name}`);
          break;
        case 'unhide':
          this.db.run(`UPDATE user_maps SET hidden = 0, hidden_reason = '' WHERE id = ?`, r.id);
          break;
        case 'unpublish':
          setJsonVisibility('private');
          this.db.run('UPDATE user_maps SET featured = 0 WHERE id = ?', r.id);
          resolve(`made private by ${me.name}`);
          break;
        case 'feature':
        case 'unfeature':
          requireRole(ctx, 'admin');
          if (action === 'feature' && (r.visibility !== 'public' || r.hidden || !r.playable)) throw new HttpError(400, 'Only public, playable maps that are not hidden can be featured');
          this.db.run('UPDATE user_maps SET featured = ? WHERE id = ?', action === 'feature' ? 1 : 0, r.id);
          break;
        case 'delete':
          requireRole(ctx, 'admin');
          reauth(ctx);
          this.db.run('DELETE FROM user_maps WHERE id = ?', r.id);
          break;
        default:
          throw new HttpError(400, 'Unknown action');
      }
      this.audit.log(me, `map.${action}`, r.id, { name: r.name, author: r.owner_name }, reason);
      return { ok: true };
    });

    /** Sets how many maps one account may keep (null goes back to the site's limit; 0 stops them saving). */
    app.route('PUT', '/api/admin/users/:id/map-limit', (ctx) => {
      const me = requireRole(ctx, 'admin');
      const u = this.accounts.byId(ctx.params.id!);
      if (!u) throw new HttpError(404, 'No such player');
      const v = ctx.body.max;
      if (v === null) this.db.run('DELETE FROM map_limits WHERE user_id = ?', u.id);
      else {
        const max = int(ctx, 'max', 0, 10000);
        this.db.run('INSERT INTO map_limits (user_id, max) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET max = excluded.max', u.id, max);
      }
      this.audit.log(me, 'map.limit', u.id, { name: u.name, max: v }, str(ctx, 'reason', { optional: true, max: 300 }));
      return { limit: this.limitFor(u.id) };
    });
    app.route('GET', '/api/admin/users/:id/map-limit', (ctx) => {
      requireRole(ctx, 'moderator');
      const custom = this.db.get<{ max: number }>('SELECT max FROM map_limits WHERE user_id = ?', ctx.params.id!);
      const have = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM user_maps WHERE owner = ?', ctx.params.id!)!.n;
      return { limit: this.limitFor(ctx.params.id!), custom: custom?.max ?? null, maps: have };
    });
  }
}
