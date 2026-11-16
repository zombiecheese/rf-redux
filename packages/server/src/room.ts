// One match on the server (mp-lockstep, mp-server-rooms, mp-reconnect). The server runs the sim itself and orders
// everyone's input: every tick it takes each player's latest controls (a bot's move for a bot seat), plays the tick
// and sends it to every client as a frame. Clients play the same frames, so all of them and the server stay in step;
// a client's own controls reach the game after its round trip plus a few ticks of buffering.
//
// Every HASH_EVERY ticks clients send a hash of their state. One that differs from the server's gets the server's
// snapshot to carry on from, and both sides' states at that tick are saved for a test to replay.
//
// A player whose connection drops keeps their seat for RECONNECT_MS (a friends' game pauses meanwhile); after
// that, or straight away if they quit, a bot at the match difficulty plays the seat. A player who comes back
// before the end takes it over again, with a snapshot of the match as it stands.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HASH_EVERY, TICK_MS, VEHICLE_KINDS, botThink, buildWorld, createBot, createMatch, hashMatch, snapshotMatch,
  type BotState, type BuildingDef, type Match, type RfwMap, type ShoreTable, type Snapshot,
} from '@rfw/sim';
import { type LobbyLighting, type LobbyVisuals, 
  applyFrame, commandCode, encodeFrames, humanGate, packInput,
  type Frame, type MatchResult, type MatchSeat, type MatchStart, type SeatStatus, type ServerMessage,
} from '@rfw/net';

export const RECONNECT_MS = 60_000;
/**
 * How long the match waits for every human player to load it (the map, the sprites and sounds, and in the modern
 * view the 3D world and its shaders) before it starts anyway. Bots need no loading.
 */
export const LOAD_WAIT_MS = 90_000;
/** Snapshots kept for desync reports: the last few hash checkpoints. */
const KEEP_SNAPSHOTS = 4;
/** At most this many ticks are played at once when the server falls behind; beyond that it lets time slip. */
const MAX_CATCH_UP = 8;
/** Matches end on their own after two hours. */
const MAX_TICKS = Math.round((2 * 3600 * 1000) / TICK_MS);

/** A connection as rooms see it (hub.ts). */
export interface Peer {
  id: string;
  userId: string;
  name: string;
  send(msg: ServerMessage): void;
  sendBinary(data: Uint8Array): void;
  ping?: number;
}

interface HumanSeat {
  seat: MatchSeat;
  peer: Peer | null;
  input: number;
  commands: number[];
  loaded: boolean;
  /** When the connection dropped, or 0 while connected. */
  goneAt: number;
  quit: boolean;
  bot: BotState | null;
}

export interface RoomOptions {
  id: string;
  mapId: string;
  map: RfwMap;
  defs: readonly BuildingDef[];
  shore: ShoreTable | null;
  seats: MatchSeat[];
  seed: number;
  difficulty: number;
  /** Extra vehicles for the smaller side. */
  handicap?: boolean;
  /** The host's picks of visuals and lighting for everyone. */
  visuals?: LobbyVisuals;
  lighting?: LobbyLighting;
  /** Friends' games pause while a player is reconnecting. */
  pauseOnDrop: boolean;
  /** Where desync reports are written (DATA_DIR/desyncs), or null to skip writing them. */
  desyncDir: string | null;
  onEnd(result: MatchResult): void;
  onDesync?(info: { gameId: string; tick: number; user: string }): void;
}

export class Room {
  readonly match: Match;
  readonly started = Date.now();
  private readonly humans = new Map<number, HumanSeat>();
  private readonly bots = new Map<number, BotState>();
  private readonly spectators = new Set<Peer>();
  private readonly hashes = new Map<number, number>();
  private readonly snapshots = new Map<number, Snapshot>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = 0;
  private acc = 0;
  private running = false;
  private waitingSince = Date.now();
  private adminPause = false;
  private ended = false;
  /** The tick the first human player launched a vehicle, or -1: the bots wait for every human (see createBot). */
  private firstLaunch = -1;
  /** Per seat: vehicles lost and flags captured, for the results. */
  private readonly stats: { lost: number; captures: number; launches: number[] }[];
  /** Ticks behind schedule and desyncs, for the admin dashboard. */
  lag = 0;
  desyncs = 0;

