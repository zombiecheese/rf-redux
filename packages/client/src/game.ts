// One match in this browser: keyboard (or touch) input, bots, the fixed-rate sim loop, and drawing it all into the
// 320 x 240 frame. The title screen, menus and win sequence around it are in main.ts.
//
// An online match runs the same loop, but the server's frames advance it instead of the local clock (lockstep, see
// packages/server/src/room.ts): this browser sends its controls and bunker commands, plays each frame as it arrives
// (a few frames are kept in hand to ride out network jitter, and played faster when too many pile up), and sends a
// hash of its state every HASH_EVERY ticks. Chat, the scoreboard and names over vehicles are drawn into the frame.
//
// Every match is recorded as a replay (packages/net/src/replay.ts), and a replay plays through the same loop: its
// frames advance the match at the speed picked (REPLAY_SPEEDS), with nobody's keys driving.
//
// Options > Picture > Visuals picks how the match is drawn, and can change during it: Retro (the 320 x 240 frame) or
// Modern (modern/renderer.ts: the playfield in 3D at 1280 x 720 with its own HUD). Both draw the same match.

import {
  HASH_EVERY, ONE, TICK_MS, botThink, buildWorld, createBot, createMatch, dock, gateLeft, hashMatch, launch, liftOf, restoreMatch, rivalOf, skullLook, startingLives,
  snapshotMatch, stepMatch,
  VEHICLE_KINDS, type Match, type MatchEvent, type Snapshot, type VehicleInput, type VehicleKind,
} from '@rfw/sim';
import {
  DOCK, ReplayPlayer, ReplayRecorder, SoloRecorder, applyFrame, commandCode, humanGate, lobbyLighting, lobbyVisuals, packInput,
  type MatchResult, type MatchStart, type Replay, type SoloLog,
} from '@rfw/net';
import type { GameAssets } from './assets.js';
import { BAYS, drawBunker } from './bunker.js';
import { Camera, FOCAL, ROAM_CLASSIC, ROAM_MODERN, layout } from './camera.js';
import { heldBack, type Display } from './display.js';
import { setTouchMode, setTouchVehicle, touchModeFor } from './touch.js';
import { Effects } from './effects.js';
import { LINE, drawText, textWidth } from './font.js';
import { drawHud } from './hud.js';
import { ONLINE_KEYS, REPLAY_KEYS, activeControls, bindingsVersion, keyName, playKeys, typingIn, type Controls } from './keys.js';
import type { Net } from './online/net.js';
import { ChatInput, chatRuns, drawChat, drawNames, drawScoreboard, scoreRows } from './online/overlay.js';
import { Frame, SCREEN_H, SCREEN_W } from './raster.js';
import type { Music } from './music/music.js';
import type { Sound } from './sound.js';
import { drawSkull } from './skull.js';
import { drawView } from './view.js';
import { MODERN_H, MODERN_W, modernAvailable, modernLayout, type ModernRect } from './modern/layout.js';
import type { ModernRenderer, ModernScreen, ModernView } from './modern/renderer.js';
import type { ModernFinale } from './modern/finale.js';
import { giveUpModern, loadModern, modernFailed, modernLoaded } from './modern/load.js';
import { stats } from './modern/stats.js';
import { showcase } from './modern/showcase.js';
import { PRESETS, PRESET_NAMES, Pacer, activePreset, type Preset } from './quality.js';
import { FEED_STEP, loadingState } from './loading.js';
import { bunkerBayAt, dimView, drawBanner, drawLinkUp, drawBunkerPanel, drawChatLines, drawLog, drawFeed, drawModernHud, drawName, drawNote, drawScoreTable, setTouchHud } from './modern/hud.js';
import { TEAMS } from './paint.js';


// Launch keys pick, in order: jeep, tank, ASV, helicopter.
const LAUNCH_ORDER: VehicleKind[] = ['jeep', 'tank', 'asv', 'heli'];
const LABEL: Record<VehicleKind, string> = { tank: 'Tank', jeep: 'Jeep', asv: 'ASV', heli: 'Helicopter' };
/** How long the finished match stays on screen before the win sequence (inferred, about three seconds). */
const END_HOLD_MS = 3000;
/** Online: frames kept in hand against jitter, and the backlog past which they are played faster to catch up. */
const BUFFER_FRAMES = 3;
const CATCH_UP_FRAMES = 8;
/** Online: snapshots kept at the last few hash checkpoints, for a desync report. */
const KEEP_SNAPSHOTS = 4;
/** Every key a replay answers to, kept from the page (Page Up and Down would scroll it). */
const REPLAY_CODES = new Set<string>(Object.values(REPLAY_KEYS).flat());
/** Replay speeds, slowest first; 1 is real time. Above 2x the sound effects are left out. */
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
/** Ten seconds of frames, for the replay's back and on keys. */
const REPLAY_JUMP = Math.round(10_000 / TICK_MS);
/** Fast-forwarding a replay (a seek) plays this long per picture, so the page keeps drawing. */
const SEEK_BUDGET_MS = 30;
/** Matches shorter than this (in frames, about five seconds) are not kept as replays. */
const MIN_REPLAY_FRAMES = Math.round(5000 / TICK_MS);

export interface GameOptions {
  assets: GameAssets;
  display: Display;
  sound: Sound;
  music: Music;
  seed: number;
  /** 1: Training, against the computer (or nobody, with bots off); 2: Tournament, split screen. */
  players: 1 | 2;
  difficulty: number;
  /** Player names by base: Brown (base 1) and Green (base 2) in the original's two-base maps. */
  names: readonly string[];
  /** Swap Sides: the arrow keys play Brown in a two-player game. */
  swapSides: boolean;
  bots: boolean;
  /** Offline: the team of each seat, the players' bases first and then the rest in map order. Left out, every base is its own team. */
  teams?: readonly number[];
  /** Offline: extra vehicles for the smaller side (sim startingLives). */
  handicap?: boolean;
  /** The base the (first) player starts from; the other bases are the computer's. Defaults to base 1. */
  homeBase?: number;
  /** A handheld waits while held upright. */
  handheld: boolean;
  /** The map, for recording a Training run for the leaderboards. */
  mapId?: string;
  /** An online match: the server's frames drive it, and this browser plays seat start.you (or watches). */
  online?: { start: MatchStart; net: Net };
  /** The map's name, for the replay list. */
  mapName?: string;
  /** Called with the match's replay when it ends or is left (not for one shorter than a few seconds). */
  onReplay?: (r: Replay) => void;
  /** Plays a replay instead of a match. */
  replay?: Replay;
  /** How to draw the match, read every frame (Options > Picture > Visuals); retro when left out. */
  visuals?: () => 'retro' | 'modern';
  /** The modern view's lighting. */
  lighting?: () => 'day' | 'night';
  /** Whether the modern view's thermal camera is on (its key or button in the match). */
  thermal?: () => boolean;
  /** Each part of getting the match ready, as it is done, for the loading screen (PREP_STEPS' labels). */
  onStep?: (label: string) => void;
}

/**
 * What a match gets ready behind the loading screen once its map is in, so nothing is loaded or made for the first
 * time mid-match: the sounds and music, then in the modern view its renderer and every model and shader it can need.
 * Online the match then waits for the other players (SYNC_STEP). Labels as the modern feed's log shows them.
 */
export const AUDIO_STEP: [string, string] = ['AUDIO BANK', 'Loading sounds and music'];
export const SHADER_STEP: [string, string] = ['SHADER CACHE', 'Warming up the 3D view'];
export const SYNC_STEP: [string, string] = ['SQUAD SYNC', 'Waiting for the other players'];

/** What a replay's controls (main.ts) show and change. */
export interface ReplayControl {
  readonly frame: number;
  readonly frames: number;
  readonly speed: number;
  readonly watching: number;
  readonly outOfStep: boolean;
  setSpeed(speed: number): void;
  seek(frame: number): void;
  /** Follows a player (and leaves the free camera). */
  follow(player: number): void;
  /** Whether the free camera is on: panned and zoomed by hand, following nobody. */
  readonly free: boolean;
  roam(on: boolean): void;
  /** Zooms the free camera (turning it on) by a factor: above 1 closes in. */
  zoom(factor: number): void;
}

/** How a match ended: the winning side (0 Brown, 1 Green), or null when every base was out at once. */
export interface Outcome {
  winner: 0 | 1 | null;
  /** The winning base itself, for maps with more than two (the level editor's test play). */
  winnerBase: number | null;
  /** Game time, from the tick count. */
  ms: number;
  /** A won Training run, to send for the leaderboards. */
  solo?: SoloLog;
  /** Online: the winning team (any of 0-3), and the server's result. */
  team?: number | null;
  result?: MatchResult;
  /** Each player's part in it, for the results screen. */
  board?: ResultRow[];
}

