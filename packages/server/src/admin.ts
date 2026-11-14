// The admin API behind /admin (admin-roles, admin-dashboard, admin-users, admin-games, admin-chat, admin-site).
// Moderators handle chat and players' behaviour (warn, mute, kick, reports); admins also suspend, ban, rename,
// reset sign-ins, run games and change site settings; the owner alone grants roles, deletes accounts and reads
// the audit log. Destructive actions need the password again within REAUTH_MS (answered 428 until then), and every
// action is written to the audit log.

import { cpuUsage, memoryUsage, uptime } from 'node:process';
import type { Identity, Role } from '@rfw/net';
import { NAME_RE, type Accounts } from './accounts.js';
import type { Audit } from './audit.js';
import type { Chat } from './chat.js';
import type { Db } from './db.js';
import { HttpError, hasRole, int, requireRole, str, type App, type Ctx } from './http.js';
import type { Hub } from './hub.js';
import type { Lobbies } from './lobbies.js';
import type { Maps } from './maps.js';
import { DEFAULT_SETTINGS, type Settings, type SiteSettings } from './settings.js';
import type { Stats } from './stats.js';

export interface AdminDeps {
  db: Db;
  accounts: Accounts;
  audit: Audit;
  chat: Chat;
  hub: Hub;
  lobbies: Lobbies;
  maps: Maps;
  settings: Settings;
  stats: Stats;
  /** Desyncs seen since start (rooms report them). */
  desyncs: () => number;
}

const MINUTE = 60_000;

