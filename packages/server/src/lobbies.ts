// Lobbies (lobbies, quick-match, chat): a lobby holds up to four seats, one per base of its map, each open, closed,
// a player or a bot with a difficulty. The owner picks the map, the team of each seat (presets from layoutsFor:
// free for all, 2v2, 2v1...), the difficulty and whether the lobby is open to anyone or private (joined with its
// code). When every player is ready the owner starts the match, which runs in a Room; when it ends the lobby is
// back to waiting, ready for a rematch. Chat goes to everyone in the lobby and its game, to a team, or to one player.

import { randomBytes } from 'node:crypto';
import { lobbyLighting, lobbyVisuals, type LobbyLighting, type LobbyVisuals, 
  layoutsFor, teamsForLayout,
  type ChatChannel, type ChatMessage, type Identity, type LobbyInfo, type LobbySlot, type LobbySummary, type MatchResult, type MatchSeat,
  type ServerMessage, type Visibility,
} from '@rfw/net';
import { MAX_BASES, clampDifficulty, type RfwMap } from '@rfw/sim';
import { hasRole } from './http.js';
import { ChatError, type Chat } from './chat.js';
import type { Maps } from './maps.js';
import { Room, type Peer } from './room.js';
import type { Settings } from './settings.js';

/** A WebSocket connection (hub.ts). */
export interface Conn extends Peer {
  identity: Identity;
  ip: string;
  lobby: Lobby | null;
  room: Room | null;
  watching: boolean;
}

export class LobbyError extends Error {}

export interface Lobby {
  id: string;
  code: string;
  name: string;
  owner: string;
  mapId: string;
  map: RfwMap;
  visibility: Visibility;
  difficulty: number;
  handicap: boolean;
  visuals: LobbyVisuals;
  lighting: LobbyLighting;
  slots: LobbySlot[];
  /** Connections of the people in the lobby's seats. */
  members: Map<string, Conn>;
  state: 'waiting' | 'playing';
  room: Room | null;
  /** Made by quick match: anyone joining takes a bot's seat. */
  quick: boolean;
  /** An admin muted its chat: only staff can talk. */
  chatMuted: boolean;
  created: number;
}

export interface LobbyHooks {
  onGameEnd(lobby: Lobby, result: MatchResult, room: Room): void;
  desyncDir: string | null;
  onDesync?(info: { gameId: string; tick: number; user: string }): void;
  /** Whether someone may watch a private lobby's game (a friend of a player in it). */
  mayWatch?(userId: string, l: Lobby): boolean;
}

