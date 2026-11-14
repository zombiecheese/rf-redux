// The app around the game: the Zombiecheese Productions splash (in place of the original's logos and intro movie),
// then in the original's order the title screen, the Player and Level Selectors, the match, and the win scene. The original's Windows 95 menu bar is now an on-screen menu
// (menu.ts) over the title art (the remake's own widescreen picture of all four sides), which opens with the title
// screen, and M or the menu button brings it up over a match. The shortcuts are letters, not the original's function
// keys (keys.ts lists them).
//
// Dev shortcuts: ?mode=solo or ?mode=local2 starts a match at once on ?map= (with ?bots=0, ?seed=, ?difficulty=, ?teams=2,2, ?handicap=1, ?together=1),
// ?scale=integer picks whole-number scaling, and ?visuals=modern or ?visuals=retro picks the picture.

import { checkMap, clampDifficulty } from '@rfw/sim';
import type { MatchStart, Replay } from '@rfw/net';
import { loadAssets, loadAssetsWith, loadCommon, loadMap, loadMapIndex, type GameAssets, type MapEntry } from './assets.js';
import {
  about, confirmExit, dialog, dialogOpen, el, hallOfFame, helpTopics, levelSelector, modernUi, notice, playerSelector, systemInfo, teamSelector, teamsFor,
} from './dialogs.js';
import { Display, blockWhileUpright, isHandheld, lockLandscape, untilLandscape } from './display.js';
import { listDrafts, loadDraft } from './editor/storage.js';
import { Game, type Outcome } from './game.js';
import { ReplayBar, replaysDialog, saveReplay } from './replays.js';
import { openAdmin } from './admin/panel.js';
import { api, serverAvailable } from './online/api.js';
import { addInvite, friendsDialog } from './online/friends.js';
import { net } from './online/net.js';
import {
  LobbyWindow, browse, createLobby, enterCode, errorText, leaderboards, lobbyMaps, profile, results, signIn, signOut, signUp, toast,
} from './online/ui.js';
import { setBindings, shortcutFor, shortcutName, typingIn, type ShortcutId } from './keys.js';
import { Logo } from './logo.js';
import { Menu, type MenuEntry } from './menu.js';
import { formatTime, loadScores, recordGame, saveScores } from './scores.js';
import { controlsDialog, soundDialog } from './options.js';
import { gainOf, loadSettings, saveSettings, type Settings, type Volume } from './settings.js';
import { jukebox } from './music/jukebox.js';
import { Music } from './music/music.js';
import { Sound } from './sound.js';
import { SPLASH_H, SPLASH_MS, SPLASH_W, SplashArt } from './splash.js';
import { SCREEN_H, SCREEN_W } from './raster.js';
import { Stage } from './stage.js';
import { winScene, winTier } from './winscene.js';
import { addTouchControls } from './touch.js';
import './ui.css';

modernUi();

const params = new URLSearchParams(location.search);
const handheld = isHandheld();
if (handheld) document.body.classList.add('handheld');

let settings = loadSettings();
if (params.get('difficulty') !== null) settings.difficulty = clampDifficulty(Number(params.get('difficulty')));
if (params.get('visuals') === 'modern' || params.get('visuals') === 'retro') settings.visuals = params.get('visuals') as Settings['visuals'];
if (params.get('scale') === 'integer' || params.get('scale') === 'sharp') settings.scale = params.get('scale') as Settings['scale'];
if (handheld) settings.players = 1;

const display = new Display(settings.scale, settings.crt);
const stage = new Stage(display);
const sound = new Sound();
const music = new Music(settings.music);
setBindings(settings.keys);
applyVolume(settings.volume);

/** Options > Visuals, read by a running match every frame so it can change mid-game. */
const visuals = (): Settings['visuals'] => settings.visuals;

/** Options > Sound: the master volume scales both the effects and the music. */
function applyVolume(v: Volume): void {
  const master = v.muted ? 0 : gainOf(v.master);
  sound.setVolume(master * gainOf(v.effects));
  music.setVolume(master * gainOf(v.music));
}
/** Browsers start sound only from a key press or tap. */
const unlockAudio = () => void Promise.all([sound.unlock(), music.unlock()]);
// Every key press and tap, not only the first: a browser can leave the audio suspended (one started from Esc, or from
// a tap's pointerdown, is not allowed to play) until a later one starts it again.
for (const type of ['keydown', 'pointerdown', 'pointerup'] as const) addEventListener(type, unlockAudio, { capture: true, passive: true });
let maps: MapEntry[] = [];