/** One player's line on the results screen. */
export interface ResultRow {
  name: string;
  team: number;
  base: number;
  /** Vehicles lost, enemy flags brought home, and vehicles still in the bunker. */
  lost: number;
  captures: number;
  left: number;
  you: boolean;
  bot: boolean;
  quit?: boolean;
}

export class Game {
  /** The last picture drawn, for fading out into the win sequence. */
  readonly picture = new OffscreenCanvas(SCREEN_W, SCREEN_H);
  /** Settles with the outcome once the match is over and has been on screen a moment, or null when stopped. */
  readonly done: Promise<Outcome | null>;
  /** The match as it ended, for the win scene; null until then. */
  finale: { match: Match; assets: GameAssets; modern: ModernFinale | null } | null = null;
  private finish!: (o: Outcome | null) => void;
  /**
   * Settles once the match is on screen: everything loaded and made ready (see AUDIO_STEP), and online the server
   * started it (every player has loaded). Until then the loading screen stays up and nothing is drawn.
   */
  readonly live: Promise<void>;
  private goLive!: () => void;
  private readonly abort = new AbortController();
  private raf = 0;
  private held = false;

  constructor(private readonly o: GameOptions) {
    this.done = new Promise((resolve) => (this.finish = resolve));
    this.live = new Promise((resolve) => (this.goLive = resolve));
    // The bars round the picture go back to the neutral camo once the match is over.
    void this.done.then(() => (o.display.sides = []));
    this.run();
  }

  get paused(): boolean {
    return this.held;
  }

  get online(): boolean {
    return !!this.o.online;
  }

  /**
   * The visuals this match is shown in whatever the player's Options say: a replay as its match was seen, or the
   * host's pick for everyone online; null when the player's own choice applies.
   */
  /** Whether the match is at night: the replay's, the host's pick online, or the player's own. */
  get night(): boolean {
    const start = this.o.online?.start;
    return (this.o.replay?.look?.lighting ?? (start ? lobbyLighting(start.lighting) : this.o.lighting?.())) === 'night';
  }

  get fixedVisuals(): 'retro' | 'modern' | null {
    const v = this.o.replay?.look?.visuals ?? this.o.online?.start.visuals;
    return v === 'retro' || v === 'modern' ? v : null;
  }

  /** Set while a replay plays: its position and speed, for the replay bar. */
  replayControl: ReplayControl | null = null;

  /** Pause/Resume (P): the match and its sounds wait, and the loop stops drawing so the pause card can show. */
  pause(on: boolean): void {
    if (this.held === on || this.abort.signal.aborted) return;
    // An online match cannot wait for one player; the menus open over it while it plays on.
    if (this.o.online) return;
    this.held = on;
    this.o.sound.hold(on);
    this.o.music.hold(on);
    // A paused replay keeps drawing, so the free camera can look round the moment it holds.
    if (this.o.replay) return;
    if (on) cancelAnimationFrame(this.raf);
    else this.resume?.();
  }

  /** Leaves the match (Restart, New Game, Exit). */
  stop(): void {
    if (this.abort.signal.aborted) return;
    this.handOver?.();
    this.abort.abort();
    cancelAnimationFrame(this.raf);
    this.o.sound.reset();
    this.o.sound.hold(false);
    this.o.music.hold(false);
    this.o.music.endMatch();
    this.finish(null);
  }

  private resume?: () => void;
  /** Hands the replay so far over, for a match left before the end. */
  private handOver?: () => void;

