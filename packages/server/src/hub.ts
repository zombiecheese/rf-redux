// The game WebSocket (/ws): who is connected, their identity (an account's session cookie), pings for round-trip
// times, per-connection and per-IP limits, and handing each message to lobbies, chat or the match. Online play
// needs an account: a connection without one can only watch the lobby list.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { lobbyLighting, lobbyVisuals, 
  PROTOCOL_VERSION, decodeClientBinary,
  type ChatChannel, type ClientMessage, type Identity, type ServerMessage, type Visibility,
} from '@rfw/net';
import { identity, type Accounts } from './accounts.js';
import { ChatError, type Chat } from './chat.js';
import { clientIp } from './http.js';
import { Counter, Limiter } from './limits.js';
import { LobbyError, type Conn, type Lobbies } from './lobbies.js';
import type { Settings } from './settings.js';
import { accept, type Socket } from './ws.js';

const PING_MS = 5000;
/** A connection that has not answered a ping for this long is closed. */
const SILENT_MS = 30_000;

interface Live extends Conn {
  socket: Socket;
  helloed: boolean;
  lastHeard: number;
  connectedAt: number;
}

export class Hub {
  readonly conns = new Set<Live>();
  private readonly perIp = new Counter();
  private readonly jsonLimit = new Limiter(20, 60);
  private readonly binaryLimit = new Limiter(200, 400);
  private readonly timer: ReturnType<typeof setInterval>;
  /** Totals for the admin dashboard. */
  messages = 0;
  errors = 0;

  constructor(
    private readonly accounts: Accounts, private readonly lobbies: Lobbies, private readonly chat: Chat, private readonly settings: Settings,
    private readonly opts: { trustProxy: boolean },
  ) {
    this.timer = setInterval(() => this.heartbeat(), PING_MS);
    this.timer.unref?.();
  }

  close(): void {
    clearInterval(this.timer);
    for (const c of this.conns) c.socket.close(1001, 'Server restarting');
  }

  upgrade(req: IncomingMessage, sock: Duplex): void {
    const ip = clientIp(req, this.opts.trustProxy);
    const banned = this.accounts.ipBanned(ip);
    if (banned || this.perIp.count(ip) >= this.settings.get().maxPerIp) {
      sock.end(`HTTP/1.1 ${banned ? 403 : 429} ${banned ? 'Forbidden' : 'Too Many Requests'}\r\nConnection: close\r\n\r\n`);
      return;
    }
    const socket = accept(req, sock);
    if (!socket) return;
    const session = this.accounts.fromCookie(req.headers.cookie, ip);
    const c: Live = {
      id: randomBytes(6).toString('base64url'), userId: '', name: '', ip, socket, helloed: false, lastHeard: Date.now(), connectedAt: Date.now(),
      identity: session ? identity(session.user) : { id: '', name: '', guest: true, role: 'player' },
      lobby: null, room: null, watching: false,
      send: (msg: ServerMessage) => socket.sendText(JSON.stringify(msg)),
      sendBinary: (data: Uint8Array) => socket.sendBinary(data),
    };
    this.perIp.add(ip);
    this.conns.add(c);
    socket.onText = (text) => this.text(c, text);
    socket.onBinary = (data) => this.binary(c, data);
    socket.onClose = () => {
      this.conns.delete(c);
      this.perIp.remove(ip);
      if (c.helloed) this.lobbies.dropped(c);
    };
  }

  private hello(c: Live, msg: Extract<ClientMessage, { t: 'hello' }>): void {
    if (msg.version !== PROTOCOL_VERSION) {
      c.send({ t: 'reload', reason: 'The game has been updated; reload the page' });
      c.socket.close(4000, 'Old client');
      return;
    }
    c.userId = c.identity.id;
    c.name = c.identity.name;
    c.helloed = true;
    const s = this.settings.get();
    c.send({ t: 'welcome', version: PROTOCOL_VERSION, you: c.identity, motd: s.motd || undefined, maintenance: s.maintenance });
    // Back into a lobby or match this player is part of (a reload or a dropped connection).
    if (c.identity.guest) return;
    for (const l of this.lobbies.lobbies.values()) {
      if (l.slots.some((x) => x.user?.id === c.identity.id) && (l.state === 'playing' || !l.members.has(c.identity.id))) {
        this.lobbies.attach(c, l);
        break;
      }
    }
  }

  private text(c: Live, text: string): void {
    c.lastHeard = Date.now();
    this.messages++;
    if (!this.jsonLimit.take(c.id)) {
      c.send({ t: 'error', message: 'Too many messages; slow down' });
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
      if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') throw new Error();
    } catch {
      c.socket.close(1007, 'Bad message');
      return;
    }
    if (!c.helloed) {
      if (msg.t === 'hello') this.hello(c, msg);
      return;
    }
    try {
      this.dispatch(c, msg);
    } catch (err) {
      if (err instanceof LobbyError || err instanceof ChatError) c.send({ t: 'error', message: err.message });
      else {
        this.errors++;
        console.error(err);
        c.send({ t: 'error', message: 'Something went wrong' });
      }
    }
  }

