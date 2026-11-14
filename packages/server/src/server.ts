// The game server, put together from its parts so main.ts (and the tests) can start one: static files, the JSON
// API, the game WebSocket at /ws and the upkeep timers. See main.ts for the environment it reads.

import { createReadStream, readdirSync, rmSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Accounts } from './accounts.js';
import { installAdmin } from './admin.js';
import { Audit } from './audit.js';
import { Chat } from './chat.js';
import { Db } from './db.js';
import { Friends } from './friends.js';
import { App, HttpError, send as sendJson } from './http.js';
import { Hub } from './hub.js';
import { Library, MAP_BODY_LIMIT } from './library.js';
import { Limiter } from './limits.js';
import { Lobbies } from './lobbies.js';
import { Maps } from './maps.js';
import { REPLAY_BODY_LIMIT, Replays } from './replays.js';
import { Settings } from './settings.js';
import { Stats } from './stats.js';

/**
 * The optional files the client looks for in the extras folder (docs/assets.md): a SoundFont and MIDI files under
 * music/, and an older pack's sprite list.
 */
export function extras(dir: string): string[] {
  const list = (sub: string): string[] => {
    try {
      return readdirSync(join(dir, sub));
    } catch {
      return [];
    }
  };
  return [
    ...list('music').filter((f) => f === 'soundfont.sf2' || f.endsWith('.mid')).map((f) => `music/${f}`),
    ...list('sprites').filter((f) => f === 'frames.json').map((f) => `sprites/${f}`),
  ].sort();
}

export interface ServerOptions {
  clientDir: string;
  assetsDir: string;
  /** The database, backups and desync reports; null keeps the database in memory and writes nothing (tests). */
  dataDir: string | null;
  trustProxy: boolean;
  secureCookies: boolean;
  backupHours: number;
  backupKeep: number;
  metricsToken?: string;
  /** Requests per second per IP on the API (30). */
  apiRate?: number;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mid': 'audio/midi',
};

const PAGE_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY' };

/** Resolves a URL path inside a directory, or null if it would escape it. */
function inside(dir: string, urlPath: string): string | null {
  const path = resolve(dir, '.' + normalize(decodeURIComponent(urlPath)));
  return path === dir || path.startsWith(dir + sep) ? path : null;
}

async function send(res: ServerResponse, path: string | null, cache: string, range?: string): Promise<boolean> {
  if (!path) return false;
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return false;
  const headers = {
    ...PAGE_HEADERS,
    'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': cache,
    'accept-ranges': 'bytes',
  };
  // Byte ranges, which Safari needs before it will play a video (the intro and win movies).
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, info.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` }).end();
      return true;
    }
    res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${info.size}` });
    createReadStream(path, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'content-length': info.size });
  createReadStream(path).pipe(res);
  return true;
}

export interface GameServer {
  server: Server;
  db: Db;
  maps: Maps;
  accounts: Accounts;
  lobbies: Lobbies;
  hub: Hub;
  settings: Settings;
  close(): Promise<void>;
}

