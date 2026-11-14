// Snapshots and state hashes for online play. A snapshot is the whole Match as JSON, restored bit-identically, so a
// player can join a match in progress, come back after a dropped connection, or be put right after a desync. The
// hash is a cheap 32-bit digest of the same state that clients and the server compare to spot a desync.
//
// Both walk the match as a plain object graph, in key order, so they need no list of fields and keep working as the
// sim grows. Objects reached twice (a vehicle held by its player and another list) are written once and referred
// to after that. The building table and shoreline shapes come from the converted assets and never change during a
// match, so they are left out: both ends load the same files and pass them in as statics, and any object inside
// them is written as a reference into them.

import type { BuildingDef } from './buildings.js';
import type { Match } from './match.js';
import { MsvcRand, Rng } from './rng.js';
import type { ShoreTable } from './shore.js';

/** Bump when the snapshot encoding changes, so an old client is not handed one it cannot read. */
export const SNAPSHOT_VERSION = 3;

/** The data a match shares with the loaded assets, left out of snapshots and hashes. */
export interface Statics {
  defs: readonly BuildingDef[];
  shore: ShoreTable | null;
}

export interface Snapshot {
  version: number;
  tick: number;
  /** The encoded match (see encode below). */
  data: unknown;
}

/** Classes the sim keeps in its state, restored with their prototype. */
const CLASSES: Record<string, { prototype: object }> = { Rng, MsvcRand };

type TypedArray = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float64Array;
const TYPED: Record<string, new (n: number) => TypedArray> = {
  Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float64Array,
};

function className(o: object): string | null {
  const proto = Object.getPrototypeOf(o) as object | null;
  if (proto === Object.prototype || proto === null || Array.isArray(o)) return null;
  for (const [name, c] of Object.entries(CLASSES)) if (proto === c.prototype) return name;
  if (ArrayBuffer.isView(o)) return o.constructor.name;
  if (o instanceof Map) return 'Map';
  if (o instanceof Set) return 'Set';
  throw new Error(`Cannot snapshot an instance of ${(o.constructor as { name?: string }).name ?? 'an unknown class'}`);
}

/** Numbers an object in the static data by the order a depth-first walk first meets it. */
function staticIds(statics: Statics): Map<object, number> {
  const ids = new Map<object, number>();
  const visit = (v: unknown) => {
    if (typeof v !== 'object' || v === null || ids.has(v)) return;
    ids.set(v, ids.size);
    if (ArrayBuffer.isView(v)) return;
    if (v instanceof Map || v instanceof Set) {
      for (const e of v instanceof Map ? [...v.entries()].flat() : v) visit(e);
      return;
    }
    for (const k of Object.keys(v)) visit((v as Record<string, unknown>)[k]);
  };
  visit(statics.defs);
  visit(statics.shore);
  return ids;
}

const cache = new WeakMap<object, { statics: Statics; ids: Map<object, number>; list: object[] }>();

function staticsFor(statics: Statics): { ids: Map<object, number>; list: object[] } {
  const hit = cache.get(statics.defs);
  if (hit && hit.statics.shore === statics.shore) return hit;
  const ids = staticIds(statics);
  const list = [...ids.keys()];
  const entry = { statics, ids, list };
  cache.set(statics.defs, entry);
  return entry;
}

