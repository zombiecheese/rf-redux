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
  HASH_EVERY, ONE, TICK_MS, botThink, buildWorld, createBot, createMatch, dock, hashMatch, launch, liftOf, restoreMatch, rivalOf, skullLook, startingLives,
  snapshotMatch, stepMatch,
  type Match, type MatchEvent, type Snapshot, type VehicleInput, type VehicleKind,
} from '@rfw/sim';
import {
  DOCK, ReplayPlayer, ReplayRecorder, SoloRecorder, applyFrame, commandCode, packInput,
  type MatchResult, type MatchStart, type Replay, type SoloLog,
} from '@rfw/net';
import type { GameAssets } from './assets.js';
import { BAYS, drawBunker } from './bunker.js';
import { Camera, layout } from './camera.js';
import { isPortrait, type Display } from './display.js';
import { setTouchMode, touchModeFor } from './touch.js';
import { Effects } from './effects.js';
import { LINE, drawText, textWidth } from './font.js';
import { drawHud } from './hud.js';
import { ONLINE_KEYS, REPLAY_KEYS, activeControls, bindingsVersion, keyName, playKeys, typingIn } from './keys.js';
import type { Net } from './online/net.js';
import { ChatInput, drawChat, drawNames, drawScoreboard } from './online/overlay.js';
import { Frame, SCREEN_H, SCREEN_W } from './raster.js';
import type { Music } from './music/music.js';
import type { Sound } from './sound.js';
import { drawSkull } from './skull.js';
import { drawView } from './view.js';
import { MODERN_H, MODERN_W, modernAvailable, modernLayout } from './modern/layout.js';
import type { ModernRenderer } from './modern/renderer.js';
import { drawModernHud, drawName } from './modern/hud.js';
import { TEAMS } from './paint.js';

/** Modern: the text frame's views end here, above the HUD, so the message log sits clear of it. */
const MODERN_TEXT_H = 172;
/** The modern renderer's module, fetched (with three.js) the first time the modern view is picked. */
let modernModule: Promise<typeof import('./modern/renderer.js')> | null = null;

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
}

/** What a replay's controls (main.ts) show and change. */
export interface ReplayControl {
  readonly frame: number;
  readonly frames: number;
  readonly speed: number;
  readonly watching: number;
  readonly outOfStep: boolean;
  setSpeed(speed: number): void;
  seek(frame: number): void;
  follow(player: number): void;
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
}

export class Game {
  /** The last picture drawn, for fading out into the win sequence. */
  readonly picture = new OffscreenCanvas(SCREEN_W, SCREEN_H);
  /** Settles with the outcome once the match is over and has been on screen a moment, or null when stopped. */
  readonly done: Promise<Outcome | null>;
  /** The match as it ended, for the win scene; null until then. */
  finale: { match: Match; assets: GameAssets } | null = null;
  private finish!: (o: Outcome | null) => void;
  private readonly abort = new AbortController();
  private raf = 0;
  private held = false;

