// Accounts and sign-in (accounts, admin-roles): sign-up with a name, email and password (scrypt), sessions as
// HttpOnly cookies, roles, and the moderation state the admin panel sets (mutes, suspensions, bans). Online play
// needs an account; the game itself plays offline without one.
//
// The owner account comes from the deployment (OWNER_NAME, OWNER_EMAIL, OWNER_PASSWORD; see main.ts): it is made at
// start if missing, and nobody becomes owner by signing up. There is no email delivery: an admin hands a player a
// one-time reset code instead.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Identity, Role } from '@rfw/net';
import type { Db } from './db.js';
import { HttpError, cookie, parseCookies, requireUser, str, type App, type Ctx } from './http.js';
import { Limiter } from './limits.js';
import type { Settings } from './settings.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const SESSION_COOKIE = 'rfw_session';
const SESSION_DAYS = 30;
/** Destructive admin actions need the password again within this long (admin-roles). */
export const REAUTH_MS = 10 * 60 * 1000;
export const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{1,14}[A-Za-z0-9_.]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 << 20 };

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  created: number;
  lastSeen: number;
  verified: boolean;
  mutedUntil: number;
  suspendedUntil: number;
  banned: boolean;
  banReason: string;
}

interface UserRow {
  id: string; name: string; email: string; pass: string; role: Role; created: number; last_seen: number; verified: number;
  muted_until: number; suspended_until: number; banned: number; ban_reason: string;
}

function toUser(r: UserRow): User {
  return {
    id: r.id, name: r.name, email: r.email, role: r.role, created: r.created, lastSeen: r.last_seen, verified: !!r.verified,
    mutedUntil: r.muted_until, suspendedUntil: r.suspended_until, banned: !!r.banned, banReason: r.ban_reason,
  };
}

export function identity(u: User): Identity {
  return { id: u.id, name: u.name, guest: false, role: u.role };
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 << 20 });
  return timingSafeEqual(want, got);
}

const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
const digest = (t: string) => createHash('sha256').update(t).digest('base64url');

export class Accounts {
  private readonly signinLimit = new Limiter(0.2, 8);
  private readonly signupLimit = new Limiter(1 / 60, 5);

  constructor(private readonly db: Db, private readonly settings: Settings, private readonly opts: { secureCookies: boolean }) {
    db.migrate('accounts', [
      `CREATE TABLE users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE COLLATE NOCASE, pass TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'player', created INTEGER NOT NULL, last_seen INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
        muted_until INTEGER NOT NULL DEFAULT 0, suspended_until INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0,
        ban_reason TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, created INTEGER NOT NULL,
        last_seen INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '', agent TEXT NOT NULL DEFAULT '', reauth_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX sessions_user ON sessions (user_id);
      CREATE TABLE user_ips (user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, ip TEXT NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (user_id, ip));
      CREATE TABLE ip_bans (ip TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, by TEXT NOT NULL DEFAULT '');
      CREATE TABLE invites (code TEXT PRIMARY KEY, created_by TEXT NOT NULL, created INTEGER NOT NULL, used_by TEXT, used_at INTEGER);
      CREATE TABLE resets (code TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, at INTEGER NOT NULL, by TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', until INTEGER NOT NULL DEFAULT 0);`,
    ]);
  }

  // ---- Lookup ----

  byId(id: string): User | null {
    const r = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    return r ? toUser(r) : null;
  }

  byName(name: string): User | null {
    const r = this.db.get<UserRow>('SELECT * FROM users WHERE name = ?', name);
    return r ? toUser(r) : null;
  }

  count(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
  }

  /** Why this user may not sign in or play right now, or null. */
  blocked(u: User, now = Date.now()): string | null {
    if (u.banned) return `This account is banned${u.banReason ? `: ${u.banReason}` : ''}`;
    if (u.suspendedUntil > now) return `This account is suspended until ${new Date(u.suspendedUntil).toUTCString()}`;
    return null;
  }

  ipBanned(ip: string): string | null {
    const r = this.db.get<{ reason: string }>('SELECT reason FROM ip_bans WHERE ip = ?', ip);
    return r ? r.reason || 'banned' : null;
  }

  /** The signed-in user for a Cookie header, or null; touches the session. */
  fromCookie(header: string | undefined, ip = ''): { user: User; session: string } | null {
    const t = parseCookies(header)[SESSION_COOKIE];
    if (!t) return null;
    const id = digest(t);
    const s = this.db.get<{ user_id: string; last_seen: number; created: number }>('SELECT user_id, last_seen, created FROM sessions WHERE id = ?', id);
    const now = Date.now();
    if (!s || s.created + SESSION_DAYS * 86400e3 < now) return null;
    const u = this.byId(s.user_id);
    if (!u || this.blocked(u, now)) return null;
    if (now - s.last_seen > 60e3) {
      this.db.run('UPDATE sessions SET last_seen = ?, ip = ? WHERE id = ?', now, ip, id);
      this.db.run('UPDATE users SET last_seen = ? WHERE id = ?', now, u.id);
      if (ip) this.db.run('INSERT INTO user_ips (user_id, ip, last_seen) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET last_seen = excluded.last_seen', u.id, ip, now);
    }
    return { user: u, session: id };
  }