function children(o: object): unknown[] {
  if (ArrayBuffer.isView(o)) return [];
  if (o instanceof Map) return [...o.entries()].flat();
  if (o instanceof Set) return [...o];
  return Object.keys(o).map((k) => (o as Record<string, unknown>)[k]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Encoding. Plain values are JSON as they are; anything else is an object with one tag key:
//   {$u: 1}                     undefined (kept, so a restored object has the same keys)
//   {$n: 'NaN' | '-0' | ...}    a number JSON cannot hold
//   {$s: i}                     the i-th static object
//   {$r: i}                     the object given id i earlier in the walk
//   {$o: obj, $i?: i}           a plain object (its keys may start with $, so they sit one level down)
//   {$a: [...], $i?: i}         an array
//   {$c: 'Rng', v: {...}, $i?}  an instance of a known class, a Map ([k, v, ...]) or a Set
//   {$t: 'Uint8Array', d: b64, $i?}
// $i is only written for objects reached more than once.

/** Encodes a match (or any part of one) into JSON-safe data. */
export function encode(root: unknown, statics: Statics): unknown {
  const { ids: fixed } = staticsFor(statics);
  // First pass: count how often each object is reached, so only shared ones carry an id.
  const seen = new Map<object, number>();
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v !== 'object' || v === null || fixed.has(v)) continue;
    const n = seen.get(v) ?? 0;
    seen.set(v, n + 1);
    if (n === 0) for (const c of children(v)) stack.push(c);
  }
  const ids = new Map<object, number>();
  const write = (v: unknown): unknown => {
    if (v === undefined) return { $u: 1 };
    if (typeof v === 'number') {
      if (Number.isFinite(v) && !Object.is(v, -0)) return v;
      return { $n: Object.is(v, -0) ? '-0' : String(v) };
    }
    if (typeof v !== 'object' || v === null) {
      if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') throw new Error(`Cannot snapshot a ${typeof v}`);
      return v;
    }
    const s = fixed.get(v);
    if (s !== undefined) return { $s: s };
    const id = ids.get(v);
    if (id !== undefined) return { $r: id };
    const shared = (seen.get(v) ?? 0) > 1;
    let out: Record<string, unknown>;
    if (shared) ids.set(v, ids.size);
    const name = className(v);
    if (name && name in TYPED) {
      const t = v as TypedArray;
      out = { $t: name, d: bytesToBase64(new Uint8Array(t.buffer, t.byteOffset, t.byteLength)) };
    } else if (Array.isArray(v)) {
      out = { $a: v.map(write) };
    } else if (name) {
      out = { $c: name, v: name === 'Map' || name === 'Set' ? children(v).map(write) : writeFields(v) };
    } else {
      out = { $o: writeFields(v) };
    }
    if (shared) out.$i = ids.get(v);
    return out;
  };
  const writeFields = (o: object): Record<string, unknown> => {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(o)) r[k] = write((o as Record<string, unknown>)[k]);
    return r;
  };
  return write(root);
}