type Screen = 'start' | 'gate' | 'splash' | 'title' | 'loading' | 'game' | 'win';
let screen: Screen = 'start';
let game: Game | null = null;
/** Ends the splash, or the win scene, that is showing. */
let skip = new AbortController();
/** Bumped by every new match, so a superseded one's ending is ignored. */
let run = 0;

function setScreen(s: Screen): void {
  screen = s;
  document.body.dataset.screen = s;
  if (s !== 'title' && s !== 'game') closeMenu();
  syncPlaying();
}

/** body.playing: a match is running and not paused, which shows the touch controls. */
function syncPlaying(): void {
  document.body.classList.toggle('playing', screen === 'game' && !!game && !game.paused);
  document.body.classList.toggle('online-game', !!game?.online);
  document.body.classList.toggle('replay', !!game?.replayControl);
}

function save(next: Settings): void {
  settings = next;
  saveSettings(settings);
  display.mode = settings.scale;
  display.crt = settings.crt;
  setBindings(settings.keys);
  applyVolume(settings.volume);
  syncProfile();
}

// ---- Profile (profiles card) ---------------------------------------------------------------------------------

/** The settings an account keeps on the server, so they follow the player to another browser. */
const PROFILE_KEYS = ['names', 'difficulty', 'level', 'mapId', 'swapSides', 'scale', 'crt', 'visuals', 'volume', 'keys', 'music'] as const;
let profileTimer = 0;

function signedIn(): boolean {
  return !!net.you && !net.you.guest;
}

function syncProfile(): void {
  if (!signedIn()) return;
  clearTimeout(profileTimer);
  profileTimer = window.setTimeout(() => {
    const out = Object.fromEntries(PROFILE_KEYS.map((k) => [k, settings[k]]));
    void api('/api/profile', { settings: out }, 'PUT').catch(() => {});
  }, 1000);
}

async function loadProfile(): Promise<void> {
  const p = await api<{ settings: Partial<Settings> }>('/api/profile').catch(() => null);
  if (!p) return;
  const merged = { ...settings };
  for (const k of PROFILE_KEYS) if (p.settings[k] !== undefined) (merged as Record<string, unknown>)[k] = p.settings[k];
  merged.difficulty = clampDifficulty(merged.difficulty);
  if (handheld) merged.players = 1;
  settings = merged;
  saveSettings(settings);
  settings = loadSettings();
  display.mode = settings.scale;
  display.crt = settings.crt;
  setBindings(settings.keys);
  applyVolume(settings.volume);
  music.setEnabled(settings.music);
}

// ---- Splash and title --------------------------------------------------------------------------------------------

/**
 * The Zombiecheese Productions splash with its fanfare. Browsers play sound only after a key press or tap, so when
 * the fanfare could not play yet the splash waits for one behind "press any key or tap" (with the music off it
 * starts at once, silent). Any key or tap skips the splash; Esc at the prompt goes straight to the title.
 */
async function splash(): Promise<void> {
  const art = new SplashArt();
  // Held upright, the start prompt and the splash wait behind the rotate notice until the device is turned.
  if (handheld) await untilLandscape();
  if (settings.music && !(await music.canPlay())) {
    setScreen('gate');
    skip = new AbortController();
    await stage.animation(SPLASH_W, SPLASH_H, art.drawPrompt, Infinity, 300, 0, skip.signal);
    if (screen !== 'gate') return;
  }
  setScreen('splash');
  skip = new AbortController();
  const fanfare = music.fanfare();
  await stage.animation(SPLASH_W, SPLASH_H, art.draw, Math.max(SPLASH_MS, fanfare + 500), 250, 700, skip.signal);
  music.stopFanfare();
  if (screen === 'splash') await title();
}


async function title(): Promise<void> {
  setScreen('title');
  music.menus();
  if (menuShown && !lobbyWin?.visible) openMenu();
  const img = await stage.titleArt();
  if (screen === 'title') stage.show(img);
}

// ---- Starting and ending a match ---------------------------------------------------------------------------------

/**
 * New Game (N): the Player Selector, then the Level Selector, then the match. Play > Training and Play > Two Players
 * fix the number of players; New Game offers both and starts on Training, so one player always gets the single view.
 */
async function newGame(players?: 1 | 2): Promise<void> {
  if (game?.online) {
    if (!(await confirmLeaveOnline())) return;
    net.send({ t: 'quitGame' });
    await leave();
  }
  const wasPaused = holdGame();
  const picked = await playerSelector({ ...settings, players: handheld ? 1 : players ?? 1 }, handheld, players !== undefined);
  if (!picked) return releaseGame(wasPaused);
  save(picked);
  if (!maps.length) maps = await loadMapIndex();
  const level = await levelSelector(settings, maps, addOns(), (id) => (id.startsWith(DRAFT) ? Promise.resolve(loadDraft(id.slice(DRAFT.length))) : loadMap(id)));
  if (!level) return releaseGame(wasPaused);
  save({ ...settings, ...level });
  await startGame({ ask: true });
}

