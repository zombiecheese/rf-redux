// JSON messages over the game WebSocket (/ws): sign-in state, lobbies, chat, match start and snapshots. The hot
// lockstep path is binary (frames.ts).

import type { RfwMap, Snapshot } from '@rfw/sim';

/**
 * Bump whenever a message, the frame format or the sim changes in a way an older client would get wrong. The
 * server tells a client with another version to reload the page.
 */
export const PROTOCOL_VERSION = 6;

export type Role = 'player' | 'moderator' | 'admin' | 'owner';

export interface Identity {
  id: string;
  name: string;
  /** True for a connection that is not signed in: it can only see the lobby list. */
  guest: boolean;
  role: Role;
}

// ---- Lobbies ----------------------------------------------------------------------------------------------------

export type SlotKind = 'open' | 'closed' | 'human' | 'bot';

/** One seat in a lobby: a base on the map, its team, and who plays it. */
export interface LobbySlot {
  base: number;
  /** 0-3, shown as A-D. Slots on one team win together. */
  team: number;
  kind: SlotKind;
  /** For a human seat. */
  user?: { id: string; name: string; guest: boolean };
  ready?: boolean;
  /** For a bot seat: 1-9. */
  difficulty?: number;
}

export type Visibility = 'open' | 'private';

export interface LobbyInfo {
  id: string;
  /** Short code friends type in, or put in an invite link (/?join=CODE). */
  code: string;
  name: string;
  owner: string;
  mapId: string;
  mapName: string;
  visibility: Visibility;
  slots: LobbySlot[];
  /** Difficulty of the match: the bots' skill, drones and random mines (1-9). */
  difficulty: number;
  /** Extra vehicles for the smaller side in an uneven match (sim startingLives). */
  handicap: boolean;
  state: 'waiting' | 'playing';
  /** Set while a match is running. */
  gameId?: string;
}

/** A lobby as the public browser lists it. */
export interface LobbySummary {
  id: string;
  code?: string;
  name: string;
  ownerName: string;
  mapName: string;
  players: number;
  free: number;
  bots: number;
  state: 'waiting' | 'playing';
  visibility: Visibility;
}

/** Team layouts the owner can pick for a map with this many bases: team sizes, largest first. */
export function layoutsFor(bases: number): { name: string; teams: number[] }[] {
  const all: number[][] = [];
  const grow = (left: number, max: number, acc: number[]) => {
    if (acc.length >= 2) all.push(acc);
    for (let n = Math.min(left, max); n >= 1; n--) grow(left - n, n, [...acc, n]);
  };
  grow(bases, bases, []);
  return all
    .filter((t) => t.length >= 2 && t.reduce((a, b) => a + b, 0) <= bases)
    .sort((a, b) => b.reduce((x, y) => x + y, 0) - a.reduce((x, y) => x + y, 0) || b.length - a.length)
    .map((teams) => ({ name: teams.every((n) => n === 1) && teams.length > 2 ? `Free for all (${teams.length})` : teams.join('v'), teams }));
}

/**
 * The team for each slot under a layout. Slots are dealt to teams in turn, so the first two bases (the two of every
 * converted original map) are always on opposite sides. The owner can still move any slot to another team.
 */
export function teamsForLayout(teams: readonly number[]): number[] {
  const left = [...teams];
  const out: number[] = [];
  let t = 0;
  while (left.some((n) => n > 0)) {
    while (left[t]! <= 0) t = (t + 1) % left.length;
    out.push(t);
    left[t]!--;
    t = (t + 1) % left.length;
  }
  return out;
}

// ---- Chat --------------------------------------------------------------------------------------------------------

export type ChatChannel = 'all' | 'team' | 'whisper';

export interface ChatMessage {
  id: number;
  channel: ChatChannel;
  from: { id: string; name: string } | null;
  /** The whisper's other end. */
  to?: { id: string; name: string };
  text: string;
  at: number;
  /** A notice from the server or an admin, not a player. */
  system?: boolean;
}

export const CHAT_MAX = 200;

// ---- Matches -----------------------------------------------------------------------------------------------------

export interface MatchSeat {
  /** Player id in the match. */
  player: number;
  base: number;
  team: number;
  name: string;
  userId: string | null;
  bot: boolean;
  /** A bot's skill, 1-9. */
  difficulty?: number;
}