  constructor(readonly o: RoomOptions) {
    const world = buildWorld(o.map, o.defs, o.shore);
    this.match = createMatch(world, o.map, o.seats.map((s) => ({ base: s.base, team: s.team })), o.seed, {
      difficulty: o.difficulty, handicap: o.handicap === true, gate: humanGate(o.seats),
    });
    // With two or more humans the sim's start gate holds every launch until the last of them has picked a vehicle.
    // Bots wait in their bunkers until every human has launched a vehicle (or a grace time after the first did),
    // so a player still picking one on the lift screen is not overrun.
    const humans = o.seats.filter((s) => !s.bot).map((s) => s.player);
    for (const s of o.seats) {
      if (s.bot) this.bots.set(s.player, createBot(s.difficulty ?? null, humans));
      else this.humans.set(s.player, { seat: s, peer: null, input: 0, commands: [], loaded: false, goneAt: Date.now(), quit: false, bot: null });
    }
    this.stats = o.seats.map(() => ({ lost: 0, captures: 0, launches: VEHICLE_KINDS.map(() => 0) }));
  }

  get id(): string {
    return this.o.id;
  }

  get isOver(): boolean {
    return this.ended;
  }

  get paused(): boolean {
    return this.adminPause || this.waitingForReconnect() !== null;
  }

  // ---- People ----

  /** The start message for a player (or spectator, with player null) joining now. */
  private startFor(player: number | null): MatchStart {
    const o = this.o;
    return {
      gameId: o.id, mapId: o.mapId, map: o.map, seed: o.seed, difficulty: o.difficulty, handicap: o.handicap === true, visuals: o.visuals ?? 'retro', lighting: o.lighting ?? 'day', seats: o.seats, you: player,
      snapshot: this.match.tick > 0 ? snapshotMatch(this.match) : undefined,
    };
  }

  /** Seats a player's connection (first time or coming back). Returns false if they have no seat here. */
  connect(peer: Peer): boolean {
    for (const [player, h] of this.humans) {
      if (h.seat.userId !== peer.userId) continue;
      if (h.peer && h.peer !== peer) h.peer.send({ t: 'notice', text: 'You joined this game from another window' });
      h.peer = peer;
      h.goneAt = 0;
      h.quit = false;
      h.bot = null;
      h.input = 0;
      peer.send({ t: 'start', match: this.startFor(player) });
      this.sendSeats();
      return true;
    }
    return false;
  }

  spectate(peer: Peer): void {
    this.spectators.add(peer);
    peer.send({ t: 'start', match: this.startFor(null) });
  }

  /** A connection closed (quit false) or its player left the game for good (quit true). */
  disconnect(peer: Peer, quit: boolean): void {
    if (this.spectators.delete(peer)) return;
    for (const h of this.humans.values()) {
      if (h.peer !== peer) continue;
      h.peer = null;
      h.goneAt = Date.now();
      h.input = 0;
      h.commands = [];
      h.loaded = true;
      if (quit) this.takeOver(h, true);
    }
    this.sendSeats();
  }

  hasPlayer(userId: string): boolean {
    return [...this.humans.values()].some((h) => h.seat.userId === userId && !h.quit);
  }

  /** People connected: players and spectators. */
  peers(): Peer[] {
    return [...[...this.humans.values()].flatMap((h) => (h.peer ? [h.peer] : [])), ...this.spectators];
  }

  playerOf(peer: Peer): MatchSeat | null {
    for (const h of this.humans.values()) if (h.peer === peer) return h.seat;
    return null;
  }

  private takeOver(h: HumanSeat, quit: boolean): void {
    h.quit = quit;
    if (!h.bot) {
      // It waits with the other bots for the players still here who have not launched yet.
      const others = [...this.humans.values()].filter((o) => o !== h && !o.quit && !this.launched(o.seat.player)).map((o) => o.seat.player);
      h.bot = createBot(null, others, this.firstLaunch);
    }
    this.broadcast({ t: 'notice', text: `${h.seat.name} ${quit ? 'left' : 'dropped out'}; a bot plays for them` });
  }

  /** Whether a seat has launched a vehicle yet. */
  private launched(player: number): boolean {
    return this.stats[player]!.launches.some((n) => n > 0);
  }

  seatStatus(): SeatStatus[] {
    return this.o.seats.map((s) => {
      const h = this.humans.get(s.player);
      if (!h) return { player: s.player, connected: true, ...(this.running ? {} : { loaded: true }) };
      return { player: s.player, connected: !!h.peer, ping: h.peer?.ping, botTakeover: !!h.bot, ...(this.running ? {} : { loaded: h.loaded || !!h.bot }) };
    });
  }

  private sendSeats(): void {
    this.broadcast({ t: 'seats', seats: this.seatStatus() });
  }