async function startGame(opts: { bots?: boolean; seed?: number; ask?: boolean } = {}): Promise<void> {
  skip.abort();
  game?.stop();
  game = null;
  replayBar?.close();
  replayBar = null;
  const mine = ++run;
  setScreen('loading');
  stage.blank();
  const status = document.getElementById('status')!;
  status.textContent = 'Loading…';
  // A map that is not in this asset pack (the default with the placeholder pack, say) gives way to the first that is.
  if (!settings.mapId.startsWith(DRAFT) && maps.length && ![...maps, ...addOns()].some((m) => m.id === settings.mapId)) settings = { ...settings, mapId: maps[0]!.id };
  try {
    const assets = settings.mapId.startsWith(DRAFT) ? await draftAssets(settings.mapId.slice(DRAFT.length)) : await loadAssets(settings.mapId);
    status.textContent = '';
    if (mine !== run) return;
    const entry = [...maps, ...addOns()].find((m) => m.id === settings.mapId);
    // A map with three or four bases asks for the teams first; a restart keeps the last answer.
    const bases = assets.map.bases.length;
    if (opts.ask && bases > 2) {
      const choice = await teamSelector(settings.teams, bases, settings.players);
      if (mine !== run) return;
      if (!choice) return void (await title());
      save({ ...settings, teams: choice });
    }
    const teams = bases > 2 ? teamsFor(settings.teams, bases, settings.players) : undefined;
    game = new Game({
      assets, display, sound, music, seed: opts.seed ?? ((Date.now() % 0x7fffffff) | 0 || 1), players: settings.players,
      difficulty: settings.difficulty, names: settings.names, swapSides: settings.swapSides, bots: opts.bots ?? (settings.players === 1 || settings.teams.bots), handheld,
      teams, handicap: teams !== undefined && settings.teams.handicap,
      mapId: settings.mapId, mapName: entry?.name ?? assets.map.name, onReplay: (r) => void saveReplay(r), visuals,
    });
    setScreen('game');
    const { picture } = game;
    const played = game;
    const outcome = await game.done;
    if (mine !== run || !outcome) return;
    game = null;
    record(outcome, entry);
    if (outcome.solo && signedIn()) {
      void api<{ ms: number; best: boolean }>('/api/solo', outcome.solo)
        .then((r) => toast(r.best ? `New best time on the leaderboard: ${formatTime(r.ms)}` : `Time ${formatTime(r.ms)} (not your best)`))
        .catch((err: unknown) => toast(`Leaderboard: ${errorText(err)}`));
    }
    await victory(outcome, entry?.level ?? settings.level, picture, played.finale);
    if (mine === run) await title();
  } catch (err) {
    if (mine !== run) return;
    await notice('Return Fire: Redux', err instanceof Error ? err.message : String(err));
    await title();
  } finally {
    status.textContent = '';
  }
}

/** The bar of controls over a playing replay. */
let replayBar: ReplayBar | null = null;

/** Replays: pick one, then watch it until Esc or the bar's close button. */
async function showReplays(): Promise<void> {
  const r = await replaysDialog(signedIn());
  if (r) await watchReplay(r);
}

async function watchReplay(r: Replay): Promise<void> {
  skip.abort();
  game?.stop();
  game = null;
  replayBar?.close();
  replayBar = null;
  const mine = ++run;
  setScreen('loading');
  stage.blank();
  const status = document.getElementById('status')!;
  status.textContent = 'Loading…';
  try {
    const assets = await loadAssetsWith(r.map);
    status.textContent = '';
    if (mine !== run) return;
    const g = new Game({
      assets, display, sound, music, seed: r.seed, players: 1, difficulty: r.difficulty, names: [], swapSides: false, bots: false, handheld,
      replay: r, visuals,
    });
    game = g;
    replayBar = new ReplayBar(g.replayControl!, r, () => g.paused, () => void togglePause(), () => void leave());
    setScreen('game');
    await g.done;
  } catch (err) {
    if (mine !== run) return;
    await notice('Replay', err instanceof Error ? err.message : String(err));
    await title();
  } finally {
    status.textContent = '';
  }
}

/** Maps from the level editor are listed as draft:<id>. */
const DRAFT = 'draft:';

/** The level editor's drafts in this browser that two sides can play: the Level Selector's Add-Ons. */
function addOns(): MapEntry[] {
  return listDrafts().filter((d) => d.bases >= 2).map((d) => ({ id: DRAFT + d.id, name: d.name, level: 0, players: { min: 1, max: d.bases } }));
}