  identify(ctx: Ctx): void {
    const s = this.fromCookie(ctx.req.headers.cookie, ctx.ip);
    ctx.user = s ? identity(s.user) : null;
    ctx.session = s?.session ?? null;
  }

  reauthed(session: string | null): boolean {
    if (!session) return false;
    const r = this.db.get<{ reauth_at: number }>('SELECT reauth_at FROM sessions WHERE id = ?', session);
    return !!r && Date.now() - r.reauth_at < REAUTH_MS;
  }

  // ---- Changes ----

  async signUp(name: string, email: string, password: string, ip: string, invite?: string): Promise<User> {
    const s = this.settings.get();
    if (s.signups === 'closed') throw new HttpError(403, 'Sign-ups are closed');
    if (this.ipBanned(ip)) throw new HttpError(403, 'Sign-ups are not available from this address');
    if (!NAME_RE.test(name)) throw new HttpError(400, 'Names are 3-16 letters, digits, spaces, dots, dashes or underscores');
    if (/^guest/i.test(name)) throw new HttpError(400, 'Names starting with Guest are kept for guests');
    if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email address');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Passwords are at least 8 characters');
    if (s.signups === 'invite') {
      const inv = invite && this.db.get<{ used_by: string | null }>('SELECT used_by FROM invites WHERE code = ?', invite);
      if (!inv || inv.used_by) throw new HttpError(403, 'Sign-ups need an invite code');
    }
    if (this.byName(name)) throw new HttpError(409, 'That name is taken');
    if (this.db.get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'That email already has an account');
    const id = token(9);
    const now = Date.now();
    const pass = await hashPassword(password);
    this.db.tx(() => {
      this.db.run('INSERT INTO users (id, name, email, pass, role, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)', id, name, email, pass, 'player', now, now);
      if (s.signups === 'invite' && invite) this.db.run('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?', id, now, invite);
    });
    return this.byId(id)!;
  }

  async signIn(login: string, password: string): Promise<User> {
    const r = this.db.get<UserRow>('SELECT * FROM users WHERE name = ? OR email = ?', login, login);
    if (!r || !(await checkPassword(password, r.pass))) throw new HttpError(401, 'Wrong name or password');
    const u = toUser(r);
    const why = this.blocked(u);
    if (why) throw new HttpError(403, why);
    return u;
  }

  startSession(ctx: Ctx, u: User): void {
    const t = token();
    const now = Date.now();
    this.db.run('INSERT INTO sessions (id, user_id, created, last_seen, ip, agent, reauth_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      digest(t), u.id, now, now, ctx.ip, String(ctx.req.headers['user-agent'] ?? '').slice(0, 200), now);
    this.db.run('INSERT INTO user_ips (user_id, ip, last_seen) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET last_seen = excluded.last_seen', u.id, ctx.ip, now);
    ctx.headers['set-cookie'] = cookie(SESSION_COOKIE, t, { maxAge: SESSION_DAYS * 86400, secure: this.opts.secureCookies });
    ctx.user = identity(u);
  }

  /**
   * The owner from the deployment's settings: made if no account has that email, and otherwise given the owner role
   * and that name. The password is set when the account is made and again whenever the configured one changes (so
   * changing OWNER_PASSWORD and restarting resets it), but a password changed in the game stays until then.
   */
  async ensureOwner(o: { name: string; email: string; password: string }): Promise<'created' | 'updated' | 'unchanged'> {
    if (!NAME_RE.test(o.name)) throw new Error('OWNER_NAME must be 3-16 letters, digits, spaces, dots, dashes or underscores');
    if (!EMAIL_RE.test(o.email) || o.email.length > 200) throw new Error('OWNER_EMAIL is not a valid email address');
    if (o.password.length < 8 || o.password.length > 200) throw new Error('OWNER_PASSWORD must be at least 8 characters');
    this.db.migrate('owner', ['CREATE TABLE owner_env (email TEXT PRIMARY KEY COLLATE NOCASE, pass TEXT NOT NULL)']);
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', o.email);
    const clash = this.byName(o.name);
    if (clash && clash.id !== row?.id) throw new Error(`OWNER_NAME "${o.name}" belongs to another account`);
    const applied = this.db.get<{ pass: string }>('SELECT pass FROM owner_env WHERE email = ?', o.email);
    const newPassword = !applied || !(await checkPassword(o.password, applied.pass));
    const stamp = async () => this.db.run('INSERT INTO owner_env (email, pass) VALUES (?, ?) ON CONFLICT DO UPDATE SET pass = excluded.pass', o.email, await hashPassword(o.password));
    if (!row) {
      const now = Date.now();
      this.db.run('INSERT INTO users (id, name, email, pass, role, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)',
        token(9), o.name, o.email, await hashPassword(o.password), 'owner', now, now);
      await stamp();
      return 'created';
    }
    if (row.role === 'owner' && row.name === o.name && !newPassword) return 'unchanged';
    this.db.run('UPDATE users SET role = ?, name = ? WHERE id = ?', 'owner', o.name, row.id);
    if (newPassword) {
      await this.setPassword(row.id, o.password);
      this.endSessions(row.id);
      await stamp();
    }
    return 'updated';
  }

  async setPassword(userId: string, password: string): Promise<void> {
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Passwords are at least 8 characters');
    this.db.run('UPDATE users SET pass = ? WHERE id = ?', await hashPassword(password), userId);
  }

  endSessions(userId: string, except?: string): void {
    if (except) this.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, except);
    else this.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  /** A one-time code (valid a day) the player can use to set a new password. */
  resetCode(userId: string): string {
    const code = token(9);
    this.db.run('INSERT INTO resets (code, user_id, expires) VALUES (?, ?, ?)', digest(code), userId, Date.now() + 86400e3);
    return code;
  }

  createInvite(by: string): string {
    const code = token(6);
    this.db.run('INSERT INTO invites (code, created_by, created) VALUES (?, ?, ?)', code, by, Date.now());
    return code;
  }

  // ---- Routes ----

  install(app: App): void {
    app.route('POST', '/api/auth/signup', async (ctx) => {
      if (!this.signupLimit.take(ctx.ip)) throw new HttpError(429, 'Too many sign-ups from this address; try again later');
      const u = await this.signUp(str(ctx, 'name'), str(ctx, 'email'), String(ctx.body.password ?? ''), ctx.ip, str(ctx, 'invite', { optional: true }) || undefined);
      this.startSession(ctx, u);
      return { user: identity(u) };
    });

    app.route('POST', '/api/auth/signin', async (ctx) => {
      if (!this.signinLimit.take(ctx.ip)) throw new HttpError(429, 'Too many tries; wait a minute');
      const banned = this.ipBanned(ctx.ip);
      if (banned) throw new HttpError(403, 'Sign-in is not available from this address');
      const u = await this.signIn(str(ctx, 'login'), String(ctx.body.password ?? ''));
      this.startSession(ctx, u);
      return { user: identity(u) };
    });

    app.route('POST', '/api/auth/signout', (ctx) => {
      if (ctx.session) this.db.run('DELETE FROM sessions WHERE id = ?', ctx.session);
      ctx.headers['set-cookie'] = cookie(SESSION_COOKIE, '', { maxAge: 0, secure: this.opts.secureCookies });
      return { ok: true };
    });

    app.route('POST', '/api/auth/password', async (ctx) => {
      const me = requireUser(ctx);
      const r = this.db.get<{ pass: string }>('SELECT pass FROM users WHERE id = ?', me.id)!;
      if (!(await checkPassword(String(ctx.body.current ?? ''), r.pass))) throw new HttpError(401, 'Wrong password');
      await this.setPassword(me.id, String(ctx.body.password ?? ''));
      this.endSessions(me.id, ctx.session ?? undefined);
      return { ok: true };
    });

    app.route('POST', '/api/auth/reauth', async (ctx) => {
      const me = requireUser(ctx);
      if (!this.signinLimit.take(ctx.ip)) throw new HttpError(429, 'Too many tries; wait a minute');
      const r = this.db.get<{ pass: string }>('SELECT pass FROM users WHERE id = ?', me.id)!;
      if (!(await checkPassword(String(ctx.body.password ?? ''), r.pass))) throw new HttpError(401, 'Wrong password');
      this.db.run('UPDATE sessions SET reauth_at = ? WHERE id = ?', Date.now(), ctx.session);
      return { ok: true, until: Date.now() + REAUTH_MS };
    });

    app.route('POST', '/api/auth/reset', async (ctx) => {
      if (!this.signinLimit.take(ctx.ip)) throw new HttpError(429, 'Too many tries; wait a minute');
      const code = digest(str(ctx, 'code'));
      const r = this.db.get<{ user_id: string; expires: number }>('SELECT user_id, expires FROM resets WHERE code = ?', code);
      if (!r || r.expires < Date.now()) throw new HttpError(400, 'That reset code is not valid');
      await this.setPassword(r.user_id, String(ctx.body.password ?? ''));
      this.db.run('DELETE FROM resets WHERE user_id = ?', r.user_id);
      this.endSessions(r.user_id);
      const u = this.byId(r.user_id)!;
      const why = this.blocked(u);
      if (why) throw new HttpError(403, why);
      this.startSession(ctx, u);
      return { user: identity(u) };
    });

    app.route('GET', '/api/auth/options', () => {
      const s = this.settings.get();
      return { signups: s.signups };
    });

    app.route('GET', '/api/me', (ctx) => ({ user: ctx.user }));
  }
}