  private dispatch(c: Live, msg: ClientMessage): void {
    const L = this.lobbies;
    // Online play needs an account: a visitor who is not signed in can only see the lobby list.
    if (c.identity.guest && msg.t !== 'pong' && msg.t !== 'lobbies') throw new LobbyError('Sign in to play online');
    switch (msg.t) {
      case 'pong':
        if (typeof msg.at === 'number') c.ping = Math.max(0, Date.now() - msg.at);
        return;
      case 'lobbies':
        return L.watch(c, !!msg.watch);
      case 'create':
        L.create(c, { name: str(msg.name, 40), mapId: String(msg.mapId), visibility: vis(msg.visibility), teams: teams(msg.teams) });
        return;
      case 'join':
        L.join(c, { id: str(msg.id, 40), code: str(msg.code, 12) });
        return;
      case 'quick':
        L.quick(c);
        return;
      case 'leave':
        return L.leave(c);
      case 'settings':
        if (msg.teams) L.layout(c, teams(msg.teams) ?? []);
        return L.settingsFor(c, { name: str(msg.name, 40), mapId: str(msg.mapId, 80), visibility: msg.visibility ? vis(msg.visibility) : undefined, difficulty: num(msg.difficulty), handicap: typeof msg.handicap === 'boolean' ? msg.handicap : undefined, visuals: msg.visuals === undefined ? undefined : lobbyVisuals(msg.visuals), lighting: msg.lighting === undefined ? undefined : lobbyLighting(msg.lighting) });
      case 'slot':
        return L.slot(c, Number(msg.slot), { kind: msg.kind === 'open' || msg.kind === 'closed' || msg.kind === 'bot' ? msg.kind : undefined, team: num(msg.team), difficulty: num(msg.difficulty) });
      case 'seat':
        return L.move(c, Number(msg.slot));
      case 'ready':
        return L.ready(c, !!msg.ready);
      case 'rematch':
        return L.ready(c, true);
      case 'kick':
        return L.kick(c, String(msg.user));
      case 'start':
        L.start(c);
        return;
      case 'chat':
        return L.say(c, chan(msg.channel), String(msg.text ?? ''), str(msg.to, 40));
      case 'mute':
        return this.chat.setBlocked(c.identity.id, String(msg.user), !!msg.muted);
      case 'report':
        this.chat.report(c.identity, Number(msg.message), String(msg.reason ?? ''));
        c.send({ t: 'notice', text: 'Thanks, a moderator will look at it' });
        return;
      case 'spectate':
        return L.spectate(c, String(msg.gameId));
      case 'loaded':
        return c.room?.loaded(c);
      case 'quitGame':
        if (c.room && c.lobby?.members.get(c.identity.id) === c) {
          c.room.disconnect(c, true);
          c.room = null;
        } else L.stopWatching(c);
        return;
      case 'desyncReport':
        if (msg.snapshot && typeof msg.tick === 'number') c.room?.desyncReport(c, msg.tick, msg.snapshot);
        return;
      case 'hello':
        return;
      default:
        c.send({ t: 'error', message: 'Unknown message' });
    }
  }

  private binary(c: Live, data: Uint8Array): void {
    c.lastHeard = Date.now();
    if (!c.helloed || !c.room) return;
    if (!this.binaryLimit.take(c.id)) return;
    const m = decodeClientBinary(data);
    if (!m) return;
    if (m.type === 'input') c.room.input(c, m.input);
    else if (m.type === 'command') c.room.command(c, m.code);
    else c.room.hash(c, m.tick, m.hash);
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const c of this.conns) {
      if (now - c.lastHeard > SILENT_MS) {
        c.socket.close(1001, 'No reply');
        continue;
      }
      c.send({ t: 'ping', at: now });
    }
    this.jsonLimit.sweep(now);
    this.binaryLimit.sweep(now);
  }

  // ---- Admin ----

  online(): Live[] {
    return [...this.conns].filter((c) => c.helloed);
  }

  /** Sends a notice to everyone (or one user's connections). */
  notice(text: string, userId?: string): void {
    for (const c of this.online()) if (!userId || c.identity.id === userId) c.send({ t: 'notice', text });
  }

  /** Closes a user's connections (after a ban or suspension). */
  disconnectUser(userId: string, reason: string): void {
    for (const c of this.online()) {
      if (c.identity.id !== userId) continue;
      c.send({ t: 'notice', text: reason });
      this.lobbies.leave(c);
      c.socket.close(4001, reason.slice(0, 100));
    }
  }

  /** Updates a signed-in user's name or role on their live connections. */
  refreshUser(userId: string, patch: Partial<Identity>): void {
    for (const c of this.online()) {
      if (c.identity.id !== userId) continue;
      c.identity = { ...c.identity, ...patch };
      c.name = c.identity.name;
    }
  }
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function vis(v: unknown): Visibility {
  return v === 'private' ? 'private' : 'open';
}

function chan(v: unknown): ChatChannel {
  return v === 'team' || v === 'whisper' ? v : 'all';
}

function teams(v: unknown): number[] | undefined {
  return Array.isArray(v) && v.length <= 4 && v.every((n) => Number.isInteger(n) && n >= 1 && n <= 4) ? (v as number[]) : undefined;
}