async function draftAssets(id: string): Promise<GameAssets> {
  const map = loadDraft(id);
  if (!map) throw new Error('That map is no longer in this browser.');
  const data = await loadCommon();
  const errors = checkMap(map, data.defs, data.shore).filter((p) => p.level === 'error');
  if (errors.length) throw new Error(`"${map.name}" can't be played yet: ${errors[0]!.message} Fix it in the level editor.`);
  return { ...data, map };
}

function record(o: Outcome, entry: MapEntry | undefined): void {
  const table = loadScores();
  recordGame(table, {
    mode: settings.players === 1 ? 'training' : 'tournament', mapId: settings.mapId, level: entry?.level ?? settings.level,
    mapName: entry?.name ?? settings.mapId, winner: o.winner, names: settings.names, ms: o.ms,
  });
  saveScores(table);
}

/**
 * The win sequence (sub_4306b0 and the end of the game loop): the last frame fades out over a second, then the
 * level's win scene plays over the winner's base (winscene.ts, in place of the original's movies) while the Win
 * piece carries on. A draw has no scene.
 */
async function victory(o: Outcome, level: number, last: OffscreenCanvas, finale: Game['finale']): Promise<void> {
  setScreen('win');
  skip = new AbortController();
  await stage.fadeOut(last, 1000, skip.signal);
  const base = o.winnerBase ?? o.winner;
  if (base === null || !finale) return;
  const scene = winScene(finale.match, finale.assets, base, winTier(level));
  await stage.animation(SCREEN_W, SCREEN_H, scene.draw, scene.ms, 500, 800, skip.signal);
}

/** Leaves the match for the title screen. */
async function leave(): Promise<void> {
  run++;
  game?.stop();
  game = null;
  onlineGame = null;
  replayBar?.close();
  replayBar = null;
  await title();
}

// ---- Pause and the dialogs over a match --------------------------------------------------------------------------

/** Pause/Resume (P): the army ad the original showed full screen (PS240/PS480, sub_421430). */
async function togglePause(): Promise<void> {
  if (!game) return;
  // An online match is shared, so no player can pause it (only an admin, or the server while a friend reconnects).
  if (game.online) return void toast('Online matches cannot be paused');
  // A paused replay keeps its picture, to look at.
  if (game.replayControl) {
    game.pause(!game.paused);
    return syncPlaying();
  }
  if (game.paused) {
    stage.release();
    game.pause(false);
    syncPlaying();
    return;
  }
  game.pause(true);
  syncPlaying();
  const img = await stage.pick('ps240', 'ps480');
  if (game?.paused) stage.show(img);
}

/** Holds the match while a dialog is up; returns whether it was already paused. */
function holdGame(): boolean {
  if (!game) return false;
  const was = game.paused;
  game.pause(true);
  syncPlaying();
  return was;
}

function releaseGame(wasPaused: boolean): void {
  if (game && !wasPaused) {
    stage.release();
    game.pause(false);
    syncPlaying();
  }
}

async function overGame(open: () => Promise<unknown>): Promise<void> {
  const was = holdGame();
  await open();
  releaseGame(was);
}

async function exit(): Promise<void> {
  if (!game) return;
  if (game.online) {
    if (!(await confirmLeaveOnline())) return;
    net.send({ t: 'quitGame' });
    await leave();
    showLobby();
    return;
  }
  if (game.replayControl) return leave();
  const was = holdGame();
  if (await confirmExit()) await leave();
  else releaseGame(was);
}

async function confirmLeaveOnline(): Promise<boolean> {
  const playing = game?.online && onlineSeat !== null;
  return (await dialogAsk(playing ? 'Leave this game? The computer will play your seat.' : 'Stop watching this game?'));
}

async function restart(): Promise<void> {
  if (game?.online) return;
  if (game?.replayControl) return game.replayControl.seek(0);
  if (screen === 'game' || screen === 'win' || screen === 'loading') await startGame();
}

// ---- Online ----------------------------------------------------------------------------------------------------

let onlineReady = false;
let lobbyWin: LobbyWindow | null = null;
let onlineGame: string | null = null;
let onlineSeat: number | null = null;

function lobbyWindow(): LobbyWindow | null {
  if (!onlineReady) return null;
  lobbyWin ??= new LobbyWindow(net, () => void title(), () => {
    lobbyWin?.show(false);
    openMenu();
  });
  return lobbyWin;
}

/** Puts the lobby up (when the player is in one), in place of the title menu. */
function showLobby(on = true): void {
  const w = lobbyWindow();
  w?.show(on);
  if (w?.visible) closeMenu();
  else if (screen === 'title' && menuShown && !game) openMenu();
}