  private run(): void {
    const { assets, display, sound, music, online } = this.o;
    const signal = this.abort.signal;
    const start = online?.start;
    const net = online?.net;
    /** Retro or modern: a replay as its match was seen, the host's pick for everyone online, or the player's own. */
    const wanted = () => replay?.look?.visuals ?? (start ? lobbyVisuals(start.visuals) : this.o.visuals?.());
    const nightNow = () => this.night;
    // The host's pick brings its own soundtrack too.
    if (this.fixedVisuals) music.setStyle(this.fixedVisuals === 'modern' && modernAvailable() ? 'modern' : 'retro');
    const players = online ? 1 : this.o.players;
    let sides = activeControls();
    const pick = () => (online || players === 1 ? [sides.solo] : this.o.swapSides ? [sides.right, sides.left] : [sides.left, sides.right]);
    let controls = pick();
    let keysVersion = bindingsVersion();
    const world = buildWorld(start?.map ?? assets.map, assets.defs, assets.shore);
    const statics = { defs: assets.defs, shore: assets.shore };
    // Offline every base is played, each as its own team: the players' first, then the computer's.
    const home = this.o.homeBase ?? 0;
    const order = [...world.bases.map((b) => b.id).filter((b) => b === home), ...world.bases.map((b) => b.id).filter((b) => b !== home)];
    const replayer = this.o.replay ? new ReplayPlayer(this.o.replay, assets.defs, assets.shore) : null;
    const replay = this.o.replay;
    // The modern renderer's code is fetched now, if it is not here yet, so the match can open in it.
    if (wanted() === 'modern' && modernAvailable()) void loadModern();
    // With two or more people playing, the match starts when the last of them has picked a vehicle (sim StartGate).
    const gate = start ? humanGate(start.seats) : players >= 2 ? Array.from({ length: players }, (_, p) => p) : undefined;
    let match: Match = replayer
      ? replayer.match
      : start
      ? start.snapshot
        ? restoreMatch(start.snapshot, statics)
        : createMatch(world, start.map, start.seats.map((s) => ({ base: s.base, team: s.team })), start.seed, { difficulty: start.difficulty, handicap: start.handicap === true, gate })
      : createMatch(world, assets.map, order.map((base, i) => ({ base, team: this.o.teams?.[i] ?? base })), this.o.seed, { difficulty: this.o.difficulty, handicap: this.o.handicap === true, gate });

    /** Each player's vehicles at the start, for the skull's row of lives. */
    const handicap = (replay ? replay.handicap : start ? start.handicap : this.o.handicap) === true;
    const startSlots = match.players.map((p) => ({ base: p.base, team: p.team }));
    const startLives = match.players.map((p) => startingLives(replay?.map ?? start?.map ?? assets.map, startSlots, p.id, handicap));
    // Who each view follows: the local players, or online this browser's seat (a spectator picks with 1-4 or the arrows).
    let watched = start ? (start.you ?? 0) : 0;
    const me = start ? start.you : replay ? null : 0;
    /** Still in the match: worth watching. */
    const playing = (id: number): boolean => {
      const q = match.players[id];
      return !!q && q.state !== 'out' && !match.eliminated[q.base];
    };
    /** The player each view has picked to watch once its own base is out (null: not picked yet). */
    const picked: (number | null)[] = [null, null];
    // A player whose base is out watches the one they picked, else a teammate still in the match, else anyone still in.
    const follow = (p: number, i: number): number => {
      const pl = match.players[p]!;
      if (pl.state !== 'out') return p;
      const c = picked[i];
      if (c !== null && c !== undefined && playing(c)) return c;
      return match.players.find((q) => q.team === pl.team && playing(q.id))?.id ?? match.players.find((q) => playing(q.id))?.id ?? p;
    };
    const seats = (): number[] => (online || replay ? [watched] : Array.from({ length: players }, (_, p) => p));
    const viewers = (): number[] => (me === null ? seats() : seats().map(follow));
    /** Watching (a spectator, or a player whose base is out): view i follows player n, if they are still in. */
    const choose = (i: number, n: number): boolean => {
      if (me === null) {
        if (n < 0 || n >= match.players.length || n === watched) return false;
        watched = n;
        return true;
      }
      if (!playing(n) || viewers()[i] === n) return false;
      picked[i] = n;
      return true;
    };
    /** Watching: view i moves on to the next (step 1) or the one before (step -1) of the players still in. */
    const cycle = (i: number, step: 1 | -1): boolean => {
      const left = match.players.filter((q) => playing(q.id)).map((q) => q.id);
      if (!left.length) return false;
      const at = left.indexOf(viewers()[i]!);
      const n = at < 0 ? left[step > 0 ? 0 : left.length - 1]! : left[(at + step + left.length) % left.length]!;
      return choose(i, n);
    };
    /**
     * A key pressed by someone watching: turn left / right step through the players still in (fire steps on), and the
     * launch keys (or 1-4) pick player 1-4. Returns whether the view changed.
     */
    const watchKey = (i: number, c: Controls, code: string): boolean => {
      if (c.left.includes(code)) return cycle(i, -1);
      if (c.right.includes(code) || c.fire.includes(code)) return cycle(i, 1);
      const slot = c.launch.findIndex((codes) => codes.includes(code));
      if (slot >= 0) return choose(i, slot);
      // One view on the screen: the number keys (and the touch buttons P1-P4) pick a player too.
      const n = players === 1 || online ? (ONLINE_KEYS.follow as readonly string[]).indexOf(code) : -1;
      return n >= 0 && choose(i, n);
    };
    const names = replay ? match.players.map((p) => replay.seats[p.id]?.name ?? `Base ${p.base + 1}`) : this.o.names;
    // A replay shows names as an online match does, from its seats.
    const shown: MatchStart | undefined = start ?? (replay ? {
      gameId: '', mapId: replay.mapId, map: replay.map, seed: replay.seed, difficulty: replay.difficulty, you: null,
      seats: replay.seats.map((x, i) => ({ player: i, base: x.base, team: x.team, name: x.name, userId: null, bot: false })),
    } : undefined);
    const baseName = (base: number) => {
      if (replay) return replay.seats.find((x) => x.base === base)?.name ?? `Base ${base + 1}`;
      if (!start) return names[base] ?? `Base ${base + 1}`;
      const seat = start.seats.find((s) => s.base === base);
      return seat ? seat.name : `Base ${base + 1}`;
    };
    const playerName = (id: number) => (shown ? shown.seats[id]?.name ?? `Player ${id + 1}` : baseName(match.players[id]!.base));

    // The replay of this match: how it started, then each frame as it is played.
    const recording = replay ? null : new ReplayRecorder({
      at: Date.now(), mode: online ? 'online' : players === 2 ? 'tournament' : 'training',
      mapId: start?.mapId ?? this.o.mapId ?? '', mapName: this.o.mapName ?? (start?.map ?? assets.map).name ?? 'Untitled',
      map: start?.map ?? assets.map, seed: start?.seed ?? this.o.seed, difficulty: start?.difficulty ?? this.o.difficulty, ...(handicap ? { handicap } : {}),
      ...(gate && gate.length >= 2 ? { gate } : {}),
      look: { visuals: wanted() === 'modern' && modernAvailable() ? 'modern' : 'retro', lighting: nightNow() ? 'night' : 'day' },
      seats: start ? start.seats.map((x) => ({ base: x.base, team: x.team, name: x.name }))
        : match.players.map((p) => ({ base: p.base, team: p.team, name: names[p.base] ?? `Base ${p.base + 1}` })),
      ...(start?.snapshot ? { snapshot: start.snapshot } : {}),
    });
    let replayHandedOver = false;
    const handOverReplay = (winner: number | null) => {
      if (!recording || replayHandedOver || recording.length < MIN_REPLAY_FRAMES) return;
      replayHandedOver = true;
      try {
        this.o.onReplay?.(recording.finish(winner));
      } catch {
        // A replay that cannot be kept is not worth stopping the game for.
      }
    };
    this.handOver = () => handOverReplay(null);

    const lowCtx = this.picture.getContext('2d')!;
    const frame = new Frame();
    const image = new ImageData(new Uint8ClampedArray(frame.px.buffer), SCREEN_W, SCREEN_H);
    const cameras = layout(players).map((v) => new Camera(v));
    /** The modern view, made the first time it is picked; the text over it is drawn into its own frame. */
    let modern: ModernRenderer | null = null;
    /** Modern: where each view went on the last picture, for taps on the bunker. */
    let modernRects: ModernRect[] | null = null;
    /** Modern: the link-up screen, drawn while the modern renderer is still loading. */
    let linkUp: OffscreenCanvas | null = null;
    // The modern renderer outlives the match when it is handed to the win scene, which disposes of it.
    signal.addEventListener('abort', () => {
      if (!this.finale?.modern) modern?.dispose();
    });

    const chat = online ? new ChatInput(net!, start!, signal) : null;
    let scoreboard = false;
    const keys = new Set<string>();
    const pressed: string[] = [];
    let ours = playKeys();
    // A button or box left focused by a menu or the lobby must not take Space, Enter or the arrows from the match.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    addEventListener('keydown', (e) => {
      // The chat line, a dialog's text box or an open menu has the keyboard; so do Ctrl, Alt and the system key,
      // which only the shortcuts use.
      if ((this.held && !replayer) || chat?.typing || typingIn(e) || document.body.classList.contains('menu-open')) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (replayer && REPLAY_CODES.has(e.code)) e.preventDefault();
      // A key still held from the chat line or a dialog repeats, but it was not pressed in the match.
      if (e.repeat && !keys.has(e.code)) return;
      if (chat && e.code === ONLINE_KEYS.chat && !e.repeat) {
        e.preventDefault();
        keys.clear();
        chat.open();
        return;
      }
      if (online && e.code === ONLINE_KEYS.scoreboard) {
        e.preventDefault();
        scoreboard = true;
        return;
      }
      if (ours.has(e.code)) e.preventDefault();
      if (!e.repeat) pressed.push(e.code);
      keys.add(e.code);
    }, { signal });
    addEventListener('keyup', (e) => {
      keys.delete(e.code);
      if (e.code === ONLINE_KEYS.scoreboard) scoreboard = false;
    }, { signal });
    addEventListener('blur', () => {
      keys.clear();
      scoreboard = false;
    }, { signal });

    const input = (p: number): VehicleInput | undefined => {
      if (p >= players) return undefined;
      const c = controls[p]!;
      const held = (codes: string[]) => codes.some((k) => keys.has(k));
      return {
        throttle: held(c.up) ? 1 : held(c.down) ? -1 : 0,
        turn: held(c.right) ? 1 : held(c.left) ? -1 : 0,
        fire: held(c.fire),
        fire2: held(c.fire2),
        fire3: held(c.fire3),
        turretLeft: held(c.turretLeft),
        turretRight: held(c.turretRight),
      };
    };

    // The bay each player has picked on the bunker screen: arrows move between the four bays, fire launches.
    const selected: VehicleKind[] = Array.from({ length: players }, () => 'tank');
    const moveSelection = (p: number, code: string): boolean => {
      const c = controls[p]!;
      const i = BAYS.findIndex((b) => b.kind === selected[p]);
      let next = i;
      if (c.left.includes(code) || c.right.includes(code)) next = i ^ 1;
      else if (c.up.includes(code) || c.down.includes(code)) next = i ^ 2;
      else return false;
      selected[p] = BAYS[next]!.kind;
      return true;
    };

    // Tapping or clicking a bay on the bunker screen picks it, and tapping the picked bay again launches it.
    const taps: { p: number; kind: VehicleKind }[] = [];
    display.canvas.addEventListener('pointerdown', (e) => {
      if (this.held || chat?.typing || document.body.classList.contains('menu-open') || e.button > 0) return;
      const r = display.rect;
      const fx = (e.clientX - r.x) / r.w;
      const fy = (e.clientY - r.y) / r.h;
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
      const vs = viewers();
      cameras.forEach((cam, i) => {
        const p = online ? (i === 0 ? me : null) : i < players ? i : null;
        if (p === null || vs[i] !== p || match.players[p]!.state !== 'bunker') return;
        const rect = modernRects?.[i];
        const kind = modernRects && rect && modern
          ? bunkerBayAt(rect, (rr, x, y, z) => modern!.bunkerPoint(rr, x, y, z), fx * MODERN_W, fy * MODERN_H)
          : bayAt(cam.view, fx * SCREEN_W, fy * SCREEN_H);
        if (!kind) return;
        e.preventDefault();
        taps.push({ p, kind });
      });
    }, { signal });

    // Offline the bases with no player are the computer's, which waits until a player launches.
    const bots = new Map<number, ReturnType<typeof createBot>>();
    if (!online && !replay && this.o.bots) for (let p = players; p < match.players.length; p++) bots.set(p, createBot(null, Array.from({ length: players }, (_, h) => h)));
    // A Training game against the computer on a built-in map, every base for itself and no handicap, is recorded, so
    // a win can go on the leaderboards (the server replays it as player 0 on base 1 against a bot on every other).
    const recordable = !online && !replay && players === 1 && this.o.bots && !!this.o.mapId && !this.o.mapId.includes(':') && match.players.length >= 2
      && home === 0 && !handicap && match.players.every((p) => p.team === p.base && p.id === p.base);
    const recorder = recordable ? new SoloRecorder(this.o.mapId!, this.o.seed, this.o.difficulty) : null;

    let effects = new Effects(assets);
    /** Replays above 2x, and seeking, leave the sound effects out. */
    let quiet = false;
    const log: { text: string; until: number }[] = [];
    const say = (text: string) => log.push({ text, until: performance.now() + 4000 });
    /** Online: enemy flags each player has brought home, for the scoreboard. */
    const captures: number[] = [];
    /** Vehicles each player has lost, for the results. */
    const lost: number[] = [];
    const describe = (e: MatchEvent): string | null => {
      switch (e.type) {
        case 'destroyed': return `${playerName(e.player)} lost a ${LABEL[e.kind].toLowerCase()}`;
        case 'flagRevealed': return `${baseName(e.base)}'s flag is exposed`;
        case 'flagTaken': return `${playerName(e.player)} has ${baseName(e.base)}'s flag`;
        case 'flagDropped': return `${baseName(e.base)}'s flag was dropped`;
        case 'captured': return `${playerName(e.player)} captured ${baseName(e.base)}'s flag${e.left ? ` (${e.left} more to go)` : ''}`;
        case 'flagReturned': return `${playerName(e.player)} returned ${baseName(e.base)}'s flag`;
        case 'eliminated': return `${baseName(e.base)} is out`;
        default: return null;
      }
    };

    /** When a base played on this screen goes out: how to pick who to watch, if anyone is left to watch. */
    const outHint = (base: number) => {
      if (me === null || replay) return;
      const ours = seats().filter((p) => match.players[p]!.base === base);
      if (!ours.length || !match.players.some((q) => playing(q.id))) return;
      if (this.o.handheld) return say('You are out: P1-P4 pick who to watch');
      for (const p of ours) {
        const i = seats().indexOf(p);
        const c = controls[i]!;
        // One view: the arrows (the last of the merged keys) or 1-4; split screen: that half's own turn keys.
        const keys = players > 1 ? `${keyName(c.left[0]!)} / ${keyName(c.right[0]!)}` : `${keyName(c.left.at(-1)!)} / ${keyName(c.right.at(-1)!)} or 1-4`;
        say(`${players > 1 ? `${baseName(base)} is out` : 'You are out'}: ${keys} pick who to watch`);
      }
    };

    /** Effects, sounds, messages and cameras after a tick, local or online. */
    /** Each lift on the map's phase when last heard (modern view). */
    const liftHeard = new Map<(typeof match.lifts)[number], string>();
    const afterTick = () => {
      effects.add(match.events, match);
      if (modern && !quiet) modern.events(match.events, match);
      const scripted = effects.takeSounds();
      if (!quiet) {
        sound.events(match, match.events, !!assets.effects, viewers());
        sound.scripted(scripted);
        // In the modern view the lift on the map is heard too: its hatch opening, and the platform locking at the top.
        if (wanted() === 'modern' && modern) {
          for (const l of match.lifts) {
            const was = liftHeard.get(l);
            if (was === l.phase) continue;
            if (l.phase === 'rise' || (l.phase === 'sink' && !was)) sound.lift('open', l.tile);
            else if (l.phase === 'up') sound.lift('lock', l.tile);
            liftHeard.set(l, l.phase);
          }
        }
      }
      for (const l of liftHeard.keys()) if (!match.lifts.includes(l)) liftHeard.delete(l);
      sound.update(match, cameras.map((c) => ({ x: c.x, y: c.y })));
      music.tick(match, match.events);
      for (const e of match.events) {
        const text = describe(e);
        if (text) say(text);
        if (e.type === 'eliminated') outHint(e.base);
        if (e.type === 'captured') captures[e.player] = (captures[e.player] ?? 0) + 1;
        if (e.type === 'destroyed') lost[e.player] = (lost[e.player] ?? 0) + 1;
        if (e.type === 'go' && me !== null) {
          // Online the lift's own sound plays as the frame comes in (playFrame).
          if (!net) sound.ui('raise');
          say(wanted() === 'modern' ? 'ALL OPERATORS READY: DEPLOYING' : 'All players ready: go!');
        }
      }
      aimCameras();
    };

    /** Each view's camera on the vehicle it follows, or its base's lift. */
    const aimCameras = () => {
      const v = viewers();
      cameras.forEach((cam, i) => {
        const pl = match.players[v[i]!]!;
        const home = match.world.bases[pl.base]!.start;
        // A docking vehicle goes down on the lift where it stood, and the view stays on it. A lost one's view stays
        // on its wreck while that lasts, and then where it was, until the skull or the bunker takes over.
        if (pl.state === 'lost' || pl.state === 'skull') {
          const wreck = match.wrecks.find((w) => w.id === pl.death?.wreck);
          if (wreck) cam.update(wreck, 0, 0);
          return;
        }
        cam.update(pl.vehicle ?? (pl.state === 'docking' ? liftOf(match, v[i]!)?.vehicle ?? null : null), home.tx * 32 + 16, home.ty * 32 + 16);
      });
    };

    const tick = () => {
      /** This tick's bunker commands, in the order they were applied, for the replay. */
      const commands: [number, number][] = [];
      /** True for a launch, false for none, null for a pick behind the start gate (it clicks). */
      const doLaunch = (p: number, kind: VehicleKind): boolean | null => {
        commands.push([p, commandCode({ launch: kind })]);
        const gated = !!match.gate;
        const ok = launch(match, p, kind);
        if (ok && gated) {
          if (p < players) sound.ui('click');
          return null;
        }
        return ok;
      };
      const doDock = (p: number) => {
        commands.push([p, DOCK]);
        return dock(match, p);
      };
      for (const code of pressed.splice(0)) {
        for (let p = 0; p < players; p++) {
          const c = controls[p]!;
          // Out of the match: the keys pick who to watch.
          if (match.players[p]!.state === 'out') {
            if (watchKey(p, c, code)) sound.ui('click');
            continue;
          }
          const slot = c.launch.findIndex((codes) => codes.includes(code));
          if (slot >= 0) {
            selected[p] = LAUNCH_ORDER[slot]!;
            if (p === 0) recorder?.command(commandCode({ launch: LAUNCH_ORDER[slot]! }));
            if (doLaunch(p, LAUNCH_ORDER[slot]!)) sound.ui('raise');
          }
          if (c.dock.includes(code)) {
            if (p === 0) recorder?.command(commandCode({ dock: true }));
            if (doDock(p)) sound.ui('raise');
          }
          if (match.players[p]!.state !== 'bunker') continue;
          if (c.fire.includes(code)) {
            if (p === 0) recorder?.command(commandCode({ launch: selected[p]! }));
            const r = doLaunch(p, selected[p]!);
            if (r !== null) sound.ui(r ? 'raise' : 'click');
          } else if (moveSelection(p, code)) sound.ui('click');
        }
      }
      for (const { p, kind } of taps.splice(0)) {
        if (match.players[p]!.state !== 'bunker') continue;
        if (selected[p] !== kind) {
          selected[p] = kind;
          sound.ui('click');
          continue;
        }
        if (p === 0) recorder?.command(commandCode({ launch: kind }));
        const r = doLaunch(p, kind);
        if (r !== null) sound.ui(r ? 'raise' : 'click');
      }
      const inputs = match.players.map((_, p) => input(p));
      recorder?.input(packInput(inputs[0]));
      for (const [p, bot] of bots) {
        const move = botThink(match, p, bot);
        if (move.launch) doLaunch(p, move.launch);
        if (move.dock) doDock(p);
        inputs[p] = move.input;
      }
      stepMatch(match, inputs);
      recording?.frame(match, inputs.map((i) => packInput(i)), commands);
      afterTick();
    };

    // ---- Replay ----

    let speed = 1;
    let seekTo: number | null = null;
    /** Puts the picture right after a jump: fresh effects, cameras on the new spot. */
    const settle = () => {
      effects = new Effects(assets);
      sound.reset();
      quiet = true;
      afterTick();
      quiet = speed > 2;
    };
    if (replayer) {
      this.replayControl = {
        get frame() { return seekTo ?? replayer.frame; },
        get frames() { return replayer.frames; },
        get speed() { return speed; },
        get watching() { return watched; },
        get outOfStep() { return replayer.outOfStep; },
        setSpeed: (n) => {
          speed = n;
          quiet = speed > 2;
        },
        seek: (f) => {
          seekTo = Math.max(0, Math.min(replayer.frames, Math.round(f)));
          // Back is quick (from a kept state); on is played through a slice per picture, in the loop.
          if (seekTo < replayer.frame) {
            replayer.seek(seekTo);
            match = replayer.match;
            seekTo = null;
            settle();
          }
        },
        follow: (p) => {
          if (p >= 0 && p < match.players.length) watched = p;
          cameras[0]!.roam(false);
        },
        get free() { return cameras[0]!.free; },
        roam: (on) => cameras[0]!.roam(on),
        zoom: (factor) => {
          cameras[0]!.roam(true);
          cameras[0]!.zoom(factor, roamRange());
        },
      };
    }
    /** How near and far the free camera goes: closer in the modern view; the classic view keeps its pixels 1:1 at most. */
    const roamRange = () => (wanted() === 'modern' && modern ? ROAM_MODERN : ROAM_CLASSIC);
    /** The free camera, a picture at a time: held keys pan and zoom it at a rate in real time, whatever the speed. */
    let roamLast = performance.now();
    const roamFrame = (now: number) => {
      const dt = Math.min(0.1, (now - roamLast) / 1000);
      roamLast = now;
      const cam = cameras[0]!;
      const held = (codes: readonly string[]) => codes.some((k) => keys.has(k));
      const k = REPLAY_KEYS;
      const dx = (held(k.panRight) ? 1 : 0) - (held(k.panLeft) ? 1 : 0);
      const dy = (held(k.panDown) ? 1 : 0) - (held(k.panUp) ? 1 : 0);
      const dz = (held(k.zoomIn) ? 1 : 0) - (held(k.zoomOut) ? 1 : 0);
      if (dx || dy || dz) cam.roam(true);
      if (!cam.free) return;
      cam.roamFrame();
      // Panning covers about a view's width in a second and a half, whatever the zoom.
      const step = (FOCAL + cam.pose().z) * 1.1 * dt;
      if (dx || dy) cam.pan(dx * step, dy * step);
      cam.zoom(Math.exp(dz * 1.4 * dt), roamRange());
    };
    /** A point on the page as an offset from the replay view's centre, in the 320 x 240 view's pixels. */
    const viewOffset = (clientX: number, clientY: number): { x: number; y: number } | null => {
      const r = display.rect;
      if (!r.w || !r.h) return null;
      const fx = (clientX - r.x) / r.w;
      const fy = (clientY - r.y) / r.h;
      const cam = cameras[0]!;
      const view = cam.view;
      if (wanted() === 'modern' && modern) {
        const rect = (modernRects ?? modernLayout(cameras.length))[0]!;
        const k = rect.w / view.w;
        return { x: (fx * MODERN_W - rect.x - rect.w / 2 - view.dx * k) / k, y: (fy * MODERN_H - rect.y - rect.h / 2 - view.dy * k) / k };
      }
      const c = cam.centre;
      return { x: fx * SCREEN_W - c.x, y: fy * SCREEN_H - c.y };
    };
    if (replayer) {
      // Drag to move the free camera, pinch or the mouse wheel to zoom it; a tap that does not move leaves it be.
      const canvas = display.canvas;
      const points = new Map<number, { x: number; y: number }>();
      let travelled = 0;
      canvas.style.cursor = 'grab';
      signal.addEventListener('abort', () => (canvas.style.cursor = ''));
      canvas.addEventListener('pointerdown', (e) => {
        if (document.body.classList.contains('menu-open') || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        if (!points.size) travelled = 0;
        points.set(e.pointerId, { x: e.clientX, y: e.clientY });
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
      }, { signal });
      canvas.addEventListener('pointermove', (e) => {
        const was = points.get(e.pointerId);
        if (!was) return;
        const now = { x: e.clientX, y: e.clientY };
        const cam = cameras[0]!;
        const other = [...points].find(([id]) => id !== e.pointerId)?.[1];
        travelled += Math.hypot(now.x - was.x, now.y - was.y);
        points.set(e.pointerId, now);
        if (travelled < 6) return;
        cam.roam(true);
        if (other) {
          // Two fingers: the gap between them zooms, and the point between them moves the camera.
          const gap0 = Math.hypot(was.x - other.x, was.y - other.y);
          const gap1 = Math.hypot(now.x - other.x, now.y - other.y);
          const m0 = viewOffset((was.x + other.x) / 2, (was.y + other.y) / 2);
          const m1 = viewOffset((now.x + other.x) / 2, (now.y + other.y) / 2);
          if (!m0 || !m1) return;
          if (gap0 > 8 && gap1 > 8) cam.zoom(gap1 / gap0, roamRange(), m0.x, m0.y);
          cam.drag(m0.x, m0.y, m1.x, m1.y);
          return;
        }
        const a = viewOffset(was.x, was.y);
        const b = viewOffset(now.x, now.y);
        if (a && b) cam.drag(a.x, a.y, b.x, b.y);
      }, { signal });
      const lift = (e: PointerEvent) => {
        points.delete(e.pointerId);
        if (!points.size) canvas.style.cursor = 'grab';
      };
      canvas.addEventListener('pointerup', lift, { signal });
      canvas.addEventListener('pointercancel', lift, { signal });
      canvas.addEventListener('wheel', (e) => {
        if (document.body.classList.contains('menu-open')) return;
        e.preventDefault();
        const at = viewOffset(e.clientX, e.clientY);
        const cam = cameras[0]!;
        cam.roam(true);
        // A notch of a wheel (about 100 px, or 3 lines) closes in or pulls back by about a sixth.
        const delta = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
        cam.zoom(Math.exp(-delta * 0.0016), roamRange(), at?.x ?? 0, at?.y ?? 0);
      }, { signal, passive: false });
    }
    const replayKeys = () => {
      const ctl = this.replayControl!;
      for (const code of pressed.splice(0)) {
        const has = (keys: readonly string[]) => keys.includes(code);
        const at = REPLAY_SPEEDS.indexOf(speed as (typeof REPLAY_SPEEDS)[number]);
        if (has(REPLAY_KEYS.slower)) ctl.setSpeed(REPLAY_SPEEDS[Math.max(0, at - 1)]!);
        else if (has(REPLAY_KEYS.faster)) ctl.setSpeed(REPLAY_SPEEDS[Math.min(REPLAY_SPEEDS.length - 1, at + 1)]!);
        else if (has(REPLAY_KEYS.back)) ctl.seek(ctl.frame - REPLAY_JUMP);
        else if (has(REPLAY_KEYS.forward)) ctl.seek(ctl.frame + REPLAY_JUMP);
        else if (has(REPLAY_KEYS.freeCamera)) ctl.roam(!ctl.free);
        else {
          const n = (REPLAY_KEYS.follow as readonly string[]).indexOf(code);
          if (n >= 0) ctl.follow(n);
        }
      }
    };

    // ---- Online ----

    let result: MatchResult | null = null;
    let serverPause: string | null = null;
    const snapshots = new Map<number, Snapshot>();
    if (net) {
      const offs = [
        net.on('snapshot', (s) => {
          match = restoreMatch(s, statics);
          recording?.repair(s);
          say('Back in step with the server');
        }),
        net.on('desync', (tick) => {
          const snap = snapshots.get(tick);
          if (snap) net.send({ t: 'desyncReport', tick, snapshot: snap });
        }),
        net.on('end', (r) => (result = r)),
        net.on('paused', (p) => (serverPause = p.paused ? p.reason ?? 'Paused' : null)),
        net.on('notice', (text) => say(text)),
        net.on('start', (s) => {
          // Back after a reconnect: carry on from the server's state.
          if (s.gameId !== start!.gameId) return;
          if (s.snapshot) {
            match = restoreMatch(s.snapshot, statics);
            recording?.repair(s.snapshot);
          }
          if (!preparing) net.send({ t: 'loaded' });
        }),
      ];
      signal.addEventListener('abort', () => offs.forEach((off) => off()));
    }

    /** Online keys: launch and dock go to the server as commands; arrows and fire still pick a bay locally. */
    const onlineKeys = () => {
      for (const { kind } of taps.splice(0)) {
        if (me === null || match.players[me]!.state !== 'bunker') continue;
        if (selected[0] !== kind) {
          selected[0] = kind;
          sound.ui('click');
        } else net!.command({ launch: kind });
      }
      for (const code of pressed.splice(0)) {
        const c = controls[0]!;
        // A spectator, or a player whose base is out, picks who to watch.
        if (me === null || match.players[me]!.state === 'out') {
          if (watchKey(0, c, code)) sound.ui('click');
          continue;
        }
        const slot = c.launch.findIndex((codes) => codes.includes(code));
        if (slot >= 0) {
          selected[0] = LAUNCH_ORDER[slot]!;
          net!.command({ launch: LAUNCH_ORDER[slot]! });
        }
        if (c.dock.includes(code)) net!.command({ dock: true });
        if (match.players[me]!.state !== 'bunker') continue;
        if (c.fire.includes(code)) net!.command({ launch: selected[0]! });
        else if (moveSelection(0, code)) sound.ui('click');
      }
      if (me !== null) {
        const i = chat?.typing ? undefined : input(0);
        net!.input(i, packInput(i));
      }
    };

    const playFrame = () => {
      const f = net!.frames.shift()!;
      if (f.tick <= match.tick) return;
      const was = me !== null ? match.players[me]!.state : null;
      applyFrame(match, f);
      recording?.frame(match, f.inputs, f.commands);
      if (me !== null && was === 'bunker' && match.players[me]!.state === 'launching') sound.ui('raise');
      if (match.tick % HASH_EVERY === 0) {
        net!.hash(match.tick, hashMatch(match));
        snapshots.set(match.tick, snapshotMatch(match));
        snapshots.delete(match.tick - HASH_EVERY * KEEP_SNAPSHOTS);
      }
      afterTick();
    };

    /** Each player's flags, losses and vehicles left, for an offline match's results. */
    const board = (): ResultRow[] => match.players.map((p) => ({
      name: playerName(p.id), team: p.team, base: p.base, lost: lost[p.id] ?? 0, captures: captures[p.id] ?? 0,
      left: VEHICLE_KINDS.reduce((n, k) => n + Math.min(99, p.lives[k]), 0), you: p.id < players, bot: p.id >= players,
    }));
    // The match is over when a side has won, or drawn (every base out at once).
    const ended = (): Outcome | null => {
      const ms = match.tick * TICK_MS;
      // A replay stays at its last frame until it is left, so it can be wound back.
      if (replayer) {
        if (!replayer.ended) return null;
        const team = replay!.winner;
        const base = team === null ? null : match.players.find((p) => p.team === team)?.base ?? null;
        return { winner: base === null ? null : ((base & 1) as 0 | 1), winnerBase: base, ms, team };
      }
      if (online) {
        if (!result && match.winner === null && !match.draw) return null;
        const team = result ? result.winner : match.winner;
        const base = team === null ? null : match.players.find((p) => p.team === team)?.base ?? null;
        return { winner: base === null ? null : ((base & 1) as 0 | 1), winnerBase: base, ms, team, result: result ?? undefined };
      }
      if (match.winner !== null) {
        // The winning team's base: the first player's when they are on it, else its first.
        const team = match.winner;
        const side = match.players.filter((p) => p.team === team);
        const base = (side.find((p) => p.id === 0) ?? side[0])?.base ?? team;
        const won = base === 0 ? 0 : 1;
        return { winner: won, winnerBase: base, ms, team, solo: won === 0 ? recorder?.log() : undefined, board: board() };
      }
      if (match.draw) return { winner: null, winnerBase: null, ms, board: board() };
      return null;
    };
    let endedAt: number | null = null;

    let last = performance.now();
    let acc = 0;
    /** The modern view's quality preset in use, and what holds its frame rate. */
    let preset: Preset = activePreset(!!this.o.handheld);
    const pacer = new Pacer(!!this.o.handheld);

    /** Makes the modern renderer, once its code is here. */
    const makeModern = (mod: NonNullable<ReturnType<typeof modernLoaded>>) => {
      if (modern || signal.aborted) return;
      try {
        modern = new mod.ModernRenderer(assets);
        // Straight onto the page, with the HUD over it at the screen's own resolution.
        modern.direct = true;
        preset = activePreset(!!this.o.handheld);
        modern.setQuality(PRESETS[preset], PRESET_NAMES[preset]);
      } catch (err) {
        console.error('The modern view could not start:', err);
        giveUpModern();
      }
    };

    // ---- Getting ready, behind the loading screen ----

    /** Until everything is ready the loop draws nothing (the loading screen is up) and the match waits. */
    let preparing = true;
    /** Once the match's first picture is up (online: once the server has started it). */
    let isLive = false;
    /** A breath between pieces of getting ready, so the loading screen keeps moving. */
    const breath = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    /** The modern view: the 3D world, both screens, every model and the shaders for every look, made now. */
    const prepareModern = async (r: ModernRenderer) => {
      const rects = modernLayout(cameras.length);
      const night = nightNow();
      aimCameras();
      r.setNight(night);
      r.setLook(true, false);
      r.resolution(display.rect.w * (devicePixelRatio || 1), pacer.scale);
      const v = viewers();
      const field = (m: Match): ModernView[] => cameras.map((cam, i) => ({ cam, rect: rects[i]!, viewer: v[i]!, skip: false }));
      const screen = (sc: (p: Match['players'][number]) => ModernScreen): ModernView[] => cameras.map((cam, i) => {
        const pl = match.players[v[i]!]!;
        return { cam, rect: rects[i]!, viewer: v[i]!, skip: true, screen: sc(pl) };
      });
      const frames: { m: Match; views: readonly ModernView[]; thermal?: boolean }[] = [
        { m: match, views: field(match) },
        { m: match, views: screen((pl) => ({ kind: 'bunker', base: pl.base, lives: pl.lives, selected: 'tank', elevator: null, tick: match.tick })) },
        {
          m: match,
          views: screen((pl) => ({ kind: 'skull', look: skullLook(1), rival: rivalOf(match, pl.base), base: pl.base, lost: 'tank', left: pl.lives.tank, start: startLives[pl.id]!.tank })),
        },
      ];
      for (const m of showcase(match, replay?.map ?? start?.map ?? assets.map, assets.defs, assets.shore)) {
        frames.push({ m, views: field(m) });
        // The thermal camera is the night's: its look too.
        if (night) frames.push({ m, views: field(m), thermal: true });
      }
      // Last the match itself again, so the stand-ins are gone and the opening screens are in place.
      frames.push({ m: match, views: screen((pl) => ({ kind: 'bunker', base: pl.base, lives: pl.lives, selected: 'tank', elevator: null, tick: match.tick })) });
      await r.prepare(frames, breath);
    };
    const prepare = async () => {
      try {
        await Promise.all([sound.preload(), music.prepare()]).catch(() => {});
        this.o.onStep?.(AUDIO_STEP[0]);
        if (wanted() === 'modern' && modernAvailable() && !modernFailed()) {
          const mod = modernLoaded() ?? (await loadModern());
          if (mod) makeModern(mod);
          this.o.onStep?.(FEED_STEP[0]);
          if (modern && !signal.aborted) await prepareModern(modern);
        }
      } catch (err) {
        // Anything not made now is made when it is first needed, as before.
        console.error('Getting the match ready:', err);
      }
      this.o.onStep?.(SHADER_STEP[0]);
      preparing = false;
      // Online the server starts the match once every player has said so.
      if (net && !signal.aborted) net.send({ t: 'loaded' });
    };
    /** The match's first picture: the music starts with it. */
    const showLive = () => {
      isLive = true;
      music.startMatch(match, online || replay ? (me === null ? [] : [me]) : Array.from({ length: players }, (_, p) => p));
      this.goLive();
    };

    const loop = (now: number) => {
      if (preparing || (!isLive && net && match.tick === 0 && !net.frames.length)) {
        // Keys pressed while the loading screen is up are not the match's.
        pressed.length = 0;
        taps.length = 0;
        last = now;
        this.raf = requestAnimationFrame(loop);
        return;
      }
      if (!isLive) showLive();
      stats?.frame(now);
      // Keys changed from the menu (Options > Controls) take effect at once.
      if (keysVersion !== bindingsVersion()) {
        keysVersion = bindingsVersion();
        sides = activeControls();
        controls = pick();
        ours = playKeys();
        keys.clear();
      }
      // A handheld held upright, or out of full screen, shows the rotate or full screen notice instead, and the match waits.
      const upright = this.o.handheld && heldBack();
      // A modern match is drawn in the modern view from its first picture: once its code is here the renderer is made
      // at once, and until then the link-up screen shows (never the classic picture) and an offline match waits.
      if (wanted() === 'modern' && !modern && modernAvailable() && !modernFailed()) {
        const mod = modernLoaded();
        if (!mod) void loadModern();
        else makeModern(mod);
      }
      const linking = wanted() === 'modern' && !modern && modernAvailable() && !modernFailed();
      const rate = replayer ? (this.held ? 0 : speed) : 1;
      acc = (upright || linking) && !online ? 0 : Math.min(acc + (now - last) * rate, 250 * rate);
      last = now;
      const simFrom = performance.now();
      if (replayer) {
        replayKeys();
        roamFrame(now);
        if (seekTo !== null) {
          const until = performance.now() + SEEK_BUDGET_MS;
          quiet = true;
          while (replayer.frame < seekTo && performance.now() < until) replayer.step();
          match = replayer.match;
          if (replayer.frame >= seekTo) {
            seekTo = null;
            settle();
          }
          acc = 0;
        } else {
          while (acc >= TICK_MS && replayer.step()) {
            match = replayer.match;
            afterTick();
            acc -= TICK_MS;
          }
          if (replayer.ended) acc = 0;
        }
      } else if (net) {
        onlineKeys();
        // Play at the tick rate while BUFFER_FRAMES are in hand, faster when they pile up, and wait when they run out.
        while (acc >= TICK_MS && net.frames.length > (net.frames.length > CATCH_UP_FRAMES ? 0 : BUFFER_FRAMES - 1)) {
          playFrame();
          acc -= TICK_MS;
        }
        while (net.frames.length > CATCH_UP_FRAMES) playFrame();
        if (!net.frames.length) acc = Math.min(acc, TICK_MS);
      } else {
        while (acc >= TICK_MS) {
          tick();
          acc -= TICK_MS;
        }
      }
      stats?.add('sim', performance.now() - simFrom);
      if (linking) {
        linkUp ??= new OffscreenCanvas(MODERN_W, MODERN_H);
        drawLinkUp(linkUp.getContext('2d')! as unknown as CanvasRenderingContext2D, MODERN_W, MODERN_H, now, loadingState());
        display.present(linkUp, 1, true);
        this.raf = requestAnimationFrame(loop);
        return;
      }
      const useModern = wanted() === 'modern' && !!modern;
      frame.setClip(0, 0, SCREEN_W, SCREEN_H);
      frame.fill(0xff000000);
      const extras = effects.current(match.tick);
      const v = viewers();
      /** Modern: which views show the playfield in 3D (the rest show the bunker or skull from the retro frame). */
      const field: boolean[] = [];
      /** Modern: the bunker or skull screen each view shows, if any. */
      const screens: (ModernScreen | undefined)[] = [];
      cameras.forEach((cam, i) => {
        const pl = match.players[v[i]!]!;
        field[i] = false;
        screens[i] = undefined;
        // The free camera always shows the map, whatever its player is doing.
        if (cam.free) {
          if (useModern) field[i] = true;
          else drawView(frame, cam, match, assets, v[i]!, extras);
        } else if (pl.state === 'bunker' || (pl.state === 'launching' && pl.elevator)) {
          if (useModern) screens[i] = { kind: 'bunker', base: pl.base, lives: pl.lives, selected: selected[i] ?? 'tank', elevator: pl.elevator, tick: match.tick };
          else drawBunker(frame, cam.view, assets, pl.base, pl.lives, selected[i] ?? 'tank', pl.elevator, match.tick, pl.fade);
        } else if (pl.state === 'skull' && pl.death) {
          // The skull over the map while it fades out, then on black.
          const look = skullLook(match.tick - pl.death.start);
          if (useModern) {
            const kind = pl.death.kind;
            field[i] = look.map !== null;
            screens[i] = { kind: 'skull', look, rival: rivalOf(match, pl.base), base: pl.base, lost: kind, left: pl.lives[kind], start: startLives[v[i]!]![kind] };
          } else if (look.map !== null) {
            drawView(frame, cam, match, assets, v[i]!, extras);
            frame.dim(look.map / ONE);
          }
          if (!useModern) drawSkull(frame, cam.view, assets, pl, look, startLives[v[i]!]!, rivalOf(match, pl.base));
        } else if (useModern) {
          field[i] = true;
        } else {
          drawView(frame, cam, match, assets, v[i]!, extras);
          if (pl.fade < ONE) frame.dim(pl.fade / ONE);
        }
        if (shown && !useModern) drawNames(frame, cam, match, shown, v[i]!);
      });
      if (!useModern) drawHud(frame, match, assets, v, selected);
      const touch = !!this.o.handheld;
      if (touch) {
        const pl = me === null ? null : match.players[me]!;
        setTouchMode(touchModeFor(pl?.state ?? null, pl?.vehicle?.kind ?? null));
        const car = pl?.state === 'driving' ? pl.vehicle : null;
        setTouchVehicle(car ? { heading: car.heading, yaw: car.heli?.yaw ?? 0 } : null);
      }
      const outcome = ended();
      const lines = liveLog(log);
      const local = me === null ? null : seats();
      const notes = v.map((p, i) => (cameras[i]!.free ? 'Free camera' : (local?.[i] === p ? gateNote(match, p, useModern) : null) ?? viewNote(match, p, i, local, playerName)));
      // Behind the start gate the bunker shows the bay picked.
      v.forEach((p, i) => {
        const pick = local?.[i] === p ? match.gate?.picks[p] : null;
        if (pick) selected[i] = pick;
      });
      const result = outcome ? resultText(match, outcome, names, shown) : null;
      if (!useModern) {
        drawMessages(frame, cameras.map((c) => c.view), lines, notes, result);
        if (online) {
          drawChat(frame, net!.chat, chat!, cameras[0]!.view);
          if (serverPause && !outcome) drawText(frame, serverPause, (SCREEN_W - textWidth(serverPause)) >> 1, 40, 0xffffff60, 1);
          if (scoreboard || outcome) drawScoreboard(frame, match, start!, net!.seats, captures, outcome?.result ?? null);
        }
      }
      lowCtx.putImageData(image, 0, 0);
      display.sides = v.map((p) => match.players[p]!.base);
      if (useModern && modern) {
        const rects = modernLayout(cameras.length);
        // On a phone or tablet the HUD's text grows to stay readable at the size the picture is shown.
        setTouchHud(touch, display.rect.w ? display.rect.w / MODERN_W : 1);
        const night = nightNow();
        // The modern view is always the drone's feed; thermal is the player's to switch in the match.
        // The thermal camera is for the dark: by day there is none.
        const look = { drone: true, thermal: night && (this.o.thermal?.() ?? false) };
        modern.setNight(night);
        modern.setLook(look.drone, look.thermal);
        // The quality preset (Options > View > Quality, or Auto's), and the dynamic resolution holding the frame rate.
        pacer.frame(now);
        const want = activePreset(!!this.o.handheld);
        if (want !== preset) {
          preset = want;
          modern.setQuality(PRESETS[want], PRESET_NAMES[want]);
        }
        modern.resolution(display.rect.w * (devicePixelRatio || 1), pacer.scale);
        // How far on to the next tick this frame is: the lifts and gates are drawn between ticks.
        modern.part = Math.max(0, Math.min(1, acc / TICK_MS));
        modern.draw(match, cameras.map((cam, i) => ({ cam, rect: rects[i]!, viewer: v[i]!, skip: !field[i], screen: screens[i] })), extras);
        modernRects = rects;
        const hudFrom = performance.now();
        const g = display.presentModern(modern.glCanvas, MODERN_W, MODERN_H);
        g.imageSmoothingEnabled = false;
        if (cameras.length > 1) {
          g.fillStyle = '#10130f';
          g.fillRect(rects[0]!.w, 0, rects[1]!.x - rects[0]!.w, MODERN_H);
        }
        cameras.forEach((cam, i) => {
          const r = rects[i]!;
          const pl = match.players[v[i]!]!;
          const sc = screens[i];
          if (sc?.kind === 'bunker') {
            drawBunkerPanel(g, r, (rect, x, y, z) => modern!.bunkerPoint(rect, x, y, z), {
              lives: sc.lives, selected: sc.selected, elevator: sc.elevator, base: sc.base, touch, night, now: new Date(),
            });
            dimView(g, r, pl.fade);
          } else if (sc?.kind === 'skull') {
            dimView(g, r, sc.look.light);
          } else {
            if (look.drone) {
              const pose = cam.pose();
              const tile = (n: number) => String(Math.max(0, Math.floor(n / 32))).padStart(2, '0');
              drawFeed(g, r, {
                name: cam.free ? `UAV-${i + 1}  MANUAL` : `UAV-${i + 1}`,
                mode: look.thermal ? 'IR  WHT' : night ? 'EO  NIGHT' : 'EO  DAY',
                lines: [`ALT ${Math.round((FOCAL + pose.z) * 6)}FT`, 'HDG 000', `GRID ${tile(pose.x)}-${tile(pose.y)}`, `ZOOM ${(FOCAL / (FOCAL + pose.z) * 2).toFixed(1)}X`],
                now: new Date(),
              });
            }
            if (!cam.free) dimView(g, r, pl.fade);
            drawModernHud(g, match, r, v[i]!, (x, y, z) => modern!.project(cam, r, x, y, z));
          }
          if (notes[i]) drawNote(g, r, notes[i]!);
          if (!field[i] || sc) return;
          if (shown) {
            for (const p of match.players) {
              const o = p.vehicle;
              if (!o || (p.id === v[i] && !cam.free)) continue;
              const at = modern!.project(cam, r, o.x / 65536, o.y / 65536, Math.max(0, o.z / 65536) + 18);
              if (!at || at.x < r.x || at.x > r.x + r.w || at.y < r.y + 20 || at.y > r.y + r.h) continue;
              drawName(g, shown.seats[p.id]?.name ?? '', at.x, at.y, TEAMS[p.base]?.css ?? '#fff');
            }
          }
        });
        drawLog(g, lines, MODERN_W);
        if (online) {
          drawChatLines(g, rects[0]!, chatRuns(net!.chat, chat!));
          if (serverPause && !outcome) drawBanner(g, serverPause, MODERN_W, 150, 24);
          if (scoreboard || outcome) {
            const t = scoreRows(match, start!, net!.seats, captures, outcome?.result ?? null);
            drawScoreTable(g, MODERN_W, t.head, t.rows);
          }
        }
        if (result) drawBanner(g, result, MODERN_W, online ? 60 : 200);
        stats?.add('hud', performance.now() - hudFrom);
        if (outcome) {
          // The win sequence fades out from this picture (the modern win scene from the renderer's own canvas).
          const pc = this.picture.getContext('2d')!;
          pc.fillStyle = '#000';
          pc.fillRect(0, 0, SCREEN_W, SCREEN_H);
          display.modernPicture(pc, 0, (SCREEN_H - (SCREEN_W * MODERN_H) / MODERN_W) / 2, SCREEN_W, (SCREEN_W * MODERN_H) / MODERN_W);
          display.modernPicture(modern.canvas.getContext('2d')!, 0, 0, MODERN_W, MODERN_H);
        }
      } else {
        display.present(this.picture);
      }
      if (outcome && endedAt === null) {
        music.win();
        recording?.close();
      }
      if (outcome && replayer) endedAt ??= now;
      else if (outcome) {
        endedAt ??= now;
        // Online, wait a moment longer for the server's result if it has not come yet.
        if (now - endedAt >= END_HOLD_MS && (!online || outcome.result || now - endedAt >= END_HOLD_MS * 2)) {
          // The win scene draws on the renderer's own canvas again.
          if (modern) modern.direct = false;
          this.finale = { match, assets, modern: useModern && modern ? { renderer: modern, extras } : null };
          this.abort.abort();
          sound.reset();
          music.endMatch();
          handOverReplay(outcome.team ?? outcome.winnerBase);
          this.finish(outcome);
          return;
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.resume = () => {
      last = performance.now();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    void prepare();
    if (this.o.handheld) signal.addEventListener('abort', () => { setTouchMode(null); setTouchVehicle(null); });
    signal.addEventListener('abort', () => display.hideModern());
    if (replay) {
      const k = REPLAY_KEYS;
      say(`Replay: ${keyName(k.slower[0])} ${keyName(k.faster[0])} speed, ${keyName(k.back[0])} ${keyName(k.forward[0])} jump`);
      const pan = [k.panUp, k.panLeft, k.panDown, k.panRight].map((x) => keyName(x[0])).join('');
      say(this.o.handheld ? 'Free camera: drag to look round, pinch to zoom' : `Free camera: drag or ${pan}, wheel zooms, ${keyName(k.freeCamera[0])} on / off`);
      say('1-4 follow a player');
    } else if (this.o.handheld) {
      // The touch controls carry their own labels.
      say(me === null ? 'Watching: P1-P4 pick a player' : 'Tap a bay to pick it, tap it again to launch');
      if (me !== null) say('Point the stick the way to go');
      if (me !== null) say('Dock takes a vehicle back in on your base');
    } else if (online) {
      if (me === null) say(`Watching: ${keyName(sides.solo.left[0]!)} / ${keyName(sides.solo.right[0]!)} or 1-4 pick a player, Tab the scores`);
      else {
        say(`Drive keys pick a bay, ${keyName(sides.left.fire[0]!)} launches`);
        say(`${keyName(ONLINE_KEYS.chat)} to chat, ${keyName(ONLINE_KEYS.scoreboard)} the scores`);
      }
    } else if (players === 1) {
      say(`Drive keys pick a bay, ${keyName(sides.left.fire[0]!)} launches`);
      say(`${keyName(sides.left.turretLeft[0]!)}/${keyName(sides.left.turretRight[0]!)} swing the turret, ${keyName(sides.left.dock[0]!)} docks`);
    } else {
      say('Pick a bay and fire to launch');
      say(`${keyName(sides.left.dock[0]!)} or ${keyName(sides.right.dock[0]!)} docks`);
    }
  }
}

/** Draws the notes, the message log and the result into the frame in the pixel font, so they scale with it. */
/** The note at the top of a view: who it is watching, out, or carrying a flag. */
function viewNote(m: Match, p: number, i: number, seats: number[] | null, playerName: (id: number) => string): string | null {
  const pl = m.players[p]!;
  return seats === null || seats[i] !== p ? `Watching ${playerName(p)}` : pl.state === 'out' ? 'Out' : m.flags.some((f) => f.carrier === p) ? 'Get the flag home!' : null;
}

/**
 * Behind the start gate (two or more people playing): what a player's bunker says while the match waits for the
 * last of them to pick a vehicle, and the time left once someone has. The modern view words it as its feed does.
 */
function gateNote(m: Match, p: number, modern: boolean): string | null {
  const g = m.gate;
  if (!g || !g.players.includes(p) || m.players[p]?.state !== 'bunker') return null;
  const left = gateLeft(m);
  const secs = left === null ? null : Math.ceil((left * TICK_MS) / 1000);
  const pick = g.picks[p];
  const others = g.waiting.filter((id) => id !== p).length;
  if (modern) {
    const t = secs === null ? '' : `  //  T-${secs}S`;
    return pick ? `${LABEL[pick].toUpperCase()} LOCKED  //  AWAITING ${others} OPERATOR${others === 1 ? '' : 'S'}${t}` : `SELECT VEHICLE TO DEPLOY${t}`;
  }
  const t = secs === null ? '' : ` (${secs}s)`;
  return pick ? `${LABEL[pick]} ready: ${others} more${t}` : `Pick a vehicle${t}`;
}

/** The match messages still showing, the last three; the ones that have run out are dropped from the log. */
function liveLog(log: { text: string; until: number }[]): string[] {
  const now = performance.now();
  const live = log.filter((l) => l.until > now);
  log.splice(0, log.length, ...live);
  return live.slice(-3).map((l) => l.text);
}

/** Who won, for the end of the match. */
function resultText(m: Match, result: Outcome, names: readonly string[], start: MatchStart | undefined): string {
  if (start) {
    const team = result.team ?? null;
    const winners = start.seats.filter((s) => s.team === team).map((s) => s.name);
    return result.result?.aborted ? 'Game over' : team === null ? 'Draw' : winners.length === 1 ? `${winners[0]} wins` : `Team ${'ABCD'[team]} wins`;
  }
  if (result.winnerBase === null) return 'Draw';
  // Offline: the winning side by name, one base or a team of them.
  const side = m.players.filter((p) => p.team === result.team);
  const bases = side.length ? side.map((p) => p.base) : [result.winnerBase];
  return `${bases.map((b) => names[b] ?? `Base ${b + 1}`).join(' and ')} ${bases.length > 1 ? 'win' : 'wins'}`;
}

/** The retro view's notes, messages and result, in the pixel font. */
function drawMessages(frame: Frame, views: readonly { x: number; y: number; w: number; h: number }[], lines: readonly string[], notes: readonly (string | null)[], result: string | null): void {
  frame.setClip(0, 0, SCREEN_W, SCREEN_H);
  views.forEach((v, i) => {
    const note = notes[i];
    if (note) drawText(frame, note, v.x + 4, v.y + 4, 0xffffffff, 1, v.w - 8);
  });
  lines.forEach((text, i) => drawText(frame, text, 4, views[0]!.h - 6 - (lines.length - i) * LINE, 0xffffffff, 1, SCREEN_W - 8));
  if (result) drawText(frame, result, (SCREEN_W - textWidth(result, 2)) >> 1, 60, 0xffffffff, 2);
}

/** Which bay of the retro bunker screen a point is over: the quarter of the view round the shaft it falls in. */
function bayAt(view: { x: number; y: number; w: number; h: number }, x: number, y: number): VehicleKind | null {
  if (x < view.x || x >= view.x + view.w || y < view.y || y >= view.y + view.h) return null;
  const cx = view.x + view.w / 2;
  // The bays run from 40 to 136 px down the view, upper and lower rows split at 98, the shaft 13 px each side.
  const dy = y - view.y;
  if (dy < 40 || dy > 140 || Math.abs(x - cx) < 13 || Math.abs(x - cx) > 70) return null;
  const top = dy < 98;
  return x < cx ? (top ? 'heli' : 'asv') : top ? 'tank' : 'jeep';
}