/** Restores data written by encode. */
export function decode(data: unknown, statics: Statics): unknown {
  const { list } = staticsFor(statics);
  const ids = new Map<number, unknown>();
  const read = (d: unknown): unknown => {
    if (typeof d !== 'object' || d === null) return d;
    const t = d as Record<string, unknown>;
    if ('$u' in t) return undefined;
    if ('$n' in t) return t.$n === '-0' ? -0 : Number(t.$n);
    if ('$s' in t) {
      const s = list[t.$s as number];
      if (!s) throw new Error('Snapshot refers to static data this client does not have; reload the assets');
      return s;
    }
    if ('$r' in t) {
      if (!ids.has(t.$r as number)) throw new Error('Bad snapshot reference');
      return ids.get(t.$r as number);
    }
    const keep = <T>(v: T): T => {
      if (typeof t.$i === 'number') ids.set(t.$i, v);
      return v;
    };
    if ('$t' in t) {
      const bytes = base64ToBytes(t.d as string);
      const C = TYPED[t.$t as string];
      if (!C) throw new Error(`Unknown typed array ${String(t.$t)}`);
      const arr = new C(0).constructor as unknown as { new (b: ArrayBuffer): TypedArray };
      return keep(new arr(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    }
    if ('$a' in t) {
      const arr = keep([] as unknown[]);
      for (const e of t.$a as unknown[]) arr.push(read(e));
      return arr;
    }
    if ('$c' in t) {
      const name = t.$c as string;
      if (name === 'Map') {
        const m = keep(new Map<unknown, unknown>());
        const flat = t.v as unknown[];
        for (let i = 0; i < flat.length; i += 2) m.set(read(flat[i]), read(flat[i + 1]));
        return m;
      }
      if (name === 'Set') {
        const s = keep(new Set<unknown>());
        for (const e of t.v as unknown[]) s.add(read(e));
        return s;
      }
      const c = CLASSES[name];
      if (!c) throw new Error(`Unknown class ${name} in snapshot`);
      const o = keep(Object.create(c.prototype) as Record<string, unknown>);
      for (const [k, v] of Object.entries(t.v as Record<string, unknown>)) o[k] = read(v);
      return o;
    }
    if ('$o' in t) {
      const o = keep({} as Record<string, unknown>);
      for (const [k, v] of Object.entries(t.$o as Record<string, unknown>)) o[k] = read(v);
      return o;
    }
    throw new Error('Bad snapshot data');
  };
  return read(data);
}

/** The whole match, ready to send as JSON. */
export function snapshotMatch(m: Match): Snapshot {
  return { version: SNAPSHOT_VERSION, tick: m.tick, data: encode(m, staticsOf(m)) };
}

/** Rebuilds a match from a snapshot, sharing the given building table and shoreline shapes. */
export function restoreMatch(s: Snapshot, statics: Statics): Match {
  if (s.version !== SNAPSHOT_VERSION) throw new Error(`Snapshot version ${s.version}, expected ${SNAPSHOT_VERSION}`);
  return decode(s.data, statics) as Match;
}

export function staticsOf(m: Match): Statics {
  return { defs: m.world.defs, shore: m.world.shore };
}

// Hashing: FNV-1a over the same walk, 32-bit, integers only. Numbers go in as their 64-bit float bytes, so -0, a
// stray fraction or NaN changes the hash just as it would change the game.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const FNV_PRIME = 0x01000193;

function mixWord(h: number, w: number): number {
  h = Math.imul(h ^ (w & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((w >>> 8) & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((w >>> 16) & 0xff), FNV_PRIME);
  return Math.imul(h ^ (w >>> 24), FNV_PRIME);
}

function mixString(h: number, s: string): number {
  h = mixWord(h, s.length);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), FNV_PRIME);
  return h;
}

/**
 * A 32-bit digest of a match's state. Two matches that will play out the same hash the same, and any difference
 * anywhere in them (a unit of speed, an rng step, one tile of terrain) almost surely changes it.
 */
export function hashMatch(m: Match): number {
  const { ids: fixed } = staticsFor(staticsOf(m));
  const seen = new Map<object, number>();
  let h = 0x811c9dc5;
  const visit = (v: unknown): void => {
    switch (typeof v) {
      case 'number':
        f64[0] = v;
        h = mixWord(mixWord(h, u32[0]!), u32[1]!);
        return;
      case 'string':
        h = mixString(Math.imul(h ^ 2, FNV_PRIME), v);
        return;
      case 'boolean':
        h = Math.imul(h ^ (v ? 3 : 4), FNV_PRIME);
        return;
      case 'undefined':
        h = Math.imul(h ^ 5, FNV_PRIME);
        return;
      case 'object':
        break;
      default:
        throw new Error(`Cannot hash a ${typeof v}`);
    }
    if (v === null) {
      h = Math.imul(h ^ 6, FNV_PRIME);
      return;
    }
    const s = fixed.get(v);
    if (s !== undefined) {
      h = mixWord(Math.imul(h ^ 7, FNV_PRIME), s);
      return;
    }
    const id = seen.get(v);
    if (id !== undefined) {
      h = mixWord(Math.imul(h ^ 8, FNV_PRIME), id);
      return;
    }
    seen.set(v, seen.size);
    if (ArrayBuffer.isView(v)) {
      const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      h = mixWord(Math.imul(h ^ 9, FNV_PRIME), b.length);
      for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, FNV_PRIME);
      return;
    }
    if (Array.isArray(v)) {
      h = mixWord(Math.imul(h ^ 10, FNV_PRIME), v.length);
      for (const e of v) visit(e);
      return;
    }
    h = Math.imul(h ^ 11, FNV_PRIME);
    if (v instanceof Map || v instanceof Set) {
      for (const e of children(v)) visit(e);
      return;
    }
    for (const k of Object.keys(v)) {
      h = mixString(h, k);
      visit((v as Record<string, unknown>)[k]);
    }
  };
  // The events list is what last tick told the client; it never feeds back into the sim.
  const { events: _events, ...state } = m;
  visit(state);
  return h >>> 0;
}

/** How often (in ticks) clients send the server their state hash. */
export const HASH_EVERY = 30;