/** Everything a client needs to set up a match: the map itself (custom maps are not in the assets), seats and seed. */
export interface MatchStart {
  gameId: string;
  mapId: string;
  map: RfwMap;
  seed: number;
  difficulty: number;
  /** Extra vehicles for the smaller side (sim startingLives). */
  handicap?: boolean;
  seats: MatchSeat[];
  /** The player id this client controls, or null for a spectator. */
  you: number | null;
  /** The match as it stands, for a client joining one in progress; frames follow from its tick + 1. */
  snapshot?: Snapshot;
}

export interface MatchResult {
  gameId: string;
  /** The winning team, or null for a draw or a match ended early. */
  winner: number | null;
  ticks: number;
  /**
   * Per seat: vehicles lost, enemy flags captured, vehicles left, launches of each vehicle (in VEHICLE_KINDS order)
   * and whether the player quit.
   */
  seats: (MatchSeat & { lost: number; captures: number; left: number; launches: number[]; quit: boolean })[];
  /** Set when an admin ended the match. */
  aborted?: string;
  /** The match ran to the time limit: the winner is the team with the most jeeps left, or a draw if they are level. */
  timeLimit?: true;
}

/** A seat's live connection state, for the scoreboard. */
export interface SeatStatus {
  player: number;
  connected: boolean;
  /** Round trip in ms, for humans. */
  ping?: number;
  /** A bot has taken the seat over from a player who left. */
  botTakeover?: boolean;
}

// ---- Friends -----------------------------------------------------------------------------------------------------

/** A friend as the friends list shows them (GET /api/friends). */
export interface FriendInfo {
  name: string;
  status: 'offline' | 'online' | 'lobby' | 'playing' | 'watching';
  lobbyName?: string;
  /** An open lobby with a free seat: join it by id. */
  joinId?: string;
  /** A game you may watch. */
  gameId?: string;
}

export interface FriendsList {
  friends: FriendInfo[];
  /** Names that asked you. */
  incoming: string[];
  /** Names you asked. */
  outgoing: string[];
}

// ---- Messages ----------------------------------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'hello'; version: number }
  | { t: 'lobbies'; watch: boolean }
  | { t: 'create'; name?: string; mapId: string; visibility: Visibility; slots?: number; teams?: number[] }
  | { t: 'join'; id?: string; code?: string }
  | { t: 'quick' }
  | { t: 'leave' }
  | { t: 'settings'; name?: string; mapId?: string; visibility?: Visibility; difficulty?: number; teams?: number[]; handicap?: boolean }
  | { t: 'slot'; slot: number; kind?: 'open' | 'closed' | 'bot'; team?: number; difficulty?: number }
  | { t: 'seat'; slot: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'kick'; user: string }
  | { t: 'start' }
  | { t: 'chat'; channel: ChatChannel; to?: string; text: string }
  | { t: 'mute'; user: string; muted: boolean }
  | { t: 'report'; message: number; reason: string }
  | { t: 'spectate'; gameId: string }
  | { t: 'loaded' }
  | { t: 'quitGame' }
  | { t: 'rematch' }
  | { t: 'pong'; at: number }
  | { t: 'desyncReport'; tick: number; snapshot: Snapshot };

export type ServerMessage =
  | { t: 'welcome'; version: number; you: Identity; motd?: string; maintenance?: { at: number; message: string } | null }
  | { t: 'reload'; reason: string }
  | { t: 'error'; message: string }
  | { t: 'notice'; text: string }
  | { t: 'lobbies'; list: LobbySummary[] }
  | { t: 'lobby'; lobby: LobbyInfo | null; kicked?: boolean }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chatHistory'; messages: ChatMessage[] }
  | { t: 'start'; match: MatchStart }
  | { t: 'snapshot'; snapshot: Snapshot; reason: 'desync' | 'rejoin' }
  | { t: 'seats'; seats: SeatStatus[] }
  | { t: 'paused'; paused: boolean; reason?: string }
  | { t: 'end'; result: MatchResult }
  | { t: 'ping'; at: number }
  | { t: 'desync'; tick: number }
  /** The friends list changed (a request, an answer); notice says what, for a toast. */
  | { t: 'friends'; notice?: string }
  /** A friend asks you to their lobby. */
  | { t: 'invite'; from: string; lobbyName: string; code: string };
