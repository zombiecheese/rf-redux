// The admin audit log (admin-roles): every admin and moderator action, with who did it, to what, when and why.
// Only the owner can read it.

import type { Identity } from '@rfw/net';
import type { Db } from './db.js';

export interface AuditEntry {
  id: number;
  at: number;
  actor: string;
  actorName: string;
  action: string;
  target: string;
  detail: string;
  reason: string;
}

export class Audit {
  constructor(private readonly db: Db) {
    db.migrate('audit', [`CREATE TABLE audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, actor_name TEXT NOT NULL,
      action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT ''
    ); CREATE INDEX audit_at ON audit (at)`]);
  }

  log(actor: Identity, action: string, target = '', detail: unknown = '', reason = ''): void {
    this.db.run(
      'INSERT INTO audit (at, actor, actor_name, action, target, detail, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
      Date.now(), actor.id, actor.name, action, target, typeof detail === 'string' ? detail : JSON.stringify(detail), reason,
    );
  }

  list(opts: { before?: number; limit?: number; actor?: string; action?: string } = {}): AuditEntry[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.before) (where.push('id < ?'), params.push(opts.before));
    if (opts.actor) (where.push('actor = ?'), params.push(opts.actor));
    if (opts.action) (where.push('action = ?'), params.push(opts.action));
    return this.db.all<{ id: number; at: number; actor: string; actor_name: string; action: string; target: string; detail: string; reason: string }>(
      `SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`, ...params, Math.min(opts.limit ?? 100, 500),
    ).map((r) => ({ id: r.id, at: r.at, actor: r.actor, actorName: r.actor_name, action: r.action, target: r.target, detail: r.detail, reason: r.reason }));
  }
}