const id = (n = 6) => randomBytes(n).toString('base64url');
/** Lobby codes avoid letters that look alike. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from(randomBytes(5), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

export class Lobbies {
  readonly lobbies = new Map<string, Lobby>();
  private readonly watchers = new Set<Conn>();
  private listDirty = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly maps: Maps, private readonly chat: Chat, private readonly settings: Settings, private readonly hooks: LobbyHooks) {
    // The public list goes out at most twice a second.
    this.timer = setInterval(() => this.flushList(), 500);
    this.timer.unref?.();
  }

  close(): void {
    clearInterval(this.timer);
    for (const l of this.lobbies.values()) l.room?.stop();
  }

  // ---- Views ----

  info(l: Lobby): LobbyInfo {
    return {
      id: l.id, code: l.code, name: l.name, owner: l.owner, mapId: l.mapId, mapName: l.map.name, visibility: l.visibility,
      slots: l.slots, difficulty: l.difficulty, handicap: l.handicap, visuals: l.visuals, lighting: l.lighting, state: l.state, gameId: l.room?.id,
    };
  }

  summary(l: Lobby): LobbySummary {
    const humans = l.slots.filter((s) => s.kind === 'human').length;
    return {
      id: l.id, name: l.name, ownerName: l.slots.find((s) => s.user?.id === l.owner)?.user?.name ?? '', mapName: l.map.name,
      players: humans, free: l.slots.filter((s) => s.kind === 'open' || (l.quick && s.kind === 'bot')).length,
      bots: l.slots.filter((s) => s.kind === 'bot').length, state: l.state, visibility: l.visibility,
    };
  }

  /** Open lobbies, waiting ones with room first. */
  publicList(): LobbySummary[] {
    return [...this.lobbies.values()]
      .filter((l) => l.visibility === 'open')
      .map((l) => this.summary(l))
      .sort((a, b) => Number(a.state === 'playing') - Number(b.state === 'playing') || Number(b.free > 0) - Number(a.free > 0) || b.players - a.players);
  }

  watch(c: Conn, on: boolean): void {
    c.watching = on;
    if (on) {
      this.watchers.add(c);
      c.send({ t: 'lobbies', list: this.publicList() });
    } else this.watchers.delete(c);
  }

  private flushList(): void {
    if (!this.listDirty) return;
    this.listDirty = false;
    const msg: ServerMessage = { t: 'lobbies', list: this.publicList() };
    for (const c of this.watchers) c.send(msg);
  }

  private changed(l: Lobby): void {
    const msg: ServerMessage = { t: 'lobby', lobby: this.info(l) };
    for (const c of l.members.values()) c.send(msg);
    this.listDirty = true;
  }

  // ---- Joining and leaving ----

  private canPlay(c: Conn): void {
    if (c.identity.guest) throw new LobbyError('Sign in to play online');
  }

  create(c: Conn, opts: { name?: string; mapId: string; visibility: Visibility; slots?: number; teams?: number[] }): Lobby {
    this.canPlay(c);
    this.leave(c);
    const map = this.maps.get(opts.mapId, c.identity.guest ? null : c.identity.id);
    if (!map) throw new LobbyError('Unknown map');
    const bases = Math.min(MAX_BASES, map.bases.length);
    const l: Lobby = {
      id: id(), code: code(), name: (opts.name?.trim() || `${c.identity.name}'s game`).slice(0, 40), owner: c.identity.id, mapId: opts.mapId, map,
      visibility: opts.visibility === 'private' ? 'private' : 'open', difficulty: this.settings.get().defaultDifficulty, handicap: false, visuals: 'modern', lighting: 'day',
      slots: [], members: new Map(), state: 'waiting', room: null, quick: false, chatMuted: false, created: Date.now(),
    };
    l.slots = this.defaultSlots(l, bases);
    this.lobbies.set(l.id, l);
    this.seat(c, l, 0);
    if (opts.teams) this.applyLayout(l, opts.teams);
    this.changed(l);
    this.system(l, `${c.identity.name} made the lobby`);
    return l;
  }

  /** One seat per base: the first for the owner, the second a bot, the rest open. */
  private defaultSlots(l: Lobby, bases: number): LobbySlot[] {
    const teams = teamsForLayout(Array.from({ length: bases }, () => 1));
    return Array.from({ length: bases }, (_, i) => ({
      base: l.map.bases[i]!.id, team: teams[i]!, kind: i === 1 ? 'bot' : 'open', difficulty: i === 1 ? l.difficulty : undefined,
    }));
  }

  private applyLayout(l: Lobby, teams: number[]): void {
    const total = teams.reduce((a, b) => a + b, 0);
    if (!layoutsFor(l.slots.length).some((x) => x.teams.join() === teams.join())) throw new LobbyError('That team layout does not fit this map');
    const assigned = teamsForLayout(teams);
    l.slots.forEach((s, i) => {
      if (i < total) {
        s.team = assigned[i]!;
        if (s.kind === 'closed') s.kind = 'open';
      } else if (s.kind === 'human') {
        // A player in a seat the layout drops moves to an open one if there is one, else the seat stays.
        s.team = assigned[i % assigned.length]!;
      } else {
        s.kind = 'closed';
        delete s.difficulty;
      }
    });
  }

  join(c: Conn, by: { id?: string; code?: string }): Lobby {
    this.canPlay(c);
    const l = by.id ? this.lobbies.get(by.id) : [...this.lobbies.values()].find((x) => x.code === by.code?.trim().toUpperCase());
    if (!l || (by.id && l.visibility === 'private' && !hasRole(c.identity, 'moderator'))) throw new LobbyError('No such lobby; check the code');
    if (l.members.has(c.identity.id)) {
      this.attach(c, l);
      return l;
    }
    if (l.state === 'playing') {
      if (l.room?.hasPlayer(c.identity.id)) {
        this.attach(c, l);
        return l;
      }
      throw new LobbyError('That game has started; you can watch it from the lobby list');
    }
    const free = l.slots.findIndex((s) => s.kind === 'open');
    const bot = l.quick ? l.slots.findIndex((s) => s.kind === 'bot') : -1;
    const slot = free >= 0 ? free : bot;
    if (slot < 0) throw new LobbyError('That lobby is full');
    this.leave(c);
    this.seat(c, l, slot);
    this.changed(l);
    this.system(l, `${c.identity.name} joined`);
    return l;
  }

  /** Quick match: the fullest open lobby with room, else a new one against a bot. */
  quick(c: Conn): Lobby {
    this.canPlay(c);
    const candidates = [...this.lobbies.values()]
      .filter((l) => l.visibility === 'open' && l.state === 'waiting' && !l.members.has(c.identity.id))
      .filter((l) => l.slots.some((s) => s.kind === 'open' || (l.quick && s.kind === 'bot')))
      .sort((a, b) => this.summary(b).players - this.summary(a).players);
    if (candidates[0]) return this.join(c, { id: candidates[0].id });
    const featured = this.settings.get().featuredMaps.filter((m) => this.maps.get(m));
    const pool = featured.length ? featured : this.maps.list().map((m) => m.id);
    if (!pool.length) throw new LobbyError('No maps are installed');
    const mapId = pool[Math.floor(Math.random() * pool.length)]!;
    const l = this.create(c, { mapId, visibility: 'open', name: 'Quick match' });
    l.quick = true;
    for (const s of l.slots) if (s.kind === 'open') (s.kind = 'bot'), (s.difficulty = l.difficulty);
    this.changed(l);
    return l;
  }

  private seat(c: Conn, l: Lobby, slot: number): void {
    const s = l.slots[slot]!;
    s.kind = 'human';
    s.user = { id: c.identity.id, name: c.identity.name, guest: c.identity.guest };
    s.ready = false;
    delete s.difficulty;
    l.members.set(c.identity.id, c);
    this.attach(c, l);
  }

  /** Points a connection at its lobby and sends it the lobby, its chat and (mid-game) the match. */
  attach(c: Conn, l: Lobby): void {
    c.lobby = l;
    l.members.set(c.identity.id, c);
    c.send({ t: 'lobby', lobby: this.info(l) });
    c.send({ t: 'chatHistory', messages: this.chat.history(l.id, c.identity.id, (u) => this.teamOf(l, u)) });
    if (l.room && !l.room.isOver && l.room.connect(c)) c.room = l.room;
  }

  /** Leaves the lobby (and, mid-game, quits the match: a bot takes the seat). */
  leave(c: Conn): void {
    const l = c.lobby;
    if (c.room) {
      c.room.disconnect(c, true);
      c.room = null;
    }
    if (!l) return;
    c.lobby = null;
    if (l.members.get(c.identity.id) === c) l.members.delete(c.identity.id);
    const s = l.slots.find((x) => x.user?.id === c.identity.id);
    if (s && l.state === 'waiting') {
      s.kind = l.quick ? 'bot' : 'open';
      if (l.quick) s.difficulty = l.difficulty;
      delete s.user;
      delete s.ready;
    }
    c.send({ t: 'lobby', lobby: null });
    this.system(l, `${c.identity.name} left`);
    this.afterLeave(l);
  }

  /** A connection closed: mid-game the seat waits for a reconnect; in a waiting lobby the seat is freed. */
  dropped(c: Conn): void {
    this.watchers.delete(c);
    if (c.room) {
      c.room.disconnect(c, false);
      c.room = null;
    }
    const l = c.lobby;
    if (!l || l.members.get(c.identity.id) !== c) return;
    if (l.state === 'playing') {
      l.members.delete(c.identity.id);
      return;
    }
    this.leave(c);
  }

  private afterLeave(l: Lobby): void {
    const humans = l.slots.filter((s) => s.kind === 'human');
    if (l.state === 'waiting' && humans.length === 0) {
      this.lobbies.delete(l.id);
      this.listDirty = true;
      return;
    }
    if (!humans.some((s) => s.user?.id === l.owner) && humans[0]?.user && l.state === 'waiting') {
      l.owner = humans[0].user.id;
      this.system(l, `${humans[0].user.name} now runs the lobby`);
    }
    this.changed(l);
  }

  // ---- Owner controls ----

  private owned(c: Conn): Lobby {
    const l = c.lobby;
    if (!l) throw new LobbyError('You are not in a lobby');
    if (l.owner !== c.identity.id) throw new LobbyError('Only the lobby owner can do that');
    if (l.state !== 'waiting') throw new LobbyError('The game is running');
    return l;
  }

  settingsFor(c: Conn, s: { name?: string; mapId?: string; visibility?: Visibility; difficulty?: number; handicap?: boolean; visuals?: LobbyVisuals; lighting?: LobbyLighting }): void {
    const l = this.owned(c);
    if (s.handicap !== undefined) l.handicap = s.handicap === true;
    if (s.visuals !== undefined) l.visuals = lobbyVisuals(s.visuals);
    if (s.lighting !== undefined) l.lighting = lobbyLighting(s.lighting);
    if (s.name !== undefined) l.name = String(s.name).trim().slice(0, 40) || l.name;
    if (s.visibility) l.visibility = s.visibility === 'private' ? 'private' : 'open';
    if (s.difficulty !== undefined) {
      // The match difficulty (drones, random mines), and the starting skill of every bot seat.
      l.difficulty = clampDifficulty(Number(s.difficulty));
      for (const slot of l.slots) if (slot.kind === 'bot') slot.difficulty = l.difficulty;
    }
    if (s.mapId && s.mapId !== l.mapId) {
      const map = this.maps.get(s.mapId, c.identity.guest ? null : c.identity.id);
      if (!map) throw new LobbyError('Unknown map');
      const people = l.slots.filter((x) => x.kind === 'human');
      const bases = Math.min(MAX_BASES, map.bases.length);
      if (people.length > bases) throw new LobbyError(`That map has ${bases} bases and there are ${people.length} players here`);
      l.map = map;
      l.mapId = s.mapId;
      const slots = this.defaultSlots(l, bases);
      people.forEach((p, i) => (slots[i] = { ...slots[i]!, kind: 'human', user: p.user, ready: false, difficulty: undefined }));
      if (people.length > 1 && slots[1]?.kind !== 'human') slots[1]!.kind = 'open';
      l.slots = slots;
    }
    for (const slot of l.slots) if (slot.kind === 'human') slot.ready = false;
    this.changed(l);
  }

  layout(c: Conn, teams: number[]): void {
    const l = this.owned(c);
    this.applyLayout(l, teams);
    this.changed(l);
  }

  slot(c: Conn, i: number, change: { kind?: 'open' | 'closed' | 'bot'; team?: number; difficulty?: number }): void {
    const l = this.owned(c);
    const s = l.slots[i];
    if (!s) throw new LobbyError('No such seat');
    if (change.team !== undefined) {
      if (!Number.isInteger(change.team) || change.team < 0 || change.team >= MAX_BASES) throw new LobbyError('Teams are A to D');
      s.team = change.team;
    }
    if (change.kind && change.kind !== s.kind) {
      if (s.kind === 'human') throw new LobbyError('Kick the player first');
      s.kind = change.kind;
      if (change.kind === 'bot') s.difficulty = l.difficulty;
      else delete s.difficulty;
    }
    if (change.difficulty !== undefined && s.kind === 'bot') s.difficulty = clampDifficulty(Number(change.difficulty));
    this.changed(l);
  }

  /** Moves a player to another open seat (another base or team). */
  move(c: Conn, i: number): void {
    const l = c.lobby;
    if (!l || l.state !== 'waiting') throw new LobbyError('You are not in a waiting lobby');
    const to = l.slots[i];
    const from = l.slots.find((s) => s.user?.id === c.identity.id);
    if (!to || !from || to.kind !== 'open') throw new LobbyError('That seat is taken');
    to.kind = 'human';
    to.user = from.user;
    to.ready = false;
    from.kind = 'open';
    delete from.user;
    delete from.ready;
    this.changed(l);
  }

  ready(c: Conn, ready: boolean): void {
    const l = c.lobby;
    const s = l?.slots.find((x) => x.user?.id === c.identity.id);
    if (!l || !s || l.state !== 'waiting') return;
    s.ready = ready;
    this.changed(l);
  }

  kick(c: Conn, userId: string, by?: string): void {
    const l = by ? c.lobby : this.owned(c);
    if (!l) return;
    if (userId === c.identity.id && !by) throw new LobbyError('You cannot kick yourself');
    const target = l.members.get(userId);
    const s = l.slots.find((x) => x.user?.id === userId);
    if (target) {
      this.leave(target);
      target.send({ t: 'lobby', lobby: null, kicked: true });
    } else if (s && l.state === 'waiting') {
      s.kind = 'open';
      delete s.user;
      this.changed(l);
    }
    if (l.room && !l.room.isOver) {
      const peer = l.room.peers().find((p) => p.userId === userId);
      if (peer) l.room.disconnect(peer, true);
    }
  }

  // ---- Starting and ending ----

  start(c: Conn): Room {
    const l = this.owned(c);
    const s = this.settings.get();
    if (s.maintenance && s.maintenance.at <= Date.now() + 60_000) throw new LobbyError('The server is going down for maintenance');
    const running = [...this.lobbies.values()].filter((x) => x.state === 'playing').length;
    if (running >= s.maxGames) throw new LobbyError('The server is full; try again in a few minutes');
    const active = l.slots.filter((x) => x.kind === 'human' || x.kind === 'bot');
    if (active.length < 2) throw new LobbyError('A match needs at least two seats filled');
    if (new Set(active.map((x) => x.team)).size < 2) throw new LobbyError('Put the seats on at least two teams');
    const notReady = active.filter((x) => x.kind === 'human' && x.user?.id !== l.owner && !x.ready);
    if (notReady.length) throw new LobbyError(`Waiting for ${notReady.map((x) => x.user?.name).join(', ')} to be ready`);
    if (!this.maps.ready) throw new LobbyError('The server has no game data: its art pack is missing');
    const seats: MatchSeat[] = active.map((x, player) => ({
      player, base: x.base, team: x.team, name: x.kind === 'bot' ? `Bot ${player + 1} (${x.difficulty ?? l.difficulty})` : x.user!.name,
      userId: x.kind === 'human' ? x.user!.id : null, bot: x.kind === 'bot', difficulty: x.kind === 'bot' ? x.difficulty ?? l.difficulty : undefined,
    }));
    const room = new Room({
      id: id(), mapId: l.mapId, map: l.map, defs: this.maps.defs, shore: this.maps.shore, seats, seed: randomBytes(4).readInt32LE(0) || 1,
      difficulty: l.difficulty, handicap: l.handicap, visuals: l.visuals, lighting: l.lighting, pauseOnDrop: l.visibility === 'private', desyncDir: this.hooks.desyncDir,
      onEnd: (result) => this.ended(l, room, result), onDesync: this.hooks.onDesync,
    });
    l.room = room;
    l.state = 'playing';
    for (const m of l.members.values()) if (room.connect(m)) m.room = room;
    room.start();
    this.changed(l);
    this.system(l, 'The match has started');
    return room;
  }

  private ended(l: Lobby, room: Room, result: MatchResult): void {
    this.hooks.onGameEnd(l, result, room);
    for (const p of room.peers()) {
      const c = p as Conn;
      if (c.room === room) c.room = null;
    }
    l.room = null;
    l.state = 'waiting';
    // Players who quit or never came back lose their seat; the rest stay for a rematch.
    for (const s of l.slots) {
      if (s.kind !== 'human') continue;
      s.ready = false;
      if (!l.members.has(s.user!.id)) {
        s.kind = l.quick ? 'bot' : 'open';
        if (l.quick) s.difficulty = l.difficulty;
        delete s.user;
      }
    }
    if (!l.members.size) {
      this.lobbies.delete(l.id);
      this.listDirty = true;
      return;
    }
    this.afterLeave(l);
  }

  spectate(c: Conn, gameId: string): void {
    const l = [...this.lobbies.values()].find((x) => x.room?.id === gameId);
    if (!l?.room) throw new LobbyError('That game has ended');
    if (l.visibility === 'private' && !hasRole(c.identity, 'moderator') && !this.hooks.mayWatch?.(c.identity.id, l)) throw new LobbyError('That game is private');
    if (c.room) c.room.disconnect(c, false);
    c.room = l.room;
    l.room.spectate(c);
  }

  stopWatching(c: Conn): void {
    if (c.room && !c.lobby?.members.has(c.identity.id)) {
      c.room.disconnect(c, false);
      c.room = null;
    }
  }

  // ---- Chat ----

  teamOf(l: Lobby, userId: string): number | null {
    return l.slots.find((s) => s.user?.id === userId)?.team ?? null;
  }

  /** Everyone who reads a lobby's chat: its members and its game's spectators. */
  private readers(l: Lobby): Conn[] {
    const out = new Map<string, Conn>();
    for (const c of l.members.values()) out.set(c.id, c);
    for (const p of l.room?.peers() ?? []) out.set(p.id, p as Conn);
    return [...out.values()];
  }

  say(c: Conn, channel: ChatChannel, text: string, to?: string): void {
    const l = c.lobby ?? [...this.lobbies.values()].find((x) => x.room && x.room === c.room);
    if (!l) throw new ChatError('Join a lobby to chat');
    if (l.chatMuted && !hasRole(c.identity, 'moderator')) throw new ChatError('Chat is muted in this lobby');
    const clean = this.chat.check(c.identity, text);
    const readers = this.readers(l);
    let recipients: Conn[];
    let target: { id: string; name: string } | undefined;
    if (channel === 'whisper') {
      const r = readers.find((x) => x.identity.id === to);
      if (!r) throw new ChatError('That player is not here');
      target = { id: r.identity.id, name: r.identity.name };
      recipients = [c, r];
    } else if (channel === 'team') {
      const team = this.teamOf(l, c.identity.id);
      recipients = readers.filter((x) => this.teamOf(l, x.identity.id) === team);
    } else {
      channel = 'all';
      recipients = readers;
    }
    const msg = this.chat.log(l.id, l.room?.id ?? null, { channel, from: { id: c.identity.id, name: c.identity.name }, to: target, text: clean, at: Date.now() });
    this.deliver(recipients, msg, c.identity.id);
  }

  private deliver(recipients: Conn[], msg: ChatMessage, from: string | null): void {
    const sent = new Set<string>();
    for (const r of recipients) {
      if (sent.has(r.id)) continue;
      sent.add(r.id);
      if (from && from !== r.identity.id && this.chat.blocked(r.identity.id).has(from)) continue;
      r.send({ t: 'chat', message: msg });
    }
  }

  /** A notice from the server (or an admin broadcast) into one lobby's chat. */
  system(l: Lobby, text: string): void {
    const msg = this.chat.log(l.id, l.room?.id ?? null, { channel: 'all', from: null, text, at: Date.now(), system: true });
    this.deliver(this.readers(l), msg, null);
  }
}
