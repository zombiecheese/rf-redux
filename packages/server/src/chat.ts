// Chat (chat, admin-chat): every lobby and running game has one, with messages to everyone, to the sender's team
// or to one player. This module checks and stores messages; lobbies.ts decides who receives them. Players can
// block each other; admins and moderators mute players, read the logs, work through reports and keep the word
// filter. Logs are kept for the site's retention setting.

import { CHAT_MAX, type ChatChannel, type ChatMessage, type Identity } from '@rfw/net';
import type { Accounts } from './accounts.js';
import type { Db } from './db.js';
import { Limiter } from './limits.js';
import type { Settings } from './settings.js';

export class ChatError extends Error {}

export interface ChatLogEntry extends ChatMessage {
  lobby: string;
  /** The lobby's game when the message was sent, if one was running. */
  game: string | null;
}

export interface ChatReport {
  id: number;
  at: number;
  reporter: { id: string; name: string };
  reason: string;
  message: ChatLogEntry;
  resolved: boolean;
  resolution: string;
}

interface LogRow {
  id: number; at: number; lobby: string; game: string | null; channel: ChatChannel; from_id: string | null; from_name: string | null;
  to_id: string | null; to_name: string | null; text: string; system: number;
}

function fromRow(r: LogRow): ChatLogEntry {
  return {
    id: r.id, at: r.at, lobby: r.lobby, game: r.game, channel: r.channel, text: r.text, system: !!r.system || undefined,
    from: r.from_id ? { id: r.from_id, name: r.from_name ?? '' } : null,
    to: r.to_id ? { id: r.to_id, name: r.to_name ?? '' } : undefined,
  };
}

export class Chat {
  /** Five messages in a burst, then one a second. */
  private readonly flood = new Limiter(1, 5);
  private readonly lastSent = new Map<string, number>();
  private filter: RegExp | null = null;

  constructor(private readonly db: Db, private readonly settings: Settings, private readonly accounts: Accounts) {
    db.migrate('chat', [
      `CREATE TABLE chat_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, lobby TEXT NOT NULL, game TEXT, channel TEXT NOT NULL,
        from_id TEXT, from_name TEXT, to_id TEXT, to_name TEXT, text TEXT NOT NULL, system INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX chat_log_at ON chat_log (at);
      CREATE INDEX chat_log_from ON chat_log (from_id);
      CREATE INDEX chat_log_lobby ON chat_log (lobby);
      CREATE TABLE chat_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, reporter_id TEXT NOT NULL, reporter_name TEXT NOT NULL,
        message_id INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', resolved INTEGER NOT NULL DEFAULT 0, resolution TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE chat_blocks (user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, PRIMARY KEY (user_id, blocked_id));`,
    ]);
    this.compileFilter();
    settings.onChange(() => this.compileFilter());
  }

  private compileFilter(): void {
    const words = this.settings.get().wordFilter.map((w) => w.trim()).filter(Boolean);
    const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.filter = words.length ? new RegExp(`\\b(${words.map(esc).join('|')})\\b`, 'gi') : null;
  }