async function dialogAsk(text: string): Promise<boolean> {
  return (await dialog('Return Fire: Redux Online', el('p', {}, text), [['Yes', 'yes'], ['No', 'cancel']])) === 'yes';
}

/** Runs an online action: needs the game server, and stops a local match first. */
async function online(fn: () => unknown, account = true): Promise<void> {
  if (!onlineReady) {
    await notice('Return Fire: Redux Online', 'Online play needs the game server (npm start, or the Docker stack). The Vite dev server alone has no server.');
    return;
  }
  if (game && !game.online) await leave();
  if (!net.connected) net.connect();
  if (account && !(await needAccount())) return;
  await fn();
}

/** Online play needs an account: asks the player to sign in or sign up, then waits until the connection knows them. */
async function needAccount(): Promise<boolean> {
  if (signedIn()) return true;
  const r = await dialog('Return Fire: Redux Online', el('p', {}, 'Online play needs an account. Sign in, or create one: it only takes a name, an email and a password.'),
    [['Sign In', 'signin'], ['Create an Account', 'signup'], ['Cancel', 'cancel']]);
  const user = r === 'signin' ? await signIn() : r === 'signup' ? await signUp() : null;
  if (!user) return false;
  const welcomed = new Promise<boolean>((resolve) => {
    const off = net.on('welcome', (you) => (off(), clearTimeout(timer), resolve(!you.guest)));
    const timer = setTimeout(() => (off(), resolve(false)), 10000);
  });
  reconnect();
  return welcomed;
}

/** A match from the server: load its map and play it. */
async function startOnline(s: MatchStart): Promise<void> {
  // A reconnect sends the running match again; the game already carries on from it.
  if (game?.online && onlineGame === s.gameId) return;
  skip.abort();
  game?.stop();
  game = null;
  replayBar?.close();
  replayBar = null;
  const mine = ++run;
  onlineGame = s.gameId;
  onlineSeat = s.you;
  lobbyWin?.show(false);
  setScreen('loading');
  stage.blank();
  const status = document.getElementById('status')!;
  status.textContent = 'Loading…';
  try {
    const assets = await loadAssetsWith(s.map);
    status.textContent = '';
    if (mine !== run) return;
    game = new Game({
      assets, display, sound, music, seed: s.seed, players: 1, difficulty: s.difficulty, names: settings.names, swapSides: false, bots: false, handheld,
      online: { start: s, net }, mapName: s.map.name, onReplay: (r) => void saveReplay(r), visuals,
    });
    setScreen('game');
    const { picture } = game;
    const played = game;
    const outcome = await game.done;
    if (mine !== run || !outcome) return;
    game = null;
    onlineGame = null;
    if (outcome.winner !== null && !outcome.result?.aborted) await victory(outcome, maps.find((m) => m.id === s.mapId)?.level ?? 1, picture, played.finale);
    if (outcome.result) await results(outcome.result, s);
    if (mine === run) {
      await title();
      showLobby();
    }
  } catch (err) {
    if (mine !== run) return;
    onlineGame = null;
    await notice('Return Fire: Redux Online', errorText(err));
    await title();
    showLobby();
  } finally {
    status.textContent = '';
  }
}

async function findGame(): Promise<void> {
  const r = await browse(net);
  if (!r) return;
  if (r === 'quick') net.send({ t: 'quick' });
  else if (r === 'create') await newOnlineGame();
  else if (r === 'code') await joinByCode();
  else if ('join' in r) net.send({ t: 'join', id: r.join });
  else {
    const l = net.lobbies.find((x) => x.id === r.watch);
    if (l?.state !== 'playing') return void notice('Return Fire: Redux Online', 'That game has not started yet. Join it instead.');
    net.send({ t: 'join', id: r.watch });
  }
}

async function showFriends(): Promise<void> {
  const r = await friendsDialog();
  if (!r) return;
  if ('join' in r) net.send({ t: 'join', id: r.join });
  else if ('code' in r) net.send({ t: 'join', code: r.code });
  else net.send({ t: 'spectate', gameId: r.watch });
}

async function newOnlineGame(): Promise<void> {
  const opts = await createLobby(await lobbyMaps());
  if (opts) net.send({ t: 'create', ...opts });
}

async function joinByCode(): Promise<void> {
  const code = await enterCode();
  if (code) net.send({ t: 'join', code });
}

/** After signing in or out the connection starts again as the new identity. */
function reconnect(): void {
  net.disconnect();
  net.connect();
}