  broadcast(msg: ServerMessage): void {
    for (const p of this.peers()) p.send(msg);
  }

  // ---- Input ----

  /** A player has loaded everything the match needs; the others hear who is still loading. */
  loaded(peer: Peer): void {
    let changed = false;
    for (const h of this.humans.values()) {
      if (h.peer !== peer || h.loaded) continue;
      h.loaded = true;
      changed = true;
    }
    if (changed && !this.running) this.sendSeats();
  }

  input(peer: Peer, packed: number): void {
    for (const h of this.humans.values()) if (h.peer === peer) h.input = packed;
  }

  command(peer: Peer, code: number): void {
    for (const h of this.humans.values()) if (h.peer === peer && h.commands.length < 8) h.commands.push(code);
  }

  hash(peer: Peer, tick: number, hash: number): void {
    const mine = this.hashes.get(tick);
    if (mine === undefined || mine === hash) return;
    this.desyncs++;
    const seat = this.playerOf(peer);
    const who = seat ? seat.name : peer.name;
    console.warn(`Desync in game ${this.id} at tick ${tick}: ${who} has ${hash.toString(16)}, server ${mine.toString(16)}`);
    this.o.onDesync?.({ gameId: this.id, tick, user: peer.userId });
    const ours = this.snapshots.get(tick);
    if (ours && this.o.desyncDir) this.saveDesync(tick, peer.userId, 'server', ours);
    // The client sends its own state at that tick (desyncReport), then carries on from ours.
    peer.send({ t: 'desync', tick });
    peer.send({ t: 'snapshot', snapshot: snapshotMatch(this.match), reason: 'desync' });
    this.hashes.delete(tick);
  }

  desyncReport(peer: Peer, tick: number, snapshot: Snapshot): void {
    if (this.o.desyncDir && this.snapshots.has(tick)) this.saveDesync(tick, peer.userId, 'client', snapshot);
  }

  private saveDesync(tick: number, user: string, side: string, snap: Snapshot): void {
    try {
      const dir = join(this.o.desyncDir!, `${this.id}-${tick}`);
      mkdirSync(dir, { recursive: true });
      const safe = user.replace(/[^A-Za-z0-9_-]/g, '_');
      const setup = { mapId: this.o.mapId, seed: this.o.seed, difficulty: this.o.difficulty, handicap: this.o.handicap === true, seats: this.o.seats };
      writeFileSync(join(dir, side === 'server' ? 'server.json' : `client-${safe}.json`), JSON.stringify({ setup, snapshot: snap }));
    } catch (err) {
      console.error('Could not save desync report', err);
    }
  }

  // ---- Clock ----

