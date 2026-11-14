// Friends: a signed-in player asks another by name, and once they accept, each sees the other in their friends list
// with whether they are online, in a lobby or playing. From there a friend can join an open lobby, watch a game
// (private games too, which strangers cannot watch) or be invited to the lobby you are in: the invite arrives over
// the game WebSocket with the lobby's code. A player who has blocked you (chat block) never sees your requests.

import type { FriendInfo, FriendsList } from '@rfw/net';
import type { Accounts } from './accounts.js';
import type { Chat } from './chat.js';
import type { Db } from './db.js';
import { HttpError, requireUser, str, type App } from './http.js';
import type { Hub } from './hub.js';
import type { Lobby } from './lobbies.js';
import { Limiter } from './limits.js';

/** Friends (and requests) one account may have. */
export const MAX_FRIENDS = 200;

export class Friends {
  /** Set once the hub exists: who is online, and in which lobby. */
  hub: Hub | null = null;
  private readonly asks = new Limiter(1 / 10, 10);
  private readonly invites = new Limiter(1 / 5, 6);

  constructor(private readonly db: Db, private readonly accounts: Accounts, private readonly chat: Chat) {
    db.migrate('friends', [
      `CREATE TABLE friends (
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE, friend_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        accepted INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (user_id, friend_id)
      );
      CREATE INDEX friends_friend ON friends (friend_id);`,
    ]);
  }

  /** True when the two have accepted each other. */
  areFriends(a: string, b: string): boolean {
    return !!this.db.get('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND accepted = 1', a, b);
  }

  /** Whether a viewer may watch a private lobby's game: a friend of anyone playing in it. */
  mayWatch(userId: string, l: Lobby): boolean {
    return [...l.members.keys()].some((m) => this.areFriends(userId, m));
  }

  private nameOf(id: string): string {
    return this.accounts.byId(id)?.name ?? '?';
  }

  private conns(userId: string) {
    return this.hub?.online().filter((c) => c.identity.id === userId) ?? [];
  }

  private poke(userId: string, notice?: string): void {
    for (const c of this.conns(userId)) c.send({ t: 'friends', ...(notice ? { notice } : {}) });
  }

  private info(viewer: string, id: string): FriendInfo {
    const conns = this.conns(id);
    const inLobby = conns.find((c) => c.lobby)?.lobby ?? null;
    const watching = conns.find((c) => c.room && !c.lobby)?.room ?? null;
    const base: FriendInfo = { name: this.nameOf(id), status: conns.length ? 'online' : 'offline' };
    if (inLobby) {
      const open = inLobby.visibility === 'open';
      return {
        ...base, status: inLobby.state === 'playing' ? 'playing' : 'lobby', lobbyName: inLobby.name,
        ...(open && inLobby.state === 'waiting' && inLobby.slots.some((s) => s.kind === 'open') ? { joinId: inLobby.id } : {}),
        ...(inLobby.room && (open || this.mayWatch(viewer, inLobby)) ? { gameId: inLobby.room.id } : {}),
      };
    }
    if (watching) return { ...base, status: 'watching', gameId: watching.id };
    return base;
  }

  list(userId: string): FriendsList {
    const out = this.db.all<{ friend_id: string; accepted: number }>('SELECT friend_id, accepted FROM friends WHERE user_id = ?', userId);
    const incoming = this.db.all<{ user_id: string }>('SELECT user_id FROM friends WHERE friend_id = ? AND accepted = 0', userId)
      .filter((r) => !this.chat.blocked(userId).has(r.user_id));
    const order = { playing: 0, lobby: 1, watching: 2, online: 3, offline: 4 };
    return {
      friends: out.filter((r) => r.accepted).map((r) => this.info(userId, r.friend_id))
        .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name)),
      incoming: incoming.map((r) => this.nameOf(r.user_id)).sort(),
      outgoing: out.filter((r) => !r.accepted).map((r) => this.nameOf(r.friend_id)).sort(),
    };
  }

  /** Asks someone to be friends, or accepts if they already asked. */
  ask(userId: string, name: string): 'sent' | 'friends' {
    const other = this.accounts.byName(name);
    if (!other || other.id === userId) throw new HttpError(404, 'No player by that name');
    if (this.areFriends(userId, other.id)) return 'friends';
    if (this.db.get('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?', other.id, userId)) return this.accept(userId, other.name);
    const count = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?', userId)!.n;
    if (count >= MAX_FRIENDS) throw new HttpError(409, `You can have up to ${MAX_FRIENDS} friends and requests`);
    if (!this.asks.take(userId)) throw new HttpError(429, 'Too many friend requests; wait a minute');
    this.db.run('INSERT OR IGNORE INTO friends (user_id, friend_id, accepted, at) VALUES (?, ?, 0, ?)', userId, other.id, Date.now());
    // Someone who blocked you is not told.
    if (!this.chat.blocked(other.id).has(userId)) this.poke(other.id, `${this.nameOf(userId)} wants to be friends (Online > Friends)`);
    return 'sent';
  }

  accept(userId: string, name: string): 'friends' {
    const other = this.accounts.byName(name);
    const asked = other && this.db.get('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?', other.id, userId);
    if (!other || !asked) throw new HttpError(404, 'No friend request from that player');
    this.db.tx(() => {
      this.db.run('UPDATE friends SET accepted = 1 WHERE user_id = ? AND friend_id = ?', other.id, userId);
      this.db.run('INSERT INTO friends (user_id, friend_id, accepted, at) VALUES (?, ?, 1, ?) ON CONFLICT DO UPDATE SET accepted = 1',
        userId, other.id, Date.now());
    });
    this.poke(other.id, `${this.nameOf(userId)} is now your friend`);
    return 'friends';
  }

  /** Unfriends, cancels a request you sent or turns down one you got. */
  remove(userId: string, name: string): void {
    const other = this.accounts.byName(name);
    if (!other) throw new HttpError(404, 'No player by that name');
    this.db.run('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', userId, other.id, other.id, userId);
    this.poke(other.id);
  }

  /** Invites a friend to the lobby you are in. */
  invite(userId: string, name: string): void {
    const other = this.accounts.byName(name);
    if (!other || !this.areFriends(userId, other.id)) throw new HttpError(404, 'You can only invite your friends');
    const lobby = this.conns(userId).find((c) => c.lobby)?.lobby;
    if (!lobby) throw new HttpError(409, 'Join or host a lobby first');
    const to = this.conns(other.id);
    if (!to.length) throw new HttpError(409, `${other.name} is not online`);
    if (!this.invites.take(userId)) throw new HttpError(429, 'Too many invites; wait a moment');
    if (this.chat.blocked(other.id).has(userId)) return;
    for (const c of to) c.send({ t: 'invite', from: this.nameOf(userId), lobbyName: lobby.name, code: lobby.code });
  }

  install(app: App): void {
    app.route('GET', '/api/friends', (ctx) => this.list(requireUser(ctx).id));
    app.route('POST', '/api/friends', (ctx) => ({ state: this.ask(requireUser(ctx).id, str(ctx, 'name', { max: 40 })) }));
    app.route('POST', '/api/friends/:name/accept', (ctx) => ({ state: this.accept(requireUser(ctx).id, ctx.params.name!) }));
    app.route('POST', '/api/friends/:name/invite', (ctx) => {
      this.invite(requireUser(ctx).id, ctx.params.name!);
      return { ok: true };
    });
    app.route('DELETE', '/api/friends/:name', (ctx) => {
      this.remove(requireUser(ctx).id, ctx.params.name!);
      return { ok: true };
    });
  }
}
