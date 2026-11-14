// The lockstep hot path, in small binary WebSocket messages. Each tick the server sends every player's input and
// bunker commands (a frame); clients send the server their controls when they change, their bunker commands, and
// now and then a hash of their state.
//
//   server -> client  FRAMES  u8 1, u32 first tick, u8 count, u8 players, then per tick: players x u16 input,
//                             u8 commands, commands x (u8 player, u8 command)
//   client -> server  INPUT   u8 2, u16 input
//                     COMMAND u8 3, u8 command
//                     HASH    u8 4, u32 tick, u32 hash
//
// Everything else (sign-in, lobbies, chat, snapshots) is JSON in text messages (messages.ts).

import { VEHICLE_KINDS, dock, launch, stepMatch, type Match, type VehicleInput, type VehicleKind } from '@rfw/sim';

export const FRAMES = 1;
export const INPUT = 2;
export const COMMAND = 3;
export const HASH = 4;

// Input bits. Throttle and turn take two bits each: 1 for +1, 2 for -1.
const THROTTLE = 0;
const TURN = 2;
const FIRE = 1 << 4;
const FIRE2 = 1 << 5;
const FIRE3 = 1 << 6;
const TURRET_LEFT = 1 << 7;
const TURRET_RIGHT = 1 << 8;

const axis = (n: number) => (n > 0 ? 1 : n < 0 ? 2 : 0);
const unaxis = (bits: number): -1 | 0 | 1 => (bits === 1 ? 1 : bits === 2 ? -1 : 0);

/** One tick of controls in 9 bits. */
export function packInput(i: VehicleInput | undefined): number {
  if (!i) return 0;
  return (axis(i.throttle) << THROTTLE) | (axis(i.turn) << TURN) | (i.fire ? FIRE : 0) | (i.fire2 ? FIRE2 : 0) | (i.fire3 ? FIRE3 : 0)
    | (i.turretLeft ? TURRET_LEFT : 0) | (i.turretRight ? TURRET_RIGHT : 0);
}

export function unpackInput(n: number): VehicleInput {
  return {
    throttle: unaxis((n >> THROTTLE) & 3), turn: unaxis((n >> TURN) & 3),
    fire: !!(n & FIRE), fire2: !!(n & FIRE2), fire3: !!(n & FIRE3), turretLeft: !!(n & TURRET_LEFT), turretRight: !!(n & TURRET_RIGHT),
  };
}

/** Bunker commands: launch a vehicle (0-3 in VEHICLE_KINDS order) or dock. */
export type Command = { launch: VehicleKind } | { dock: true };
export const DOCK = 4;

export function commandCode(c: Command): number {
  return 'dock' in c ? DOCK : VEHICLE_KINDS.indexOf(c.launch);
}

export function commandFromCode(code: number): Command | null {
  if (code === DOCK) return { dock: true };
  const kind = VEHICLE_KINDS[code];
  return kind ? { launch: kind } : null;
}

/** One tick as the server ordered it. */
export interface Frame {
  tick: number;
  /** Packed input by player id. */
  inputs: number[];
  /** [player id, command code], applied in order before the tick. */
  commands: [number, number][];
}

/**
 * Plays one frame: its bunker commands, then the tick. The server and every client call this and nothing else to
 * advance a match, so they stay in step.
 */
export function applyFrame(m: Match, f: Frame): void {
  if (f.tick !== m.tick + 1) throw new Error(`Frame for tick ${f.tick} applied at tick ${m.tick}`);
  for (const [p, code] of f.commands) {
    const c = commandFromCode(code);
    if (!c) continue;
    if ('dock' in c) dock(m, p);
    else launch(m, p, c.launch);
  }
  stepMatch(m, f.inputs.map((n, p) => (m.players[p] ? unpackInput(n) : undefined)));
  // stepMatch does not count a tick once the match is won; frames still do, so they stay numbered in order.
  if (m.tick !== f.tick) m.tick = f.tick;
}

export function encodeFrames(frames: readonly Frame[]): Uint8Array {
  const players = frames[0]?.inputs.length ?? 0;
  let size = 7;
  for (const f of frames) size += players * 2 + 1 + f.commands.length * 2;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, FRAMES);
  dv.setUint32(1, frames[0]?.tick ?? 0);
  dv.setUint8(5, frames.length);
  dv.setUint8(6, players);
  let o = 7;
  for (const f of frames) {
    for (let p = 0; p < players; p++, o += 2) dv.setUint16(o, f.inputs[p] ?? 0);
    dv.setUint8(o++, f.commands.length);
    for (const [p, c] of f.commands) {
      dv.setUint8(o++, p);
      dv.setUint8(o++, c);
    }
  }
  return buf;
}

export function decodeFrames(buf: Uint8Array): Frame[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint8(0) !== FRAMES) throw new Error('Not a frames message');
  const first = dv.getUint32(1);
  const count = dv.getUint8(5);
  const players = dv.getUint8(6);
  const out: Frame[] = [];
  let o = 7;
  for (let i = 0; i < count; i++) {
    const inputs: number[] = [];
    for (let p = 0; p < players; p++, o += 2) inputs.push(dv.getUint16(o));
    const n = dv.getUint8(o++);
    const commands: [number, number][] = [];
    for (let k = 0; k < n; k++, o += 2) commands.push([dv.getUint8(o), dv.getUint8(o + 1)]);
    out.push({ tick: first + i, inputs, commands });
  }
  return out;
}

export function encodeInput(input: VehicleInput | undefined): Uint8Array {
  const buf = new Uint8Array(3);
  buf[0] = INPUT;
  new DataView(buf.buffer).setUint16(1, packInput(input));
  return buf;
}

export function encodeCommand(c: Command): Uint8Array {
  return Uint8Array.of(COMMAND, commandCode(c));
}

export function encodeHash(tick: number, hash: number): Uint8Array {
  const buf = new Uint8Array(9);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, HASH);
  dv.setUint32(1, tick);
  dv.setUint32(5, hash >>> 0);
  return buf;
}

/** A client's binary message, or null for one that is malformed. */
export type ClientBinary = { type: 'input'; input: number } | { type: 'command'; code: number } | { type: 'hash'; tick: number; hash: number };

export function decodeClientBinary(buf: Uint8Array): ClientBinary | null {
  if (buf.length < 1) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  switch (buf[0]) {
    case INPUT:
      return buf.length === 3 ? { type: 'input', input: dv.getUint16(1) & 0x1ff } : null;
    case COMMAND:
      return buf.length === 2 && commandFromCode(buf[1]!) ? { type: 'command', code: buf[1]! } : null;
    case HASH:
      return buf.length === 9 ? { type: 'hash', tick: dv.getUint32(1), hash: dv.getUint32(5) } : null;
    default:
      return null;
  }
}
