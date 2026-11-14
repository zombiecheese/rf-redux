// The sequencer: plays a laid-out MIDI file (smf.ts) on the synthesiser from one of its sections to its end,
// scheduling a little ahead of the audio clock so timing does not depend on the page's frame rate. It can switch
// to another piece at once, on the next beat, or after the current one ends (so loops are seamless), and fade out.

import type { PlayEvent, Timeline } from './smf.js';
import type { Synth } from './synth.js';

/** How far ahead events are handed to the synthesiser, and how often the queue is topped up. */
const AHEAD = 0.35;
const AHEAD_HIDDEN = 1.5;
const POLL_MS = 40;

export type Start = 'now' | 'beat' | 'after';

interface Playing {
  tl: Timeline;
  /** Piece time where it started, and the audio-clock time that maps to. */
  from: number;
  at: number;
  /** Next event to schedule. */
  cursor: number;
  /** Piece time it stops at, and whether the end has been reported. */
  to: number;
  ended: boolean;
  onEnd: (() => void) | null;
}

export class Player {
  private playing: Playing | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fadeUntil = 0;
  /** Audio-clock time the last piece finishes (its last note may still ring). */
  private endsAt = 0;

  constructor(private readonly ctx: BaseAudioContext, private readonly synth: Synth, private readonly master: GainNode,
    private readonly level = 1) {}

  /** Whether a fade out is still under way. */
  get fading(): boolean {
    return this.ctx.currentTime < this.fadeUntil;
  }

  /** Whether a piece is sounding (started and not yet past its end). */
  get busy(): boolean {
    return !!this.playing && !this.playing.ended;
  }

  /**
   * Plays a piece from a section (or the start) to its end. "now" cuts whatever plays; "beat" switches on the
   * current piece's next beat; "after" waits for the current piece to end. onEnd is called once, as the end is
   * scheduled (shortly before it is heard), so the next piece can follow on without a gap.
   */
  play(tl: Timeline, section: string | null, start: Start, onEnd: (() => void) | null): void {
    const now = this.ctx.currentTime + 0.03;
    let at = now;
    const cur = this.playing;
    if (start === 'after') at = Math.max(now, this.endsAt);
    else if (start === 'beat' && cur && !cur.ended) {
      const pos = cur.from + (now + 0.03 - cur.at);
      at = cur.at + (cur.tl.beatTime(Math.ceil(cur.tl.beatAt(pos))) - cur.from);
    }
    if (start !== 'after' && cur && !cur.ended) {
      // The old piece plays on up to the switch.
      for (; cur.cursor < cur.tl.events.length; cur.cursor++) {
        const e = cur.tl.events[cur.cursor]!;
        const t = cur.at + (e.time - cur.from);
        if (t >= at || past(e, cur.to)) break;
        this.dispatch(e, Math.max(t, this.ctx.currentTime));
      }
      this.synth.cutFrom(at, start === 'beat' ? 0.15 : 0.06);
    }
    if (this.ctx.currentTime >= this.fadeUntil) this.master.gain.cancelScheduledValues(0);
    this.master.gain.setValueAtTime(this.level, at);
    this.fadeUntil = 0;
    const from = section === null ? 0 : tl.sections.find((s) => s.name === section)?.time ?? 0;
    const p: Playing = { tl, from, at, cursor: firstAt(tl.events, from), to: tl.duration, ended: false, onEnd };
    // Programs and controllers set before the section still apply when starting in the middle.
    this.chase(tl.events, from, at);
    this.playing = p;
    this.endsAt = at + (p.to - from);
    this.pump();
    this.timer ??= setInterval(() => this.pump(), POLL_MS);
  }

  /** Fades out over some seconds, then stops. */
  fadeOut(seconds: number): void {
    const p = this.playing;
    if (!p || p.ended) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + seconds);
    this.fadeUntil = now + seconds;
    p.to = Math.min(p.to, p.from + (now + seconds - p.at));
    p.onEnd = null;
    this.synth.cutFrom(now + seconds, 0.02);
    this.endsAt = now + seconds;
  }

  /** Stops at once (with a short release). */
  stop(): void {
    const p = this.playing;
    if (!p || p.ended) return;
    const now = this.ctx.currentTime;
    this.synth.cutFrom(now + 0.02, 0.06);
    p.ended = true;
    p.onEnd = null;
    this.endsAt = now;
  }

  /** Stops and forgets everything, for leaving the page or switching the music off. */
  dispose(): void {
    this.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing = null;
  }

  private chase(events: readonly PlayEvent[], until: number, at: number): void {
    this.synth.resetChannels(at);
    for (const e of events) {
      if (e.time >= until) break;
      const ev = e.event;
      if (ev.kind === 'program') this.synth.program(ev.ch, ev.program);
      else if (ev.kind === 'control' && ev.controller !== 64 && ev.controller < 120) this.synth.control(ev.ch, ev.controller, ev.value, at);
      else if (ev.kind === 'pitchBend') this.synth.pitchBend(ev.ch, ev.value, at);
    }
  }

  private pump(): void {
    const p = this.playing;
    if (!p || p.ended) return;
    const horizon = this.ctx.currentTime + (typeof document !== 'undefined' && document.hidden ? AHEAD_HIDDEN : AHEAD);
    const ev = p.tl.events;
    while (p.cursor < ev.length) {
      const e = ev[p.cursor]!;
      if (past(e, p.to)) break;
      const t = p.at + (e.time - p.from);
      if (t > horizon) return;
      this.dispatch(e, Math.max(t, this.ctx.currentTime));
      p.cursor++;
    }
    // Everything up to the end is scheduled; the end itself is still ahead, or here.
    if (p.at + (p.to - p.from) > horizon) return;
    p.ended = true;
    const done = p.onEnd;
    p.onEnd = null;
    done?.();
  }

  private dispatch(e: PlayEvent, t: number): void {
    const ev = e.event;
    switch (ev.kind) {
      case 'noteOn': this.synth.noteOn(ev.ch, ev.note, ev.vel, t); break;
      case 'noteOff': this.synth.noteOff(ev.ch, ev.note, t); break;
      case 'control': this.synth.control(ev.ch, ev.controller, ev.value, t); break;
      case 'program': this.synth.program(ev.ch, ev.program); break;
      case 'pitchBend': this.synth.pitchBend(ev.ch, ev.value, t); break;
      default: break;
    }
  }
}

/**
 * Whether an event comes after a piece's stopping point. The note-offs at the very end are still played, or the
 * last chord would ring on for ever once nothing follows it to cut it off.
 */
function past(e: PlayEvent, to: number): boolean {
  return e.time > to || (e.time === to && e.event.kind !== 'noteOff');
}

/** Index of the first event at or after a time. */
function firstAt(events: readonly PlayEvent[], time: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
