// The game's music: the original's director (director.ts) choosing pieces from the band book (pieces.ts), played
// as MIDI (smf.ts, player.ts) on the synthesiser (synth.ts). The game feeds it each tick what the original's
// triggers saw; the front end tells it about the menus, the win and the Music switch.
//
// A SoundFont dropped in as /generated/music/soundfont.sf2 replaces the built-in timbres, and any piece can be
// replaced by a MIDI file at /generated/music/<name>.mid (its sections named by markers, as docs/music.md says).

import { TICK_MS, type Match, type MatchEvent, type Vehicle } from '@rfw/sim';
import { Director, PIECES, STOP, type MusicOut, type Piece, type Scored } from './director.js';
import { BOOK } from './pieces.js';
import { Player } from './player.js';
import { compile } from './score.js';
import { readSmf, timeline, writeSmf, type Timeline } from './smf.js';
import { extras } from '../extras.js';
import { SoundFont } from './soundfont.js';
import { Synth } from './synth.js';

const LEVEL = 0.55;
const FADE_S = 1.2;
/** Squared pixels: an enemy flag this close makes the tank's theme the tense one (sub_40f2f0, 0x4000). */
const NEAR_FLAG = 0x4000;

interface Feed {
  match: Match;
  /** The players on this machine, by id: the first one or two offline, this browser's seat online. */
  locals: readonly number[];
  /** Each local player's vehicle last tick. */
  last: (Vehicle | null)[];
}

export class Music implements MusicOut {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private player: Player | null = null;
  private readonly timelines = new Map<string, Timeline>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private feed: Feed | null = null;
  private held = false;
  private auditioning = false;
  private master: GainNode | null = null;
  private volume = 1;
  readonly director: Director<Vehicle>;

  constructor(enabled = true) {
    this.director = new Director<Vehicle>(
      this,
      (v) => !!this.feed?.match.players.some((p) => p.vehicle === v),
      (local) => {
        const f = this.feed;
        const id = f?.locals[local];
        return id !== undefined && !!f!.match.players[id]?.vehicle;
      },
      () => this.feed?.locals.length || 1,
    );
    this.director.off = !enabled;
  }

  get ready(): boolean {
    return !!this.player;
  }

  get fading(): boolean {
    return !!this.player?.fading;
  }

  /** The SoundFont in use, if any. */
  get soundfont(): string | null {
    return this.synth?.soundfont?.name ?? null;
  }

  /**
   * Starts the audio, from a key press or tap (browsers allow sound only after one); later ones start it again if
   * the browser left it suspended.
   */
  async unlock(): Promise<void> {
    if (this.ctx) {
      if ((!this.held || this.auditioning) && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    this.master = master;
    this.synth = new Synth(ctx, master);
    this.player = new Player(ctx, this.synth, master, LEVEL);
    this.timer = setInterval(() => {
      if (!this.held && !this.auditioning) this.director.update();
    }, TICK_MS);
    void this.loadOverrides();
  }

  private async loadOverrides(): Promise<void> {
    const have = await extras();
    if (have.has('music/soundfont.sf2')) {
      try {
        const res = await fetch('/generated/music/soundfont.sf2');
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && !type.includes('text/html')) this.loadSoundFont(await res.arrayBuffer());
      } catch {
        // None: the built-in timbres play.
      }
    }
    await Promise.all(Object.keys(BOOK).filter((name) => have.has(`music/${name}.mid`)).map(async (name) => {
      try {
        const res = await fetch(`/generated/music/${name}.mid`);
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && !type.includes('text/html')) this.timelines.set(name, timeline(readSmf(await res.arrayBuffer())));
      } catch {
        // None: our arrangement plays.
      }
    }));
  }

  /** Plays every program the SoundFont has from its samples. Throws if the file is not a SoundFont. */
  loadSoundFont(data: ArrayBuffer): string {
    const sf = new SoundFont(data);
    if (this.synth) this.synth.soundfont = sf;
    return sf.name;
  }

  /** A piece laid out for playing: a replacement file if one was found, else our arrangement compiled. */
  timeline(file: string): Timeline {
    let tl = this.timelines.get(file);
    if (!tl) {
      const def = BOOK[file];
      if (!def) throw new Error(`music: no piece "${file}"`);
      tl = timeline(readSmf(writeSmf(compile(def))));
      this.timelines.set(file, tl);
    }
    return tl;
  }

  // ---- What the director asks of the player ----------------------------------------------------------------------

  play(piece: Piece, fromLoop: boolean, how: 'start' | 'beat' | 'cut'): void {
    const player = this.player;
    if (!player) return;
    const tl = this.timeline(piece.file);
    const section = fromLoop ? piece.loop ?? piece.start : piece.start;
    const start = how === 'beat' ? 'beat' : how === 'cut' ? 'now' : player.busy ? 'now' : 'after';
    player.play(tl, section, start, () => {
      // The end is scheduled just ahead of being heard: the next piece is picked now, so it follows on at once.
      this.director.ended();
      this.director.update();
    });
  }

  fadeOut(): void {
    this.player?.fadeOut(FADE_S);
  }

  stop(): void {
    this.player?.stop();
  }

  // ---- What the front end and the game tell it -------------------------------------------------------------------