async function setUpOnline(): Promise<void> {
  onlineReady = await serverAvailable();
  if (!onlineReady) return;
  let joinCode = params.get('join');
  // /admin and /admin/<section> open the game with the admin panel (admin.html), once signed in.
  let adminAt = params.get('admin');
  net.on('welcome', (you) => {
    menu.refresh();
    if (!you.guest) void loadProfile();
    if (adminAt !== null && you.guest && !joinCode) void needAccount();
    else if (adminAt !== null && !you.guest) {
      void openAdmin(adminAt || undefined);
      adminAt = null;
      history.replaceState(null, '', location.pathname);
    }
    // An invite link: join once signed in.
    if (joinCode && you.guest) void needAccount();
    else if (joinCode) {
      net.send({ t: 'join', code: joinCode });
      joinCode = null;
      history.replaceState(null, '', location.pathname);
    }
    if (net.motd && (screen === 'title' || screen === 'gate' || screen === 'splash')) toast(net.motd);
  });
  net.on('start', (s) => void startOnline(s));
  net.on('lobby', (l) => {
    // The lobby changes as its match starts, while the match is still loading (no game yet): it stays hidden
    // until the match is over, or it would cover the bunker and take the keys.
    if (!game && onlineGame === null) showLobby(!!l);
  });
  net.on('notice', (text) => {
    if (!game) toast(text);
  });
  net.on('error', (text) => toast(text));
  net.on('kicked', () => toast('You were removed from the lobby'));
  net.on('friends', (text) => {
    if (text && !game) toast(text);
  });
  net.on('invite', (i) => {
    addInvite(i);
    // In a match the invite waits in Online > Friends.
    if (game || dialogOpen()) return void toast(`${i.from} invited you to ${i.lobbyName} (Online > Friends)`);
    void dialogAsk(`${i.from} invited you to their lobby "${i.lobbyName}". Join it?`).then((yes) => {
      if (yes) net.send({ t: 'join', code: i.code });
    });
  });
  net.connect();
}

function fullScreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

// ---- The menu ----------------------------------------------------------------------------------------------------

/** Whether the title screen shows the menu: it does, until Esc puts it away; any key or tap brings it back. */
let menuShown = true;
/** Whether the match was already paused when the in-match menu opened (null: the menu is not over a match). */
let menuHeld: boolean | null = null;
/** The Return Fire: Redux logo heading the title menu, made when the menu first opens. */
let logo: Logo | null = null;

const menu = new Menu(() => {
  closeMenu();
  // Esc on the title menu goes back to the bare title art; any key brings the menu back.
  if (screen === 'title') menuShown = false;
});

/** The title menu, or the menu over a running match (M, the menu button), which holds an offline match. */
function openMenu(): void {
  if (menu.isOpen) return menu.refresh();
  if (screen === 'game' && game) {
    menuHeld = holdGame();
    menu.open(game.online ? 'Online match' : 'Paused', matchItems, () => (game?.online ? 'The match carries on while the menu is open.' : ''));
  } else if (screen === 'title') {
    menuShown = true;
    menu.open('Return Fire: Redux', titleItems, accountLine, logo ??= new Logo());
  }
}

function closeMenu(): void {
  if (!menu.isOpen) return;
  menu.close();
  if (menuHeld !== null) {
    const was = menuHeld;
    menuHeld = null;
    releaseGame(was);
  }
}

/** Closes the menu and does something that replaces it (a match, the lobby, another page). */
const thenClose = (fn: () => unknown) => () => {
  closeMenu();
  void fn();
};

function accountLine(): string {
  if (!onlineReady) return '';
  if (!net.connected) return 'Connecting to the game server…';
  return signedIn() ? `Signed in as ${net.you!.name}` : 'Not signed in';
}

const onOff = (on: boolean) => (on ? 'On' : 'Off');
const showHallOfFame = () => overGame(() => hallOfFame(loadScores(), settings.players === 2 ? 'tournament' : 'training'));

function titleItems(): MenuEntry[] {
  return [
    { label: 'Play', primary: true, items: playItems },
    { label: 'Online', items: onlineItems },
    { label: 'Hall of Fame', key: shortcutName('hallOfFame'), action: () => void showHallOfFame() },
    { label: 'Replays', hint: 'Watch your last matches again', action: () => void showReplays() },
    ...(handheld ? [] : [{ label: 'Level Editor', hint: 'Make your own maps', action: () => location.assign('editor.html') }]),
    { label: 'Options', items: optionItems },
    { label: 'Help', items: helpItems },
    // Only the site's moderators, admins and owner see it; the server checks every call again.
    ...(signedIn() && net.you!.role !== 'player' ? [{ label: 'Admin Panel', hint: 'Players, games, chat, maps, site', action: () => void openAdmin() }] : []),
  ];
}

