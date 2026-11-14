// What an online match adds over the picture (mp-hud, chat): the chat line and recent messages, names over other
// players' vehicles, and the scoreboard (Tab, and at the end). Text is drawn into the 320 x 240 frame in the pixel
// font so it scales with the game; only the line being typed is a page element, so phone keyboards and pasting work.

import { UNLIMITED, VEHICLE_KINDS, type Match } from '@rfw/sim';
import type { ChatChannel, ChatMessage, MatchResult, MatchStart, SeatStatus } from '@rfw/net';
import type { Camera, ViewRect } from '../camera.js';
import { LINE, drawText, textWidth } from '../font.js';
import { type Frame, SCREEN_H, SCREEN_W } from '../raster.js';
import { BASE_COLOURS } from '../view.js';
import type { Net } from './net.js';

const TEAM_NAMES = 'ABCD';
const SYSTEM = 0xff60ffff;
const WHISPER = 0xffff80ff;
/** Messages stay on screen this long (all of the last few show while typing). */
const CHAT_MS = 12000;

interface Target {
  channel: ChatChannel;
  to?: string;
  label: string;
}

/**
 * The chat line: T opens it (Enter is a fire key), Tab picks everyone / team / one player, Enter sends, Esc closes.
 * On a touch screen the Chat button opens it, tapping the label picks who it goes to, and the on-screen keyboard's
 * send key sends.
 */
export class ChatInput {
  readonly el: HTMLInputElement;
  private readonly label: HTMLSpanElement;
  private readonly wrap: HTMLDivElement;
  private target = 0;

  constructor(private readonly net: Net, readonly start: MatchStart, signal: AbortSignal) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'chatline';
    this.wrap.hidden = true;
    this.label = document.createElement('span');
    this.el = document.createElement('input');
    this.el.maxLength = 200;
    this.el.autocomplete = 'off';
    this.el.enterKeyHint = 'send';
    this.wrap.append(this.label, this.el);
    // Kept from taking the focus, so tapping it does not close the line.
    this.label.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.next(1);
    });
    document.body.append(this.wrap);
    signal.addEventListener('abort', () => this.wrap.remove());
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter') {
        e.preventDefault();
        const text = this.el.value.trim();
        const t = this.targets()[this.target]!;
        if (text) this.net.send({ t: 'chat', channel: t.channel, to: t.to, text });
        this.close();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        this.next(e.shiftKey ? -1 : 1);
      }
    });
    this.el.addEventListener('blur', () => this.close());
  }

  /** Everyone, the team (players only), and each other person in the game. */
  private targets(): Target[] {
    const me = this.net.you?.id;
    const out: Target[] = [{ channel: 'all', label: 'All' }];
    if (this.start.you !== null) out.push({ channel: 'team', label: 'Team' });
    for (const s of this.start.seats) if (s.userId && s.userId !== me) out.push({ channel: 'whisper', to: s.userId, label: `To ${s.name}` });
    return out;
  }

  /** The next (or previous) recipient. */
  private next(step: number): void {
    this.target = (this.target + step + this.targets().length) % this.targets().length;
    this.showLabel();
  }

  private showLabel(): void {
    this.label.textContent = `${this.targets()[this.target]!.label}:`;
  }

  get typing(): boolean {
    return !this.wrap.hidden;
  }

  open(): void {
    this.target = Math.min(this.target, this.targets().length - 1);
    this.showLabel();
    this.wrap.hidden = false;
    this.el.value = '';
    this.el.focus();
  }

  close(): void {
    if (this.wrap.hidden) return;
    this.wrap.hidden = true;
    this.el.blur();
  }
}

function seatColour(start: MatchStart, userId: string | undefined): number {
  const seat = start.seats.find((s) => s.userId === userId);
  return seat ? BASE_COLOURS[seat.base] ?? 0xffffffff : 0xffffffff;
}