export function createGameServer(o: ServerOptions): GameServer {
  const CLIENT_DIR = resolve(o.clientDir);
  const ASSETS_DIR = resolve(o.assetsDir);
  const DATA_DIR = o.dataDir ? resolve(o.dataDir) : null;
  const db = new Db(DATA_DIR ? join(DATA_DIR, 'returnfire.db') : ':memory:');
  const settings = new Settings(db);
  const audit = new Audit(db);
  const accounts = new Accounts(db, settings, { secureCookies: o.secureCookies });
  const maps = new Maps(ASSETS_DIR, join(CLIENT_DIR, 'art/pack'));
  const chat = new Chat(db, settings, accounts);
  const stats = new Stats(db, accounts, maps, chat);
  const library = new Library(db, maps, accounts, settings, audit);
  const replays = new Replays(db, settings);
  const friends = new Friends(db, accounts, chat);
  let desyncs = 0;
  const lobbies = new Lobbies(maps, chat, settings, {
    desyncDir: DATA_DIR ? join(DATA_DIR, 'desyncs') : null,
    onDesync: () => desyncs++,
    mayWatch: (userId, l) => friends.mayWatch(userId, l),
    onGameEnd: (lobby, result) => {
      try {
        stats.record(result, lobby.mapId, lobby.map.name);
        if (!result.aborted) library.played(lobby.mapId);
      } catch (err) {
        console.error('Could not record a game', err);
      }
    },
  });
  const hub = new Hub(accounts, lobbies, chat, settings, { trustProxy: o.trustProxy });
  friends.hub = hub;

  const app = new App();
  const apiLimit = new Limiter(o.apiRate ?? 30, (o.apiRate ?? 30) * 4);
  app.hooks = {
    trustProxy: o.trustProxy,
    identify: (ctx) => accounts.identify(ctx),
    limit: (ctx) => {
      if (!apiLimit.take(ctx.ip)) throw new HttpError(429, 'Too many requests');
    },
    bodyLimits: { '/api/solo': 4 << 20, '/api/maps': MAP_BODY_LIMIT, '/api/replays': REPLAY_BODY_LIMIT },
  };
  accounts.install(app);
  stats.install(app);
  library.install(app);
  replays.install(app);
  friends.install(app);
  installAdmin(app, { db, accounts, audit, chat, hub, lobbies, maps, settings, stats, desyncs: () => desyncs });

  /** What the title screen and lobby screens show: news, maintenance, sign-up mode and the maps lobbies can use. */
  app.route('GET', '/api/site', () => {
    const s = settings.get();
    return {
      motd: s.motd, news: s.news, maintenance: s.maintenance, signups: s.signups,
      featuredMaps: s.featuredMaps, defaultDifficulty: s.defaultDifficulty,
    };
  });
  app.route('GET', '/api/lobby-maps', () => {
    const featured = new Set(settings.get().featuredMaps);
    return { maps: maps.list().map((m) => ({ ...m, featured: featured.has(m.id) })) };
  });

  // ---- Upkeep ----

  function backup(): void {
    if (!DATA_DIR) return;
    try {
      const dir = join(DATA_DIR, 'backups');
      const name = `returnfire-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
      db.backup(join(dir, name));
      const old = readdirSync(dir).filter((f) => f.startsWith('returnfire-') && f.endsWith('.db')).sort().reverse().slice(Math.max(1, o.backupKeep));
      for (const f of old) rmSync(join(dir, f));
      console.log(`Backed up the database to ${join(dir, name)}`);
    } catch (err) {
      console.error('Backup failed', err);
    }
  }
  const timers = [
    setInterval(() => chat.prune(), 3600e3),
    ...(o.backupHours > 0 && DATA_DIR ? [setInterval(backup, o.backupHours * 3600e3)] : []),
    setInterval(() => apiLimit.sweep(), 60e3),
  ];
  for (const t of timers) t.unref();
  chat.prune();

  function metrics(): string {
    const all = [...lobbies.lobbies.values()];
    const rooms = all.flatMap((l) => (l.room ? [l.room] : []));
    const online = hub.online();
    const mem = process.memoryUsage();
    return [
      `rfw_connections ${online.length}`,
      `rfw_guests ${online.filter((c) => c.identity.guest).length}`,
      `rfw_lobbies ${all.length}`,
      `rfw_games ${rooms.length}`,
      `rfw_tick_lag_max ${Math.max(0, ...rooms.map((r) => r.lag))}`,
      `rfw_desyncs_total ${desyncs}`,
      `rfw_messages_total ${hub.messages}`,
      `rfw_errors_total ${hub.errors}`,
      `rfw_accounts ${accounts.count()}`,
      `rfw_reports_open ${chat.openReports()}`,
      `process_resident_memory_bytes ${mem.rss}`,
      `process_heap_used_bytes ${mem.heapUsed}`,
      '',
    ].join('\n');
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (path.startsWith('/api/')) {
        if (await app.handle(req, res, url)) return;
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      if (path === '/healthz') {
        // Ready once there is game data: the art pack built into the client, or converted assets.
        if (!maps.ready && (await stat(join(ASSETS_DIR, 'sprites', 'frames.json')).catch(() => null))) maps.reload();
        const assets = maps.ready;
        res.writeHead(assets ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: assets, assets, database: true }));
        return;
      }
      if (path === '/metrics') {
        if (!o.metricsToken || req.headers.authorization !== `Bearer ${o.metricsToken}`) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(metrics());
        return;
      }
      // The map list and the generated maps live in memory, and the two-player maps may be the art pack's (maps.ts);
      // everything else is a file.
      if (path === '/generated/maps/index.json') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }).end(JSON.stringify(maps.indexFile()));
        return;
      }
      const made = /^\/generated\/maps\/([A-Za-z0-9_-]+)\.json$/.exec(path);
      const builtIn = made && maps.builtIn(made[1]!) ? maps.get(made[1]!) : null;
      if (builtIn) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }).end(JSON.stringify(builtIn));
        return;
      }
      // What the optional extras folder holds, so the client asks only for files that are there.
      if (path === '/generated/extras.json') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }).end(JSON.stringify({ files: extras(ASSETS_DIR) }));
        return;
      }
      if (path.startsWith('/generated/')) {
        if (await send(res, inside(ASSETS_DIR, path.slice('/generated'.length)), 'public, max-age=3600', req.headers.range)) return;
        res.writeHead(404).end();
        return;
      }
      // Vite fingerprints everything under /assets/, so those files can be cached for good.
      const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      if (path === '/admin' || path.startsWith('/admin/')) {
        if (await send(res, join(CLIENT_DIR, 'admin.html'), 'no-cache')) return;
      }
      if (await send(res, inside(CLIENT_DIR, path === '/' ? '/index.html' : path), cache)) return;
      if (await send(res, join(CLIENT_DIR, 'index.html'), 'no-cache')) return;
      res.writeHead(404).end();
    })().catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.on('upgrade', (req, sock) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
      sock.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    hub.upgrade(req, sock);
  });


  return {
    server, db, maps, accounts, lobbies, hub, settings,
    close: () => new Promise<void>((done) => {
      for (const t of timers) clearInterval(t);
      hub.close();
      lobbies.close();
      server.close(() => {
        db.close();
        done();
      });
      server.closeAllConnections();
    }),
  };
}