export function installAdmin(app: App, d: AdminDeps): void {
  const reauth = (ctx: Ctx) => {
    if (!d.accounts.reauthed(ctx.session)) throw new HttpError(428, 'Enter your password again to do that');
  };
  const reason = (ctx: Ctx) => str(ctx, 'reason', { optional: true, max: 300 });
  const target = (ctx: Ctx) => {
    const u = d.accounts.byId(ctx.params.id!);
    if (!u) throw new HttpError(404, 'No such player');
    return u;
  };
  /** Staff can only act on players ranked below them (the owner on anyone but themselves). */
  const outranks = (me: Identity, role: Role) => {
    const rank: Record<Role, number> = { player: 0, moderator: 1, admin: 2, owner: 3 };
    if (rank[role] >= rank[me.role]) throw new HttpError(403, 'You cannot act on someone with that role');
  };

  // ---- Dashboard ----

  let lastCpu = cpuUsage();
  let lastAt = Date.now();
  app.route('GET', '/api/admin/dashboard', (ctx) => {
    requireRole(ctx, 'moderator');
    const online = d.hub.online();
    const lobbies = [...d.lobbies.lobbies.values()];
    const rooms = lobbies.flatMap((l) => (l.room ? [l.room] : []));
    const cpu = cpuUsage(lastCpu);
    const now = Date.now();
    const cpuPct = ((cpu.user + cpu.system) / 1000 / Math.max(1, now - lastAt)) * 100;
    lastCpu = cpuUsage();
    lastAt = now;
    const days = d.db.all<{ day: string; n: number }>(
      `SELECT date(created / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE created > ? GROUP BY day ORDER BY day`, now - 14 * 86400e3);
    return {
      online: { total: online.length, players: online.filter((c) => !c.identity.guest).length, guests: online.filter((c) => c.identity.guest).length },
      games: rooms.length, lobbies: lobbies.filter((l) => l.state === 'waiting').length,
      openLobbies: lobbies.filter((l) => l.state === 'waiting' && l.visibility === 'open').length,
      accounts: d.accounts.count(), signups: days,
      server: { cpu: Math.round(cpuPct * 10) / 10, rss: memoryUsage().rss, heap: memoryUsage().heapUsed, uptime: Math.round(uptime()), lag: Math.max(0, ...rooms.map((r) => r.lag)) },
      desyncs: d.desyncs(), errors: d.hub.errors, messages: d.hub.messages, reports: d.chat.openReports(),
      assets: d.maps.ready,
    };
  });

  // ---- Players ----

  app.route('GET', '/api/admin/users', (ctx) => {
    const me = requireRole(ctx, 'moderator');
    const q = (ctx.query.get('q') ?? '').trim();
    const admin = hasRole(me, 'admin');
    const rows = d.db.all<{ id: string; name: string; email: string; role: Role; created: number; last_seen: number; banned: number; suspended_until: number; muted_until: number }>(
      `SELECT id, name, email, role, created, last_seen, banned, suspended_until, muted_until FROM users
       WHERE name LIKE ? ${admin ? 'OR email LIKE ?' : ''} ORDER BY last_seen DESC LIMIT 100`,
      ...(admin ? [`%${q}%`, `%${q}%`] : [`%${q}%`]),
    );
    const live = new Set(d.hub.online().map((c) => c.identity.id));
    return {
      users: rows.map((r) => ({
        id: r.id, name: r.name, email: admin ? r.email : undefined, role: r.role, created: r.created, lastSeen: r.last_seen, online: live.has(r.id),
        banned: !!r.banned, suspendedUntil: r.suspended_until, mutedUntil: r.muted_until,
      })),
    };
  });

  app.route('GET', '/api/admin/users/:id', (ctx) => {
    const me = requireRole(ctx, 'moderator');
    const u = target(ctx);
    const admin = hasRole(me, 'admin');
    return {
      user: { ...u, email: admin ? u.email : undefined },
      online: d.hub.online().some((c) => c.identity.id === u.id),
      stats: d.stats.stats(u.id),
      games: d.stats.recentGames(u.id, 20),
      warnings: d.db.all('SELECT at, by, kind, reason, until FROM warnings WHERE user_id = ? ORDER BY at DESC LIMIT 50', u.id),
      sessions: admin ? d.db.all('SELECT created, last_seen AS lastSeen, ip, agent FROM sessions WHERE user_id = ? ORDER BY last_seen DESC', u.id) : [],
      ips: admin ? d.db.all('SELECT ip, last_seen AS lastSeen FROM user_ips WHERE user_id = ? ORDER BY last_seen DESC LIMIT 50', u.id) : [],
      chat: d.chat.search({ user: u.id, limit: 100 }),
      reports: d.chat.reports(false, 200).filter((r) => r.message.from?.id === u.id),
    };
  });

  app.route('POST', '/api/admin/users/:id/action', async (ctx) => {
    const me = requireRole(ctx, 'moderator');
    const u = target(ctx);
    const action = str(ctx, 'action');
    const why = reason(ctx);
    const minutes = () => int(ctx, 'minutes', 1, 60 * 24 * 3650);
    const note = (kind: string, until = 0) => d.db.run('INSERT INTO warnings (user_id, at, by, kind, reason, until) VALUES (?, ?, ?, ?, ?, ?)', u.id, Date.now(), me.name, kind, why, until);
    if (u.id === me.id && action !== 'reset') throw new HttpError(400, 'Not on yourself');
    let out: Record<string, unknown> = { ok: true };
    switch (action) {
      case 'warn':
        outranks(me, u.role);
        note('warning');
        d.hub.notice(`A moderator warned you${why ? `: ${why}` : ''}`, u.id);
        break;
      case 'mute': {
        outranks(me, u.role);
        const until = Date.now() + minutes() * MINUTE;
        d.db.run('UPDATE users SET muted_until = ? WHERE id = ?', until, u.id);
        note('mute', until);
        d.hub.notice(`You are muted in chat until ${new Date(until).toUTCString()}${why ? `: ${why}` : ''}`, u.id);
        break;
      }
      case 'unmute':
        d.db.run('UPDATE users SET muted_until = 0 WHERE id = ?', u.id);
        break;
      case 'suspend': {
        requireRole(ctx, 'admin');
        outranks(me, u.role);
        const until = Date.now() + minutes() * MINUTE;
        d.db.run('UPDATE users SET suspended_until = ? WHERE id = ?', until, u.id);
        d.accounts.endSessions(u.id);
        note('suspension', until);
        d.hub.disconnectUser(u.id, `Your account is suspended until ${new Date(until).toUTCString()}`);
        break;
      }
      case 'unsuspend':
        requireRole(ctx, 'admin');
        d.db.run('UPDATE users SET suspended_until = 0 WHERE id = ?', u.id);
        break;
      case 'ban': {
        requireRole(ctx, 'admin');
        outranks(me, u.role);
        reauth(ctx);
        d.db.run('UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?', why, u.id);
        d.accounts.endSessions(u.id);
        note('ban');
        if (ctx.body.ip === true) {
          const ips = d.db.all<{ ip: string }>('SELECT ip FROM user_ips WHERE user_id = ?', u.id);
          for (const { ip } of ips) d.db.run('INSERT OR IGNORE INTO ip_bans (ip, reason, created, by) VALUES (?, ?, ?, ?)', ip, why, Date.now(), me.name);
          out = { ok: true, ipsBanned: ips.length };
        }
        d.hub.disconnectUser(u.id, 'Your account has been banned');
        break;
      }
      case 'unban':
        requireRole(ctx, 'admin');
        reauth(ctx);
        d.db.run("UPDATE users SET banned = 0, ban_reason = '' WHERE id = ?", u.id);
        d.db.run('DELETE FROM ip_bans WHERE ip IN (SELECT ip FROM user_ips WHERE user_id = ?)', u.id);
        break;
      case 'rename': {
        requireRole(ctx, 'admin');
        const name = str(ctx, 'name');
        if (!NAME_RE.test(name)) throw new HttpError(400, 'Names are 3-16 letters, digits, spaces, dots, dashes or underscores');
        const other = d.accounts.byName(name);
        if (other && other.id !== u.id) throw new HttpError(409, 'That name is taken');
        d.db.run('UPDATE users SET name = ? WHERE id = ?', name, u.id);
        d.hub.refreshUser(u.id, { name });
        out = { ok: true, from: u.name, to: name };
        break;
      }
      case 'verify':
        requireRole(ctx, 'admin');
        d.db.run('UPDATE users SET verified = ? WHERE id = ?', ctx.body.verified === false ? 0 : 1, u.id);
        break;
      case 'reset':
        requireRole(ctx, 'admin');
        out = { ok: true, code: d.accounts.resetCode(u.id), note: 'Give the player this code; they enter it under Online > Sign In > Reset. It works once, for a day.' };
        break;
      case 'signout':
        requireRole(ctx, 'admin');
        d.accounts.endSessions(u.id);
        d.hub.disconnectUser(u.id, 'You have been signed out');
        break;
      case 'role': {
        requireRole(ctx, 'owner');
        reauth(ctx);
        const role = str(ctx, 'role') as Role;
        if (!['player', 'moderator', 'admin'].includes(role)) throw new HttpError(400, 'Roles are player, moderator or admin');
        d.db.run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
        d.hub.refreshUser(u.id, { role });
        out = { ok: true, role };
        break;
      }
      case 'delete':
        requireRole(ctx, 'owner');
        reauth(ctx);
        d.hub.disconnectUser(u.id, 'Your account has been deleted');
        d.db.tx(() => {
          d.db.run('DELETE FROM chat_blocks WHERE user_id = ? OR blocked_id = ?', u.id, u.id);
          d.db.run("UPDATE chat_log SET from_name = '[deleted]', text = '[deleted]' WHERE from_id = ?", u.id);
          d.db.run('DELETE FROM users WHERE id = ?', u.id);
        });
        break;
      default:
        throw new HttpError(400, 'Unknown action');
    }
    d.audit.log(me, `user.${action}`, `${u.name} (${u.id})`, { minutes: ctx.body.minutes, name: ctx.body.name, role: ctx.body.role, ip: ctx.body.ip }, why);
    return out;
  });

  app.route('POST', '/api/admin/invites', (ctx) => {
    const me = requireRole(ctx, 'admin');
    const code = d.accounts.createInvite(me.id);
    d.audit.log(me, 'invite.create', code);
    return { code };
  });

  // ---- Lobbies and games ----

  app.route('GET', '/api/admin/games', (ctx) => {
    requireRole(ctx, 'moderator');
    const online = d.hub.online();
    return {
      lobbies: [...d.lobbies.lobbies.values()].map((l) => ({
        ...d.lobbies.info(l), created: l.created, quick: l.quick, chatMuted: l.chatMuted,
        players: l.slots.filter((s) => s.kind === 'human').map((s) => ({
          ...s.user, team: s.team, ping: online.find((c) => c.identity.id === s.user?.id)?.ping, connected: online.some((c) => c.identity.id === s.user?.id),
        })),
        game: l.room ? {
          id: l.room.id, tick: l.room.match.tick, started: l.room.started, paused: l.room.paused, lag: l.room.lag, desyncs: l.room.desyncs,
          seats: l.room.seatStatus(), spectators: l.room.peers().length,
        } : null,
      })),
    };
  });

  app.route('POST', '/api/admin/games/:lobby/action', (ctx) => {
    const me = requireRole(ctx, 'moderator');
    const l = d.lobbies.lobbies.get(ctx.params.lobby!);
    if (!l) throw new HttpError(404, 'That lobby has closed');
    const action = str(ctx, 'action');
    const why = reason(ctx);
    switch (action) {
      case 'kick': {
        const user = str(ctx, 'user');
        const conn = d.hub.online().find((c) => c.identity.id === user);
        if (conn) d.lobbies.kick(conn, user, me.id);
        else if (l.room) {
          const peer = l.room.peers().find((p) => p.userId === user);
          if (peer) l.room.disconnect(peer, true);
        }
        d.hub.notice(`A moderator removed you from the game${why ? `: ${why}` : ''}`, user);
        break;
      }
      case 'pause':
      case 'resume':
        if (!l.room) throw new HttpError(400, 'No game is running there');
        l.room.setAdminPause(action === 'pause', why || undefined);
        break;
      case 'end':
        requireRole(ctx, 'admin');
        if (!l.room) throw new HttpError(400, 'No game is running there');
        l.room.end(why || 'Ended by an admin');
        break;
      case 'close':
        requireRole(ctx, 'admin');
        l.room?.end(why || 'Lobby closed by an admin');
        for (const c of [...l.members.values()]) {
          d.lobbies.leave(c);
          c.send({ t: 'notice', text: `An admin closed the lobby${why ? `: ${why}` : ''}` });
        }
        d.lobbies.lobbies.delete(l.id);
        break;
      case 'private':
        l.visibility = 'private';
        break;
      case 'mute':
      case 'unmute':
        l.chatMuted = action === 'mute';
        d.lobbies.system(l, action === 'mute' ? 'A moderator muted the chat here' : 'Chat is open again');
        break;
      case 'broadcast':
        d.lobbies.system(l, `[Admin] ${str(ctx, 'text', { max: 300 })}`);
        break;
      default:
        throw new HttpError(400, 'Unknown action');
    }
    d.audit.log(me, `game.${action}`, `${l.name} (${l.id})`, { user: ctx.body.user, text: ctx.body.text }, why);
    return { ok: true };
  });

  app.route('POST', '/api/admin/broadcast', (ctx) => {
    const me = requireRole(ctx, 'admin');
    const text = str(ctx, 'text', { max: 300 });
    d.hub.notice(`[Admin] ${text}`);
    for (const l of d.lobbies.lobbies.values()) d.lobbies.system(l, `[Admin] ${text}`);
    d.audit.log(me, 'broadcast', '', text);
    return { ok: true };
  });

  // ---- Chat ----

  app.route('GET', '/api/admin/chat', (ctx) => {
    requireRole(ctx, 'moderator');
    const q = ctx.query;
    return { messages: d.chat.search({ text: q.get('text') ?? undefined, user: q.get('user') ?? undefined, lobby: q.get('lobby') ?? undefined, before: Number(q.get('before')) || undefined }) };
  });

  app.route('GET', '/api/admin/chat/:id/context', (ctx) => {
    requireRole(ctx, 'moderator');
    return { messages: d.chat.context(Number(ctx.params.id)) };
  });

  app.route('GET', '/api/admin/reports', (ctx) => {
    requireRole(ctx, 'moderator');
    return { reports: d.chat.reports(ctx.query.get('all') !== '1') };
  });

  app.route('POST', '/api/admin/reports/:id', (ctx) => {
    const me = requireRole(ctx, 'moderator');
    const id = Number(ctx.params.id);
    const report = d.chat.reports(false, 1000).find((r) => r.id === id);
    if (!report) throw new HttpError(404, 'No such report');
    const action = str(ctx, 'action');
    const why = reason(ctx) || report.reason;
    const offender = report.message.from ? d.accounts.byId(report.message.from.id) : null;
    if (action !== 'dismiss' && offender) {
      outranks(me, offender.role);
      if (action === 'warn') {
        d.db.run('INSERT INTO warnings (user_id, at, by, kind, reason) VALUES (?, ?, ?, ?, ?)', offender.id, Date.now(), me.name, 'warning', why);
        d.hub.notice(`A moderator warned you about a chat message${why ? `: ${why}` : ''}`, offender.id);
      } else if (action === 'mute' || action === 'suspend') {
        if (action === 'suspend') requireRole(ctx, 'admin');
        const until = Date.now() + int(ctx, 'minutes', 1, 60 * 24 * 3650, action === 'mute' ? 60 : 60 * 24) * MINUTE;
        d.db.run(`UPDATE users SET ${action === 'mute' ? 'muted_until' : 'suspended_until'} = ? WHERE id = ?`, until, offender.id);
        d.db.run('INSERT INTO warnings (user_id, at, by, kind, reason, until) VALUES (?, ?, ?, ?, ?, ?)', offender.id, Date.now(), me.name, action === 'mute' ? 'mute' : 'suspension', why, until);
        if (action === 'suspend') {
          d.accounts.endSessions(offender.id);
          d.hub.disconnectUser(offender.id, `Your account is suspended until ${new Date(until).toUTCString()}`);
        } else d.hub.notice(`You are muted in chat until ${new Date(until).toUTCString()}`, offender.id);
      } else throw new HttpError(400, 'Unknown action');
    }
    d.chat.resolve(id, `${action} by ${me.name}${why ? `: ${why}` : ''}`);
    d.audit.log(me, `report.${action}`, offender ? `${offender.name} (${offender.id})` : String(report.message.from?.name ?? ''), { report: id, minutes: ctx.body.minutes }, why);
    return { ok: true };
  });

  // ---- Site ----

  app.route('GET', '/api/admin/settings', (ctx) => {
    requireRole(ctx, 'admin');
    return { settings: d.settings.get(), maps: d.maps.list() };
  });

  app.route('PUT', '/api/admin/settings', (ctx) => {
    const me = requireRole(ctx, 'admin');
    const patch = checkSettings(ctx.body.settings);
    d.settings.set(patch);
    if ('maintenance' in patch && patch.maintenance) {
      d.hub.notice(`Maintenance at ${new Date(patch.maintenance.at).toUTCString()}: ${patch.maintenance.message}`);
    }
    d.audit.log(me, 'settings', Object.keys(patch).join(', '), patch);
    return { settings: d.settings.get() };
  });

  app.route('GET', '/api/admin/audit', (ctx) => {
    requireRole(ctx, 'owner');
    const q = ctx.query;
    return { entries: d.audit.list({ before: Number(q.get('before')) || undefined, actor: q.get('actor') ?? undefined, action: q.get('action') ?? undefined }) };
  });

  app.route('POST', '/api/admin/assets/reload', (ctx) => {
    const me = requireRole(ctx, 'admin');
    d.maps.reload();
    d.audit.log(me, 'assets.reload');
    return { ready: d.maps.ready, maps: d.maps.list().length };
  });
}