function playItems(): MenuEntry[] {
  return [
    { label: 'Training', hint: 'You against the computer', primary: true, action: () => void newGame(1) },
    ...(handheld ? [] : [{ label: 'Two Players', hint: 'Split screen on one keyboard', action: () => void newGame(2) }]),
  ];
}

function matchItems(): MenuEntry[] {
  const online = !!game?.online;
  return [
    { label: 'Resume', primary: true, action: closeMenu },
    ...(online ? [] : [{ label: 'Restart', key: shortcutName('restart'), action: thenClose(restart) }]),
    { label: 'New Game', key: shortcutName('newGame'), action: thenClose(() => newGame()) },
    { label: 'Options', items: optionItems },
    { label: 'Hall of Fame', key: shortcutName('hallOfFame'), action: () => void showHallOfFame() },
    { label: 'Help', items: helpItems },
    { label: online ? 'Leave the Match' : 'Quit to Title', key: 'Esc', action: thenClose(exit) },
  ];
}

function onlineItems(): MenuEntry[] {
  if (!onlineReady) {
    return [{ label: 'No game server here. Online play needs npm start or the Docker stack; the Vite dev server alone has none.', note: true }];
  }
  const account: MenuEntry[] = signedIn()
    ? [
      { label: 'Profile', hint: net.you!.name, action: () => void online(async () => { if ((await profile()) === 'signout') { await signOut(); reconnect(); } }) },
      { label: 'Sign Out', action: () => void signOut().then(reconnect) },
    ]
    : [
      { label: 'Sign In', action: () => void online(async () => { if (await signIn()) reconnect(); }, false) },
      { label: 'Create an Account', action: () => void online(async () => { if (await signUp()) reconnect(); }, false) },
    ];
  return [
    ...(net.lobby && !game ? [{ label: 'Back to the Lobby', hint: net.lobby.name, primary: true, action: () => showLobby() }] : []),
    { label: 'Quick Match', hint: 'Join the first open game', primary: !net.lobby, action: () => void online(() => net.send({ t: 'quick' })) },
    { label: 'Find a Game', hint: 'Browse open lobbies', action: () => void online(findGame) },
    { label: 'Host a Game', hint: 'Pick a map, invite friends or open it up', action: () => void online(newOnlineGame) },
    { label: 'Join with a Code', action: () => void online(joinByCode) },
    ...(signedIn() ? [{ label: 'Friends', hint: 'Who is online, invites', action: () => void online(showFriends) }] : []),
    { label: 'Leaderboards', action: () => void online(async () => leaderboards(maps.length ? maps : await loadMapIndex()), false) },
    ...account,
  ];
}

function optionItems(): MenuEntry[] {
  return [
    { label: 'Full Screen', key: shortcutName('fullScreen'), value: () => onOff(!!document.fullscreenElement), action: fullScreen },
    {
      label: 'Picture', hint: 'Fill the window, or whole-number pixels only',
      value: () => (settings.scale === 'integer' ? 'Whole pixels' : 'Fill'),
      action: () => save({ ...settings, scale: settings.scale === 'integer' ? 'sharp' : 'integer' }),
    },
    {
      label: 'Visuals', hint: 'Retro pixels, or modern 3D at 720p',
      value: () => (settings.visuals === 'modern' ? 'Modern' : 'Retro'),
      action: () => save({ ...settings, visuals: settings.visuals === 'modern' ? 'retro' : 'modern' }),
    },
    { label: 'CRT Look', hint: 'Subtle scanlines and glow (retro)', value: () => onOff(settings.crt), action: () => save({ ...settings, crt: !settings.crt }) },
    {
      label: 'Sound', hint: 'Master, effects and music volume',
      value: () => (settings.volume.muted ? 'Muted' : `${settings.volume.master}%`),
      action: () => void overGame(async () => {
        const v = await soundDialog(settings.volume, applyVolume);
        if (v) save({ ...settings, volume: v });
      }),
    },
    ...(handheld ? [] : [{
      label: 'Controls', hint: 'Change the vehicle keys',
      action: () => void overGame(async () => {
        const keys = await controlsDialog();
        if (keys) save({ ...settings, keys });
      }),
    }]),
    {
      label: 'Music', value: () => onOff(settings.music),
      action: () => {
        save({ ...settings, music: !settings.music });
        music.setEnabled(settings.music);
      },
    },
    { label: 'Jukebox', hint: 'Hear the band book, load a SoundFont', action: () => void overGame(() => jukebox(music)) },
    ...(handheld ? [] : [{
      label: 'Swap Sides', hint: `Arrow keys play Brown (${shortcutName('swapSides')})`, value: () => onOff(settings.swapSides),
      action: () => save({ ...settings, swapSides: !settings.swapSides }),
    }]),
  ];
}