  /** The music volume as a gain (0-1), master volume and mute included (Options > Sound). */
  setVolume(gain: number): void {
    this.volume = gain;
    if (this.master) this.master.gain.value = gain;
  }

  /** The Music switch on the Options menu. */
  setEnabled(on: boolean): void {
    if (on === !this.director.off) return;
    this.director.setOff(!on);
  }

  get enabled(): boolean {
    return !this.director.off;
  }

  /** Pause holds the music with the game. */
  hold(on: boolean): void {
    this.held = on;
    if (this.ctx) void (on ? this.ctx.suspend() : this.ctx.resume());
  }

  /** Whether sound can play now: a browser lets it only after a key press or tap on the page. */
  async canPlay(): Promise<boolean> {
    await this.unlock();
    // A browser that allows sound here starts the new context at once or a moment later.
    if (this.ctx?.state !== 'running') await new Promise((r) => setTimeout(r, 60));
    return this.ctx?.state === 'running';
  }

  /**
   * The splash's fanfare, played straight through with the director waiting until stopFanfare. Returns how long it
   * lasts (ms), or 0 when the music is off or there is no sound.
   */
  fanfare(): number {
    if (!this.player || this.director.off) return 0;
    this.auditioning = true;
    const tl = this.timeline('fanfare');
    this.player.play(tl, null, 'now', null);
    return tl.duration * 1000;
  }

  /**
   * The splash is over: the fanfare fades if it is still going, whatever still sounds of it is let go, and the
   * director carries on.
   */
  stopFanfare(): void {
    if (!this.auditioning || !this.ctx) return;
    this.auditioning = false;
    if (this.player?.busy) this.player.fadeOut(0.4);
    else this.synth?.cutFrom(this.ctx.currentTime, 0.4);
  }

  /** The title screen and menus: the drums. */
  menus(): void {
    this.feed = null;
    this.director.menus();
  }

  /** Quiet for a movie (which has its own sound). */
  quiet(): void {
    this.director.request(STOP, 0x100);
  }

  /** A match begins, with this machine's players (by id; none for a spectator) in their bunkers. */
  startMatch(match: Match, locals: readonly number[]): void {
    this.feed = { match, locals, last: locals.map(() => null) };
    this.director.matchStart();
  }

  /** The match is won: the Win piece. */
  win(): void {
    this.director.win();
  }

  /** One sim tick: what the original's triggers would have seen happen. Online the match can be replaced by the
   * server's snapshot, so it comes with each tick. */
  tick(m: Match, events: readonly MatchEvent[]): void {
    const f = this.feed;
    if (!f) return;
    if (m !== f.match) {
      // A restored match has new vehicle objects: a vehicle out now is launched afresh, so the director watches it.
      f.match = m;
      f.last = f.locals.map(() => null);
    }
    let flagRevealed = false;
    let flagTaken = false;
    for (const e of events) {
      if (e.type === 'flagRevealed') flagRevealed = true;
      else if (e.type === 'flagTaken' && m.players[e.player]?.base !== e.base) flagTaken = true;
      else if (e.type === 'destroyed' && f.locals.includes(e.player)) {
        const v = f.last[f.locals.indexOf(e.player)];
        if (v) this.director.destroyed(v, e.kind);
      }
    }
    let driving = false;
    let inBunker = 0;
    f.locals.forEach((id, i) => {
      const pl = m.players[id];
      if (!pl) return;
      const v = pl.vehicle;
      if (v && v !== f.last[i]) this.director.launch(v, v.kind);
      f.last[i] = v;
      if (v) driving = true;
      if (pl.state === 'bunker' || (pl.state === 'launching' && pl.elevator)) inBunker++;
    });
    this.director.situation({ flagRevealed, flagTaken, sub: !!m.sub, driving, inBunker, humans: f.locals.length || 1 }, (v) => scoring(m, v));
  }

  /** Leaving a match. */
  endMatch(): void {
    this.feed = null;
  }

  // ---- The jukebox ---------------------------------------------------------------------------------------------

  /** Plays one of the director's pieces straight through (the director waits until stopAudition). */
  audition(index: number): void {
    const piece = PIECES[index];
    if (!piece || !this.player) return;
    this.auditioning = true;
    // The jukebox may be open over a paused match.
    void this.ctx?.resume();
    this.player.play(this.timeline(piece.file), piece.start, 'now', null);
  }

  stopAudition(): void {
    if (!this.auditioning) return;
    this.auditioning = false;
    this.player?.stop();
    if (this.held) void this.ctx?.suspend();
    this.director.replay();
  }
}

/** What sub_40f2f0 looks at for the vehicle being scored. */
function scoring(m: Match, v: Vehicle): Scored<Vehicle> | null {
  const pl = m.players.find((p) => p.vehicle === v);
  if (!pl) return null;
  const own = m.flags.find((f) => f.base === pl.base);
  const near = m.flags.some((f) => {
    if (f.base === pl.base || !f.revealed) return false;
    const dx = (v.x - f.x) >> 16;
    const dy = (v.y - f.y) >> 16;
    return dx * dx + dy * dy < NEAR_FLAG;
  });
  return { vehicle: v, kind: v.kind, ownFlagCarried: !!own?.revealed && own.carrier >= 0, enemyFlagNear: near, left: pl.lives[v.kind] };
}