  start(): void {
    if (this.timer || this.ended) return;
    this.last = performance.now();
    this.loop();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setAdminPause(on: boolean, reason = 'Paused by an admin'): void {
    this.adminPause = on;
    this.broadcast({ t: 'paused', paused: this.paused, reason: on ? reason : undefined });
  }

  /** The seat a friends' game is waiting on, if any. */
  private waitingForReconnect(): HumanSeat | null {
    if (!this.o.pauseOnDrop) return null;
    for (const h of this.humans.values()) if (!h.peer && !h.bot && !h.quit) return h;
    return null;
  }

  private loop = () => {
    const now = performance.now();
    this.acc += now - this.last;
    this.last = now;
    this.checkSeats();
    if (!this.running) {
      const all = [...this.humans.values()].every((h) => h.loaded || h.bot);
      if (all || Date.now() - this.waitingSince > LOAD_WAIT_MS) {
        this.running = true;
        this.acc = 0;
        // Everyone's loading screens move on from waiting for the others.
        this.sendSeats();
      }
    }
    const wasPaused = this.paused;
    if (this.running && !this.paused) {
      let n = 0;
      while (this.acc >= TICK_MS && n < MAX_CATCH_UP && !this.ended) {
        this.tick();
        this.acc -= TICK_MS;
        n++;
      }
      this.lag = Math.floor(this.acc / TICK_MS);
      if (this.acc > TICK_MS * MAX_CATCH_UP) this.acc = TICK_MS;
    } else this.acc = 0;
    if (this.paused !== wasPaused) this.broadcast({ t: 'paused', paused: this.paused });
    if (!this.ended) this.timer = setTimeout(this.loop, Math.max(1, TICK_MS - this.acc));
  };

  private checkSeats(): void {
    const now = Date.now();
    let changed = false;
    for (const h of this.humans.values()) {
      if (!h.peer && !h.bot && h.goneAt && now - h.goneAt > RECONNECT_MS) {
        this.takeOver(h, false);
        changed = true;
      }
    }
    const waiting = this.waitingForReconnect();
    if (waiting && this.running && now % 5000 < TICK_MS * 2) {
      const left = Math.ceil((RECONNECT_MS - (now - waiting.goneAt)) / 1000);
      this.broadcast({ t: 'paused', paused: true, reason: `Waiting ${left}s for ${waiting.seat.name} to reconnect` });
    }
    if (changed) this.sendSeats();
    // Everyone gone for good: no point playing on.
    if (this.running && [...this.humans.values()].every((h) => h.quit) && this.humans.size > 0) this.end('Every player left');
  }

  /** Plays one tick and sends it out. */
  tick(): void {
    const m = this.match;
    const frame: Frame = { tick: m.tick + 1, inputs: [], commands: [] };
    for (const s of this.o.seats) {
      const h = this.humans.get(s.player);
      const bot = h ? h.bot : this.bots.get(s.player);
      if (bot) {
        const move = botThink(m, s.player, bot);
        if (move.launch) frame.commands.push([s.player, commandCode({ launch: move.launch })]);
        if (move.dock) frame.commands.push([s.player, commandCode({ dock: true })]);
        frame.inputs[s.player] = packInput(move.input);
      } else if (h) {
        frame.inputs[s.player] = h.input;
        for (const c of h.commands.splice(0)) frame.commands.push([s.player, c]);
      }
    }
    for (let p = 0; p < m.players.length; p++) frame.inputs[p] ??= 0;
    const before = m.players.map((p) => p.state);
    applyFrame(m, frame);
    // A launch is counted as its vehicle goes up: at once, or behind the start gate when it opens.
    for (const p of m.players) {
      const kind = p.elevator?.kind;
      if (kind && before[p.id] === 'bunker' && p.state === 'launching') this.stats[p.id]!.launches[VEHICLE_KINDS.indexOf(kind)]!++;
    }
    if (this.firstLaunch < 0 && [...this.humans.keys()].some((p) => this.launched(p))) this.firstLaunch = m.tick;
    for (const e of m.events) {
      if (e.type === 'destroyed') this.stats[e.player]!.lost++;
      if (e.type === 'captured') this.stats[e.player]!.captures++;
    }
    const data = encodeFrames([frame]);
    for (const p of this.peers()) p.sendBinary(data);
    if (m.tick % HASH_EVERY === 0) {
      this.hashes.set(m.tick, hashMatch(m));
      this.hashes.delete(m.tick - HASH_EVERY * 40);
      if (this.o.desyncDir) {
        this.snapshots.set(m.tick, snapshotMatch(m));
        this.snapshots.delete(m.tick - HASH_EVERY * KEEP_SNAPSHOTS);
      }
    }
    if (m.winner !== null || m.draw) this.end();
    else if (m.tick >= MAX_TICKS) this.end(undefined, true);
  }

  /** Ends the match: a result, or aborted with a reason. */
  end(aborted?: string, timeLimit = false): void {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    const m = this.match;
    const result: MatchResult = {
      gameId: this.id, winner: aborted ? null : timeLimit ? timeLimitWinner(m) : m.winner, ticks: m.tick, aborted,
      ...(timeLimit ? { timeLimit: true as const } : {}),
      seats: this.o.seats.map((s, i) => ({
        ...s,
        lost: this.stats[i]!.lost,
        captures: this.stats[i]!.captures,
        launches: this.stats[i]!.launches,
        left: VEHICLE_KINDS.reduce((n, k) => n + Math.min(99, m.players[s.player]!.lives[k]), 0),
        quit: this.humans.get(s.player)?.quit ?? false,
      })),
    };
    this.broadcast({ t: 'end', result });
    this.o.onEnd(result);
  }
}

/**
 * Who wins a match that ran to the time limit: the team with the most jeeps left (waiting in its bunkers or out on
 * the map), since a base with none is out. Level counts make it a draw (null).
 */
export function timeLimitWinner(m: Match): number | null {
  const jeeps = new Map<number, number>();
  for (const p of m.players) {
    if (m.eliminated[p.base]) continue;
    const out = p.vehicle?.kind === 'jeep' ? 1 : 0;
    jeeps.set(p.team, (jeeps.get(p.team) ?? 0) + p.lives.jeep + out);
  }
  const best = Math.max(...jeeps.values());
  const leaders = [...jeeps].filter(([, n]) => n === best);
  return leaders.length === 1 ? leaders[0]![0] : null;
}