  constructor(private readonly o: GameOptions) {
    this.done = new Promise((resolve) => (this.finish = resolve));
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

  /** Set while a replay plays: its position and speed, for the replay bar. */
  replayControl: ReplayControl | null = null;

  /** Pause/Resume (P): the match and its sounds wait, and the loop stops drawing so the pause screen can show. */
  pause(on: boolean): void {
    if (this.held === on || this.abort.signal.aborted) return;
    // An online match cannot wait for one player; the menus open over it while it plays on.
    if (this.o.online) return;
    this.held = on;
    this.o.sound.hold(on);
    this.o.music.hold(on);
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
    let match: Match = replayer
      ? replayer.match
      : start
      ? start.snapshot
        ? restoreMatch(start.snapshot, statics)
        : createMatch(world, start.map, start.seats.map((s) => ({ base: s.base, team: s.team })), start.seed, { difficulty: start.difficulty, handicap: start.handicap === true })
      : createMatch(world, assets.map, order.map((base, i) => ({ base, team: this.o.teams?.[i] ?? base })), this.o.seed, { difficulty: this.o.difficulty, handicap: this.o.handicap === true });

    /** Each player's vehicles at the start, for the skull's row of lives. */
    const handicap = (replay ? replay.handicap : start ? start.handicap : this.o.handicap) === true;
    const startSlots = match.players.map((p) => ({ base: p.base, team: p.team }));
    const startLives = match.players.map((p) => startingLives(replay?.map ?? start?.map ?? assets.map, startSlots, p.id, handicap));
    // Who each view follows: the local players, or online this browser's seat (a spectator picks with 1-4).
    let watched = start ? (start.you ?? 0) : 0;
    const me = start ? start.you : replay ? null : 0;
    // A player whose base is out watches a teammate still in the match.
    const follow = (p: number): number => {
      const pl = match.players[p]!;
      if (pl.state !== 'out') return p;
      return match.players.find((q) => q.team === pl.team && !match.eliminated[q.base] && q.state !== 'out')?.id ?? p;
    };
    const seats = (): number[] => (online || replay ? [watched] : Array.from({ length: players }, (_, p) => p));
    const viewers = (): number[] => (me === null ? seats() : seats().map(follow));
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
    music.startMatch(match, online || replay ? (me === null ? [] : [me]) : Array.from({ length: players }, (_, p) => p));

    // The replay of this match: how it started, then each frame as it is played.
    const recording = replay ? null : new ReplayRecorder({
      at: Date.now(), mode: online ? 'online' : players === 2 ? 'tournament' : 'training',
      mapId: start?.mapId ?? this.o.mapId ?? '', mapName: this.o.mapName ?? (start?.map ?? assets.map).name ?? 'Untitled',
      map: start?.map ?? assets.map, seed: start?.seed ?? this.o.seed, difficulty: start?.difficulty ?? this.o.difficulty, ...(handicap ? { handicap } : {}),
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
    const overlay = new Frame();
    const overlayImage = new ImageData(new Uint8ClampedArray(overlay.px.buffer), SCREEN_W, SCREEN_H);
    const overlayPicture = new OffscreenCanvas(SCREEN_W, SCREEN_H);
    signal.addEventListener('abort', () => modern?.dispose());

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
      if (this.held || chat?.typing || typingIn(e) || document.body.classList.contains('menu-open')) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
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

    /** Effects, sounds, messages and cameras after a tick, local or online. */
    const afterTick = () => {
      effects.add(match.events, match);
      if (modern && !quiet) modern.events(match.events, match);
      const scripted = effects.takeSounds();
      if (!quiet) {
        sound.events(match, match.events, !!assets.effects, viewers());
        sound.scripted(scripted);
      }
      sound.update(match, cameras.map((c) => ({ x: c.x, y: c.y })));
      music.tick(match, match.events);
      for (const e of match.events) {
        const text = describe(e);
        if (text) say(text);
        if (e.type === 'captured') captures[e.player] = (captures[e.player] ?? 0) + 1;
      }
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
      const doLaunch = (p: number, kind: VehicleKind) => {
        commands.push([p, commandCode({ launch: kind })]);
        return launch(match, p, kind);
      };
      const doDock = (p: number) => {
        commands.push([p, DOCK]);
        return dock(match, p);
      };
      for (const code of pressed.splice(0)) {
        for (let p = 0; p < players; p++) {
          const c = controls[p]!;
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
            sound.ui(doLaunch(p, selected[p]!) ? 'raise' : 'click');
          } else if (moveSelection(p, code)) sound.ui('click');
        }
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
        },
      };
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
          net.send({ t: 'loaded' });
        }),
      ];
      signal.addEventListener('abort', () => offs.forEach((off) => off()));
      net.send({ t: 'loaded' });
    }

    /** Online keys: launch and dock go to the server as commands; arrows and fire still pick a bay locally. */
    const onlineKeys = () => {
      for (const code of pressed.splice(0)) {
        if (me === null) {
          const n = (ONLINE_KEYS.follow as readonly string[]).indexOf(code);
          if (n >= 0 && n < match.players.length) watched = n;
          continue;
        }
        const c = controls[0]!;
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
        return { winner: won, winnerBase: base, ms, team, solo: won === 0 ? recorder?.log() : undefined };
      }
      if (match.draw) return { winner: null, winnerBase: null, ms };
      return null;
    };
    let endedAt: number | null = null;

    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      // Keys changed from the menu (Options > Controls) take effect at once.
      if (keysVersion !== bindingsVersion()) {
        keysVersion = bindingsVersion();
        sides = activeControls();
        controls = pick();
        ours = playKeys();
        keys.clear();
      }
      // A handheld held upright shows the rotate notice instead, and the match waits.
      const upright = this.o.handheld && isPortrait();
      const rate = replayer ? speed : 1;
      acc = upright && !online ? 0 : Math.min(acc + (now - last) * rate, 250 * rate);
      last = now;
      if (replayer) {
        replayKeys();
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
      // The modern view draws once its code has loaded (and only where there is WebGL); until then, retro.
      if (this.o.visuals?.() === 'modern' && !modern && modernAvailable()) {
        modernModule ??= import('./modern/renderer.js');
        void modernModule.then((mod) => {
          if (!modern && !signal.aborted) modern = new mod.ModernRenderer(assets);
        });
      }
      const useModern = this.o.visuals?.() === 'modern' && !!modern;
      frame.setClip(0, 0, SCREEN_W, SCREEN_H);
      frame.fill(0xff000000);
      const extras = effects.current(match.tick);
      const v = viewers();
      /** Modern: which views show the playfield in 3D (the rest show the bunker or skull from the retro frame). */
      const field: boolean[] = [];
      cameras.forEach((cam, i) => {
        const pl = match.players[v[i]!]!;
        field[i] = false;
        // The bunker until the elevator has gone up and the screen faded out, then the map fading in round the lift.
        if (pl.state === 'bunker' || (pl.state === 'launching' && pl.elevator)) {
          drawBunker(frame, cam.view, assets, pl.base, pl.lives, selected[i] ?? 'tank', pl.elevator, match.tick, pl.fade);
        } else if (pl.state === 'skull' && pl.death) {
          // The skull over the map while it fades out, then on black.
          const look = skullLook(match.tick - pl.death.start);
          if (look.map !== null) {
            drawView(frame, cam, match, assets, v[i]!, extras);
            frame.dim(look.map / ONE);
          }
          drawSkull(frame, cam.view, assets, pl, look, startLives[v[i]!]!, rivalOf(match, pl.base));
        } else if (useModern) {
          field[i] = true;
        } else {
          drawView(frame, cam, match, assets, v[i]!, extras);
          if (pl.fade < ONE) frame.dim(pl.fade / ONE);
        }
        if (shown && !useModern) drawNames(frame, cam, match, shown, v[i]!);
      });
      drawHud(frame, match, assets, v, selected);
      if (this.o.handheld) {
        const pl = me === null ? null : match.players[me]!;
        setTouchMode(touchModeFor(pl?.state ?? null, pl?.vehicle?.kind ?? null));
      }
      const outcome = ended();
      // Modern: the notes, log, chat and scores go into a frame of their own, laid over the 3D picture.
      const text = useModern ? overlay : frame;
      if (useModern) {
        overlay.setClip(0, 0, SCREEN_W, SCREEN_H);
        overlay.fill(0);
      }
      const textViews = cameras.map((c, i) => (field[i] ? { ...c.view, h: MODERN_TEXT_H } : c.view));
      drawMessages(text, match, v, textViews, log, outcome, names, shown, me === null ? null : seats(), playerName);
      if (online) {
        drawChat(text, net!.chat, chat!, textViews[0]!);
        if (serverPause && !outcome) drawText(text, serverPause, (SCREEN_W - textWidth(serverPause)) >> 1, 40, 0xffffff60, 1);
        if (scoreboard || outcome) drawScoreboard(text, match, start!, net!.seats, captures, outcome?.result ?? null);
      }
      lowCtx.putImageData(image, 0, 0);
      display.sides = v.map((p) => match.players[p]!.base);
      if (useModern && modern) {
        const rects = modernLayout(cameras.length);
        modern.draw(match, cameras.map((cam, i) => ({ cam, rect: rects[i]!, viewer: v[i]!, skip: !field[i] })), extras);
        const g = modern.canvas.getContext('2d')!;
        g.imageSmoothingEnabled = false;
        if (cameras.length > 1) {
          g.fillStyle = '#10130f';
          g.fillRect(rects[0]!.w, 0, rects[1]!.x - rects[0]!.w, MODERN_H);
        }
        cameras.forEach((cam, i) => {
          const r = rects[i]!;
          const pl = match.players[v[i]!]!;
          if (!field[i]) {
            // The bunker or skull, with its console, as pixel art: the whole frame, or this half of it.
            const sx = cameras.length > 1 ? (i ? SCREEN_W / 2 : 0) : 0;
            const sw = cameras.length > 1 ? SCREEN_W / 2 : SCREEN_W;
            const k = Math.floor(Math.min(r.w / sw, r.h / SCREEN_H) * 4) / 4;
            g.fillStyle = '#000';
            g.fillRect(r.x, r.y, r.w, r.h);
            g.drawImage(this.picture, sx, 0, sw, SCREEN_H, r.x + (r.w - sw * k) / 2, r.y + (r.h - SCREEN_H * k) / 2, sw * k, SCREEN_H * k);
            return;
          }
          if (pl.fade < ONE) {
            g.fillStyle = `rgba(0,0,0,${1 - pl.fade / ONE})`;
            g.fillRect(r.x, r.y, r.w, r.h);
          }
          drawModernHud(g, match, r, v[i]!);
          if (shown) {
            for (const p of match.players) {
              const o = p.vehicle;
              if (!o || p.id === v[i]) continue;
              const at = modern!.project(cam, r, o.x / 65536, o.y / 65536, Math.max(0, o.z / 65536) + 18);
              if (!at || at.x < r.x || at.x > r.x + r.w || at.y < r.y + 20 || at.y > r.y + r.h) continue;
              drawName(g, shown.seats[p.id]?.name ?? '', at.x, at.y, TEAMS[p.base]?.css ?? '#fff');
            }
          }
        });
        overlayPicture.getContext('2d')!.putImageData(overlayImage, 0, 0);
        const k = MODERN_H / SCREEN_H;
        g.drawImage(overlayPicture, (MODERN_W - SCREEN_W * k) / 2, 0, SCREEN_W * k, MODERN_H);
        display.present(modern.canvas, 1, true);
        if (outcome) {
          // The win sequence fades out from this picture.
          const pc = this.picture.getContext('2d')!;
          pc.fillStyle = '#000';
          pc.fillRect(0, 0, SCREEN_W, SCREEN_H);
          pc.drawImage(modern.canvas, 0, (SCREEN_H - (SCREEN_W * MODERN_H) / MODERN_W) / 2, SCREEN_W, (SCREEN_W * MODERN_H) / MODERN_W);
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
          this.abort.abort();
          sound.reset();
          music.endMatch();
          handOverReplay(outcome.team ?? outcome.winnerBase);
          this.finale = { match, assets };
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
    if (this.o.handheld) signal.addEventListener('abort', () => setTouchMode(null));
    if (replay) {
      const k = REPLAY_KEYS;
      say(`Replay: ${keyName(k.slower[0])} ${keyName(k.faster[0])} speed, ${keyName(k.back[0])} ${keyName(k.forward[0])} jump`);
      say('1-4 follow a player');
    } else if (this.o.handheld) {
      // The touch controls carry their own labels.
      say(me === null ? 'Watching: P1-P4 pick a player' : 'Stick picks a bay, Launch sends it up');
      if (me !== null) say('Dock takes a vehicle back in on your base');
    } else if (online) {
      if (me === null) say('Watching: 1-4 pick a player, Tab the scores');
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
function drawMessages(
  frame: Frame, m: Match, viewers: number[], views: { x: number; y: number; w: number; h: number }[], log: { text: string; until: number }[],
  result: Outcome | null, names: readonly string[], start: MatchStart | undefined, seats: number[] | null, playerName: (id: number) => string,
): void {
  frame.setClip(0, 0, SCREEN_W, SCREEN_H);
  views.forEach((v, i) => {
    const p = viewers[i]!;
    const pl = m.players[p]!;
    const note = seats === null || seats[i] !== p ? `Watching ${playerName(p)}` : pl.state === 'out' ? 'Out' : m.flags.some((f) => f.carrier === p) ? 'Get the flag home!' : null;
    if (note) drawText(frame, note, v.x + 4, v.y + 4, 0xffffffff, 1, v.w - 8);
  });
  const now = performance.now();
  const live = log.filter((l) => l.until > now);
  log.splice(0, log.length, ...live);
  const shown = live.slice(-3);
  shown.forEach((l, i) => drawText(frame, l.text, 4, views[0]!.h - 6 - (shown.length - i) * LINE, 0xffffffff, 1, SCREEN_W - 8));
  if (result) {
    let text: string;
    if (start) {
      const team = result.team ?? null;
      const winners = start.seats.filter((s) => s.team === team).map((s) => s.name);
      text = result.result?.aborted ? 'Game over' : team === null ? 'Draw' : winners.length === 1 ? `${winners[0]} wins` : `Team ${'ABCD'[team]} wins`;
    } else if (result.winnerBase === null) text = 'Draw';
    else {
      // Offline: the winning side by name, one base or a team of them.
      const side = m.players.filter((p) => p.team === result.team);
      const bases = side.length ? side.map((p) => p.base) : [result.winnerBase];
      text = `${bases.map((b) => names[b] ?? `Base ${b + 1}`).join(' and ')} ${bases.length > 1 ? 'win' : 'wins'}`;
    }
    drawText(frame, text, (SCREEN_W - textWidth(text, 2)) >> 1, 60, 0xffffffff, 2);
  }
}