  /** The text as it will be sent (trimmed, filtered), or throws ChatError saying why it cannot be. */
  check(sender: Identity, text: string, now = Date.now()): string {
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CHAT_MAX);
    if (!clean) throw new ChatError('Empty message');
    if (!sender.guest) {
      const u = this.accounts.byId(sender.id);
      if (u && u.mutedUntil > now) throw new ChatError(`You are muted until ${new Date(u.mutedUntil).toUTCString()}`);
    }
    if (!this.flood.take(sender.id, 1, now)) throw new ChatError('Slow down');
    const slow = this.settings.get().slowMode;
    const last = this.lastSent.get(sender.id) ?? 0;
    if (slow > 0 && now - last < slow * 1000 && sender.role === 'player') throw new ChatError(`Slow mode: one message every ${slow}s`);
    this.lastSent.set(sender.id, now);
    return this.filter ? clean.replace(this.filter, (w) => '*'.repeat(w.length)) : clean;
  }

  /** Stores a message and gives it its id. */
  log(lobby: string, game: string | null, m: Omit<ChatMessage, 'id'>): ChatMessage {
    const r = this.db.run(
      'INSERT INTO chat_log (at, lobby, game, channel, from_id, from_name, to_id, to_name, text, system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      m.at, lobby, game, m.channel, m.from?.id ?? null, m.from?.name ?? null, m.to?.id ?? null, m.to?.name ?? null, m.text, m.system ? 1 : 0,
    );
    return { ...m, id: r.lastInsertRowid };
  }

  /** Messages in a lobby that this user may read, oldest first. */
  history(lobby: string, viewer: string, team: (userId: string) => number | null, limit = 50): ChatMessage[] {
    const rows = this.db.all<LogRow>('SELECT * FROM chat_log WHERE lobby = ? ORDER BY id DESC LIMIT ?', lobby, limit * 2).map(fromRow);
    const myTeam = team(viewer);
    const blocked = this.blocked(viewer);
    return rows
      .filter((m) => !(m.from && blocked.has(m.from.id)))
      .filter((m) => m.channel === 'all' || (m.channel === 'whisper' && (m.from?.id === viewer || m.to?.id === viewer))
        || (m.channel === 'team' && myTeam !== null && m.from !== null && team(m.from.id) === myTeam))
      .slice(0, limit)
      .reverse()
      .map(({ lobby: _l, game: _g, ...m }) => m);
  }

  blocked(userId: string): Set<string> {
    return new Set(this.db.all<{ blocked_id: string }>('SELECT blocked_id FROM chat_blocks WHERE user_id = ?', userId).map((r) => r.blocked_id));
  }

  setBlocked(userId: string, other: string, on: boolean): void {
    if (on) this.db.run('INSERT OR IGNORE INTO chat_blocks (user_id, blocked_id) VALUES (?, ?)', userId, other);
    else this.db.run('DELETE FROM chat_blocks WHERE user_id = ? AND blocked_id = ?', userId, other);
  }

  report(reporter: Identity, messageId: number, reason: string): void {
    if (!this.db.get('SELECT 1 FROM chat_log WHERE id = ?', messageId)) throw new ChatError('No such message');
    if (!this.flood.take(`report:${reporter.id}`, 1)) throw new ChatError('Slow down');
    this.db.run('INSERT INTO chat_reports (at, reporter_id, reporter_name, message_id, reason) VALUES (?, ?, ?, ?, ?)',
      Date.now(), reporter.id, reporter.name, messageId, reason.slice(0, 200));
  }

  // ---- Admin ----

  search(opts: { text?: string; user?: string; lobby?: string; before?: number; limit?: number }): ChatLogEntry[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.text) (where.push('text LIKE ?'), params.push(`%${opts.text}%`));
    if (opts.user) (where.push('(from_id = ? OR to_id = ? OR from_name = ?)'), params.push(opts.user, opts.user, opts.user));
    if (opts.lobby) (where.push('lobby = ?'), params.push(opts.lobby));
    if (opts.before) (where.push('id < ?'), params.push(opts.before));
    return this.db.all<LogRow>(`SELECT * FROM chat_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`,
      ...params, Math.min(opts.limit ?? 100, 500)).map(fromRow);
  }

  context(messageId: number, around = 5): ChatLogEntry[] {
    const m = this.db.get<LogRow>('SELECT * FROM chat_log WHERE id = ?', messageId);
    if (!m) return [];
    const before = this.db.all<LogRow>('SELECT * FROM chat_log WHERE lobby = ? AND id <= ? ORDER BY id DESC LIMIT ?', m.lobby, messageId, around + 1);
    const after = this.db.all<LogRow>('SELECT * FROM chat_log WHERE lobby = ? AND id > ? ORDER BY id LIMIT ?', m.lobby, messageId, around);
    return [...before.reverse(), ...after].map(fromRow);
  }

  reports(open = true, limit = 100): ChatReport[] {
    const rows = this.db.all<{ id: number; at: number; reporter_id: string; reporter_name: string; reason: string; message_id: number; resolved: number; resolution: string }>(
      `SELECT * FROM chat_reports ${open ? 'WHERE resolved = 0' : ''} ORDER BY id DESC LIMIT ?`, limit);
    return rows.flatMap((r) => {
      const m = this.db.get<LogRow>('SELECT * FROM chat_log WHERE id = ?', r.message_id);
      if (!m) return [];
      return [{ id: r.id, at: r.at, reporter: { id: r.reporter_id, name: r.reporter_name }, reason: r.reason, message: fromRow(m), resolved: !!r.resolved, resolution: r.resolution }];
    });
  }

  openReports(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chat_reports WHERE resolved = 0')!.n;
  }

  resolve(reportId: number, resolution: string): void {
    this.db.run('UPDATE chat_reports SET resolved = 1, resolution = ? WHERE id = ?', resolution, reportId);
  }

  /** Drops messages older than the retention setting (and reports on them). */
  prune(now = Date.now()): void {
    const cutoff = now - this.settings.get().chatRetentionDays * 86400e3;
    this.db.run('DELETE FROM chat_reports WHERE message_id IN (SELECT id FROM chat_log WHERE at < ?) AND resolved = 1', cutoff);
    this.db.run('DELETE FROM chat_log WHERE at < ? AND id NOT IN (SELECT message_id FROM chat_reports WHERE resolved = 0)', cutoff);
  }
}