/** Validates a settings patch from the admin panel. */
export function checkSettings(v: unknown): Partial<SiteSettings> {
  if (typeof v !== 'object' || v === null) throw new HttpError(400, 'settings must be an object');
  const s = v as Record<string, unknown>;
  const out: Partial<SiteSettings> = {};
  const bad = (k: string) => new HttpError(400, `Bad value for ${k}`);
  for (const k of Object.keys(s)) if (!(k in DEFAULT_SETTINGS)) throw new HttpError(400, `Unknown setting ${k}`);
  if ('signups' in s) {
    if (!['open', 'invite', 'closed'].includes(s.signups as string)) throw bad('signups');
    out.signups = s.signups as SiteSettings['signups'];
  }
  if ('maintenance' in s) {
    const m = s.maintenance as { at?: unknown; message?: unknown } | null;
    if (m !== null && (typeof m !== 'object' || typeof m.at !== 'number' || typeof m.message !== 'string')) throw bad('maintenance');
    out.maintenance = m ? { at: m.at as number, message: (m.message as string).slice(0, 300) } : null;
  }
  if ('motd' in s) out.motd = String(s.motd ?? '').slice(0, 300);
  if ('news' in s) {
    if (!Array.isArray(s.news) || s.news.length > 20) throw bad('news');
    out.news = s.news.map((n: { at?: unknown; title?: unknown; text?: unknown }) => ({
      at: typeof n.at === 'number' ? n.at : Date.now(), title: String(n.title ?? '').slice(0, 100), text: String(n.text ?? '').slice(0, 2000),
    }));
  }
  const intIn = (k: 'maxGames' | 'maxPerIp' | 'defaultDifficulty' | 'chatRetentionDays' | 'slowMode' | 'mapLimit' | 'replayLimit', min: number, max: number) => {
    if (!(k in s)) return;
    const n = s[k];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw bad(k);
    out[k] = n;
  };
  intIn('maxGames', 1, 1000);
  intIn('maxPerIp', 1, 100);
  intIn('defaultDifficulty', 1, 9);
  intIn('chatRetentionDays', 1, 3650);
  intIn('slowMode', 0, 600);
  intIn('mapLimit', 0, 10000);
  intIn('replayLimit', 0, 1000);
  if ('featuredMaps' in s) {
    if (!Array.isArray(s.featuredMaps) || s.featuredMaps.length > 50 || !s.featuredMaps.every((m) => typeof m === 'string')) throw bad('featuredMaps');
    out.featuredMaps = s.featuredMaps as string[];
  }
  if ('wordFilter' in s) {
    if (!Array.isArray(s.wordFilter) || s.wordFilter.length > 500 || !s.wordFilter.every((w) => typeof w === 'string')) throw bad('wordFilter');
    out.wordFilter = (s.wordFilter as string[]).map((w) => w.trim().slice(0, 50)).filter(Boolean);
  }
  if ('mapNameFilter' in s) {
    if (!Array.isArray(s.mapNameFilter) || s.mapNameFilter.length > 500 || !s.mapNameFilter.every((w) => typeof w === 'string')) throw bad('mapNameFilter');
    out.mapNameFilter = (s.mapNameFilter as string[]).map((w) => w.trim().slice(0, 50)).filter(Boolean);
  }
  return out;
}
