// A small router over node:http for the JSON API. Feature modules add routes with app.route(); a route's handler
// gets a Ctx with the request, path parameters, query, JSON body and the signed-in user, and returns what to send
// (an object is sent as JSON). Throwing HttpError answers with its status and message.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Identity, Role } from '@rfw/net';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The parsed JSON body (POST, PUT, PATCH, DELETE), or {}. */
  body: Record<string, unknown>;
  /** The signed-in account, or null. Guests have no HTTP identity. */
  user: Identity | null;
  /** The session id behind user, for sign-out and re-auth. */
  session: string | null;
  ip: string;
  /** Extra headers to send (cookies). */
  headers: Record<string, string | string[]>;
}

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

const ROLE_RANK: Record<Role, number> = { player: 0, moderator: 1, admin: 2, owner: 3 };

export function hasRole(user: Identity | null, role: Role): boolean {
  return !!user && !user.guest && ROLE_RANK[user.role] >= ROLE_RANK[role];
}

export function requireUser(ctx: Ctx): Identity {
  if (!ctx.user) throw new HttpError(401, 'Sign in first');
  return ctx.user;
}

export function requireRole(ctx: Ctx, role: Role): Identity {
  const u = requireUser(ctx);
  if (!hasRole(u, role)) throw new HttpError(403, 'Not allowed');
  return u;
}

/** Reads a string field from the body, trimmed, or throws 400. */
export function str(ctx: Ctx, key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  const v = ctx.body[key];
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw new HttpError(400, `${key} is required`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `${key} must be text`);
  const s = v.trim();
  if (opts.min !== undefined && s.length < opts.min) throw new HttpError(400, `${key} must be at least ${opts.min} characters`);
  if (opts.max !== undefined && s.length > opts.max) throw new HttpError(400, `${key} must be at most ${opts.max} characters`);
  return s;
}

export function int(ctx: Ctx, key: string, min: number, max: number, fallback?: number): number {
  const v = ctx.body[key] ?? ctx.query.get(key) ?? fallback;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    if (fallback !== undefined && v === undefined) return fallback;
    throw new HttpError(400, `${key} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, opts: { maxAge?: number; secure?: boolean } = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? '';
}

const MAX_BODY = 1 << 20;

async function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object');
  }
}

export interface AppHooks {
  /** Fills in ctx.user and ctx.session from the request (accounts.ts). */
  identify(ctx: Ctx): void;
  /** Throws HttpError(429) when a client sends too many requests (limits.ts). */
  limit(ctx: Ctx): void;
  trustProxy: boolean;
  /** Per-route body size limits, by path prefix. */
  bodyLimits?: Record<string, number>;
}

export class App {
  private readonly routes: Route[] = [];
  hooks: AppHooks = { identify: () => {}, limit: () => {}, trustProxy: false };

  route(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }

  private match(method: string, path: string): { route: Route; params: Record<string, string> } | null | 'method' {
    const parts = path.split('/').filter(Boolean);
    let wrongMethod = false;
    for (const route of this.routes) {
      if (route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length && ok; i++) {
        const p = route.parts[i]!;
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]!);
        else ok = p === parts[i];
      }
      if (!ok) continue;
      if (route.method !== method) {
        wrongMethod = true;
        continue;
      }
      return { route, params };
    }
    return wrongMethod ? 'method' : null;
  }

  /** Answers a request if it is for a route; returns false otherwise. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const method = req.method ?? 'GET';
    const found = this.match(method === 'HEAD' ? 'GET' : method, url.pathname);
    if (!found) return false;
    const ctx: Ctx = {
      req, res, method, path: url.pathname, params: {}, query: url.searchParams, body: {}, user: null, session: null,
      ip: clientIp(req, this.hooks.trustProxy), headers: {},
    };
    try {
      if (found === 'method') throw new HttpError(405, 'Method not allowed');
      ctx.params = found.params;
      this.hooks.limit(ctx);
      if (method !== 'GET' && method !== 'HEAD') {
        // Browsers send JSON here only from our own pages; a cross-site form cannot set this header.
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json') && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined) {
          throw new HttpError(415, 'Send JSON');
        }
        const limit = Object.entries(this.hooks.bodyLimits ?? {}).find(([p]) => url.pathname.startsWith(p))?.[1];
        ctx.body = await readBody(req, limit);
      }
      this.hooks.identify(ctx);
      const out = await found.route.handler(ctx);
      if (res.headersSent) return true;
      send(res, 200, out ?? { ok: true }, ctx.headers);
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return true;
      }
      if (err instanceof HttpError) send(res, err.status, { error: err.message }, ctx.headers);
      else {
        console.error(err);
        send(res, 500, { error: 'Server error' }, ctx.headers);
      }
    }
    return true;
  }
}

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}