function helpItems(): MenuEntry[] {
  return [
    { label: 'Controls and Keys', key: shortcutName('help'), action: () => void overGame(helpTopics) },
    { label: 'System Info', action: () => void overGame(systemInfo) },
    { label: 'About', action: () => void overGame(about) },
  ];
}

/** The menu button over a match, for a mouse or a finger. */
const menuButton = el('button', { type: 'button', class: 'menu-fab', ariaLabel: 'Menu', title: `Menu (${shortcutName('menus')})` }, '☰');
menuButton.addEventListener('click', () => openMenu());
document.body.append(menuButton);
addEventListener('fullscreenchange', () => menu.refresh());

// ---- Keys --------------------------------------------------------------------------------------------------------

addEventListener('keydown', (e) => {
  // A text box (the lobby, a name, a map search) keeps its keys; none of the shortcuts below is a game key (keys.ts).
  if (dialogOpen() || typingIn(e)) return;
  const handle = (fn: () => unknown) => {
    e.preventDefault();
    if (!e.repeat) fn();
  };
  const actions: Record<ShortcutId, () => unknown> = {
    help: () => overGame(helpTopics),
    newGame: () => newGame(),
    pause: togglePause,
    fullScreen,
    restart,
    hallOfFame: showHallOfFame,
    menus: openMenu,
    swapSides: () => save({ ...settings, swapSides: !settings.swapSides }),
    mute: () => {
      save({ ...settings, volume: { ...settings.volume, muted: !settings.volume.muted } });
      toast(settings.volume.muted ? 'Sound off' : 'Sound on');
    },
  };
  const intro = screen === 'gate' || screen === 'splash';
  const shortcut = intro ? null : shortcutFor(e);
  // With the menu open only the shortcuts work; P would let the match run on under the menu.
  if (menu.isOpen) return void (shortcut && shortcut !== 'pause' && handle(actions[shortcut]));
  if (shortcut) return handle(actions[shortcut]);
  switch (e.code) {
    case 'Escape':
      if (screen === 'gate') {
        e.preventDefault();
        setScreen('title');
        skip.abort();
        return void title();
      }
      if (screen === 'win') return handle(() => skip.abort());
      if (game) return handle(exit);
      break;
  }
  // Any other key starts or skips the splash, skips the win scene, and brings the menu back on the title screen,
  // unless the lobby is up there.
  if ((intro || screen === 'win') && !/^(F\d+|Shift|Control|Alt|Meta)/.test(e.code)) handle(() => skip.abort());
  else if (screen === 'title' && !e.repeat && !game && !lobbyWin?.visible && !/^(Shift|Control|Alt|Meta|Tab|F11|F12|Escape)/.test(e.code)) handle(openMenu);
});

addEventListener('pointerdown', (e) => {
  if (dialogOpen() || (e.target as Element).closest?.('.main-menu, .menu-fab, .lobby-layer, .chatline, .toasts')) return;
  if (screen === 'gate' || screen === 'splash' || screen === 'win') skip.abort();
  // Tapping the title screen brings up the menu, as a key does.
  else if (screen === 'title' && !lobbyWin?.visible) openMenu();
});

// ---- Start -------------------------------------------------------------------------------------------------------

async function boot(): Promise<void> {
  if (handheld) {
    // In this order: the lock's first touch must come before the block on an upright screen.
    lockLandscape();
    blockWhileUpright();
    addTouchControls();
  }
  stage.blank();
  maps = await loadMapIndex();
  void setUpOnline();
  const mode = params.get('mode');
  if (mode === 'solo' || mode === 'local2') {
    // Dev shortcut: straight into a match.
    settings = { ...settings, players: mode === 'local2' && !handheld ? 2 : 1, mapId: params.get('map') ?? settings.mapId };
    const seed = params.get('seed');
    if (params.get('teams') !== null) settings.teams = { ...settings.teams, layout: params.get('teams')!, handicap: params.get('handicap') === '1', together: params.get('together') === '1' };
    return startGame({ bots: params.get('bots') !== '0', seed: seed ? Number(seed) | 0 || 1 : undefined });
  }
  if (params.get('map')) settings.mapId = params.get('map')!;
  // An invite or admin link goes straight to the title, where its lobby or panel opens.
  if (params.has('join') || params.has('admin')) await title();
  else await splash();
}

boot().catch((err: unknown) => {
  const el = document.getElementById('error')!;
  el.style.display = 'grid';
  el.textContent = err instanceof Error ? err.message : String(err);
});