/** The last few chat messages at the top left of the view. */
export function drawChat(frame: Frame, messages: readonly ChatMessage[], input: ChatInput, view: ViewRect): void {
  frame.setClip(0, 0, SCREEN_W, SCREEN_H);
  const now = Date.now();
  const shown = messages.filter((m) => input.typing || now - m.at < CHAT_MS).slice(input.typing ? -8 : -4);
  const start = input.start;
  shown.forEach((m, i) => {
    const y = view.y + 14 + i * LINE;
    if (m.system || !m.from) {
      drawText(frame, m.text, view.x + 4, y, SYSTEM, 1, view.w - 8);
      return;
    }
    const tag = m.channel === 'team' ? '(Team) ' : m.channel === 'whisper' ? (m.from.id === start.seats.find((s) => s.player === start.you)?.userId ? `(To ${m.to?.name}) ` : '(Whisper) ') : '';
    const who = `${tag}${m.from.name}: `;
    drawText(frame, who, view.x + 4, y, m.channel === 'whisper' ? WHISPER : seatColour(start, m.from.id), 1, view.w - 8);
    drawText(frame, m.text, view.x + 4 + textWidth(who), y, 0xffffffff, 1, view.w - 8 - textWidth(who));
  });
}

/** Each other player's name over their vehicle, in their base's colour. */
export function drawNames(frame: Frame, cam: Camera, m: Match, start: MatchStart, viewer: number): void {
  const v = cam.view;
  frame.setClip(v.x, v.y, v.w, v.h);
  cam.begin();
  for (const p of m.players) {
    const o = p.vehicle;
    if (!o || p.id === viewer) continue;
    const at = cam.project(o.x / 65536, o.y / 65536, Math.max(0, o.z / 65536) + 22);
    if (!at) continue;
    const name = start.seats[p.id]?.name ?? '';
    const x = Math.round(at.x - textWidth(name) / 2);
    const y = Math.round(at.y - 10);
    if (x < v.x - 40 || x > v.x + v.w || y < v.y || y > v.y + v.h - 8) continue;
    drawText(frame, name, Math.max(v.x, x), y, BASE_COLOURS[p.base] ?? 0xffffffff, 1, v.x + v.w - Math.max(v.x, x));
  }
  frame.setClip(0, 0, SCREEN_W, SCREEN_H);
}

function shade(frame: Frame, x0: number, y0: number, w: number, h: number): void {
  for (let y = Math.max(0, y0); y < Math.min(SCREEN_H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(SCREEN_W, x0 + w); x++) {
      const i = y * SCREEN_W + x;
      frame.px[i] = (0xff000000 | ((frame.px[i]! >>> 2) & 0x3f3f3f)) >>> 0;
    }
  }
}

/** The scoreboard: team, name, vehicles left, flags captured and connection, by team. */
export function drawScoreboard(frame: Frame, m: Match, start: MatchStart, seats: readonly SeatStatus[], captures: readonly number[], result: MatchResult | null): void {
  frame.setClip(0, 0, SCREEN_W, SCREEN_H);
  const rows = [...start.seats].sort((a, b) => a.team - b.team || a.player - b.player);
  const w = 272;
  const h = 22 + rows.length * (LINE + 2);
  const x0 = (SCREEN_W - w) >> 1;
  const y0 = 24;
  shade(frame, x0, y0, w, h);
  const col = [x0 + 6, x0 + 26, x0 + 150, x0 + 186, x0 + 220];
  ['T', 'Player', 'Left', 'Flags', 'Status'].forEach((t, i) => drawText(frame, t, col[i]!, y0 + 5, 0xffc0c0c0));
  rows.forEach((s, i) => {
    const y = y0 + 17 + i * (LINE + 2);
    const p = m.players[s.player]!;
    const st = seats.find((x) => x.player === s.player);
    const left = VEHICLE_KINDS.reduce((n, k) => n + (p.lives[k] === UNLIMITED ? 99 : p.lives[k]), 0) + (p.vehicle ? 1 : 0);
    const flags = result?.seats.find((r) => r.player === s.player)?.captures ?? captures[s.player] ?? 0;
    const status = m.eliminated[p.base] ? 'Out' : s.bot ? `Bot ${s.difficulty ?? ''}` : st?.botTakeover ? 'Bot' : st && !st.connected ? 'Gone' : st?.ping !== undefined ? `${st.ping}ms` : '';
    const colour = BASE_COLOURS[s.base] ?? 0xffffffff;
    drawText(frame, TEAM_NAMES[s.team] ?? '?', col[0]!, y, colour);
    drawText(frame, s.name + (s.player === start.you ? ' (you)' : ''), col[1]!, y, colour, 1, col[2]! - col[1]! - 4);
    drawText(frame, String(left), col[2]!, y);
    drawText(frame, String(flags), col[3]!, y);
    drawText(frame, status, col[4]!, y, 0xffffffff, 1, x0 + w - col[4]!);
  });
}
