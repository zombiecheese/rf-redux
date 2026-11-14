// The connection to the game server's WebSocket: sign-in state, lobbies, chat and the frames of a running match.
// It reconnects by itself (a dropped connection keeps the seat in a match for a minute). Online play needs an
// account: until the player signs in, the server only shows the lobby list.

import {
  PROTOCOL_VERSION, decodeFrames, encodeCommand, encodeHash, encodeInput,
  type ChatMessage, type ClientMessage, type Command, type Frame, type Identity, type LobbyInfo, type LobbySummary, type MatchResult,
  type MatchStart, type SeatStatus, type ServerMessage,
} from '@rfw/net';
import type { Snapshot, VehicleInput } from '@rfw/sim';

export interface NetEvents {
  welcome: Identity;
  status: 'connecting' | 'online' | 'offline';
  lobby: LobbyInfo | null;
  lobbies: LobbySummary[];
  chat: ChatMessage;
  start: MatchStart;
  snapshot: Snapshot;
  seats: SeatStatus[];
  paused: { paused: boolean; reason?: string };
  end: MatchResult;
  notice: string;
  error: string;
  desync: number;
  kicked: void;
  /** The friends list changed; with a notice to show. */
  friends: string | undefined;
  invite: { from: string; lobbyName: string; code: string };
}

type Listener<K extends keyof NetEvents> = (v: NetEvents[K]) => void;

export class Net {
  you: Identity | null = null;
  status: NetEvents['status'] = 'offline';
  lobby: LobbyInfo | null = null;
  lobbies: LobbySummary[] = [];
  chat: ChatMessage[] = [];
  /** Frames received for the running match and not yet played. */
  readonly frames: Frame[] = [];
  seats: SeatStatus[] = [];
  motd = '';
  private ws: WebSocket | null = null;
  private readonly listeners = new Map<keyof NetEvents, Set<Listener<never>>>();
  private retry = 0;
  private stopped = false;
  private lastInput = -1;
  private watchingList = false;

  on<K extends keyof NetEvents>(k: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(k);
    if (!set) this.listeners.set(k, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  private emit<K extends keyof NetEvents>(k: K, v: NetEvents[K]): void {
    for (const fn of this.listeners.get(k) ?? []) (fn as Listener<K>)(v);
  }

  get connected(): boolean {
    return this.status === 'online';
  }

  /** Connects (or reconnects after signing in or out, which changes who we are). */
  connect(): void {
    this.stopped = false;
    this.ws?.close();
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.send({ t: 'hello', version: PROTOCOL_VERSION });
    };
    ws.onmessage = (e) => {
      if (ws !== this.ws) return;
      if (typeof e.data === 'string') this.message(JSON.parse(e.data) as ServerMessage);
      else this.frames.push(...decodeFrames(new Uint8Array(e.data as ArrayBuffer)));
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.setStatus('offline');
      if (this.stopped) return;
      const wait = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => {
        if (!this.stopped && this.ws === ws) this.connect();
      }, wait);
    };
  }

  disconnect(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
    this.setStatus('offline');
  }

  private setStatus(s: NetEvents['status']): void {
    this.status = s;
    this.emit('status', s);
  }

  private message(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.retry = 0;
        this.you = m.you;
        this.motd = m.motd ?? '';
        this.setStatus('online');
        if (this.watchingList) this.send({ t: 'lobbies', watch: true });
        this.emit('welcome', m.you);
        if (m.maintenance) this.emit('notice', `Maintenance at ${new Date(m.maintenance.at).toLocaleString()}: ${m.maintenance.message}`);
        return;
      case 'reload':
        this.stopped = true;
        this.emit('error', m.reason);
        return;
      case 'ping':
        this.send({ t: 'pong', at: m.at });
        return;
      case 'lobbies':
        this.lobbies = m.list;
        return this.emit('lobbies', m.list);
      case 'lobby':
        if (!m.lobby || m.lobby.id !== this.lobby?.id) this.chat = [];
        this.lobby = m.lobby;
        if (m.kicked) this.emit('kicked', undefined);
        return this.emit('lobby', m.lobby);
      case 'chatHistory':
        this.chat = m.messages;
        for (const c of m.messages) this.emit('chat', c);
        return;
      case 'chat':
        this.chat.push(m.message);
        if (this.chat.length > 200) this.chat.splice(0, this.chat.length - 200);
        return this.emit('chat', m.message);
      case 'start':
        this.frames.length = 0;
        this.lastInput = -1;
        return this.emit('start', m.match);
      case 'snapshot':
        // Frames already queued are older than the snapshot or carry on from it; the game drops the old ones.
        return this.emit('snapshot', m.snapshot);
      case 'seats':
        this.seats = m.seats;
        return this.emit('seats', m.seats);
      case 'paused':
        return this.emit('paused', { paused: m.paused, reason: m.reason });
      case 'end':
        return this.emit('end', m.result);
      case 'notice':
        return this.emit('notice', m.text);
      case 'error':
        return this.emit('error', m.message);
      case 'desync':
        return this.emit('desync', m.tick);
      case 'friends':
        return this.emit('friends', m.notice);
      case 'invite':
        return this.emit('invite', { from: m.from, lobbyName: m.lobbyName, code: m.code });
    }
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  watchLobbies(on: boolean): void {
    this.watchingList = on;
    this.send({ t: 'lobbies', watch: on });
  }

  /** Sends the controls when they change (the server keeps the last ones). */
  input(i: VehicleInput | undefined, packed: number): void {
    if (packed === this.lastInput || this.ws?.readyState !== WebSocket.OPEN) return;
    this.lastInput = packed;
    this.ws.send(encodeInput(i));
  }

  command(c: Command): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeCommand(c));
  }

  hash(tick: number, hash: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeHash(tick, hash));
  }
}

/** One connection for the whole page. */
export const net = new Net();
