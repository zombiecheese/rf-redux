// The original's explosion scripts (the Expl class, VA 0x44bb70). An explosion runs its definition's script once a
// tick (sub_42dbe0): the first think sets its clock to 1.0, each later one adds the definition's rate, and it is gone
// once the clock reaches the duration. The script runs until it yields or waits for a later frame.
//
// The client draws every explosion. The match runs only those made by destroyed buildings (sub_42e6a0), because
// their scripts change the map: when a building is destroyed with an explosion, it stays standing, with no hit
// points left, until its script swaps in the rubble. Their ops that touch the map (the jump table at 0x44bae0):
// - tile (sub_42d3a0): the tile becomes what its building becomes (sub_42e600).
// - neighbour dx dy a b (sub_42d3f0): the tile dx across and one row up or down (by the sign of dy) turns from
//   building a into b, at full hit points (sub_42e4f0). This is how walls next to a destroyed one show the break.
// - edge dx dy a (sub_42d850): that tile, if it holds building a, is hit for 255.
// - corner dx dy t (sub_42d8d0): that tile, if its terrain is t, is hit for 255. Walls use it to bring down the
//   gates beside them (terrain 88 and 89).
// - rubble n (sub_42d9f0): the building goes now, and what it becomes appears n ticks later (sub_42da50).
// - turn a o (sub_42da90): if the tile holds building a, its owner bits become o. Fuel depots use it before
//   becoming rubble.
// The other ops (sounds, models, debris, damage areas) are the client's.

import type { Rng } from './rng.js';

/** One step of a script, as exported by tools/convert_assets.py (EXPL_OPS); branch and pick hold nested ops. */
export type ExplosionOp = [string, ...(number | string | ExplosionOp[])[]];

/** The parts of an explosion definition its script needs. Times are 16.16, one frame per 1.0. */
export interface ExplosionScript {
  duration: number;
  /** Time added a tick. */
  rate: number;
  script: ExplosionOp[];
}

export interface ScriptState {
  /** Its clock (+0x64). */
  t: number;
  ops: readonly ExplosionOp[];
  pc: number;
  /** The object's +0x8, whose bit 0 decides branches. */
  variant: number;
}

/** The first think (flag 0x40 at +0xc). */
export function startScript(s: ScriptState, act: (op: ExplosionOp) => void, rng: Pick<Rng, 'below'>): void {
  s.t = 0x10000;
  runScript(s, act, rng);
}

/** One later think: false once the explosion is over. */
export function stepScript(s: ScriptState, def: ExplosionScript, act: (op: ExplosionOp) => void, rng: Pick<Rng, 'below'>): boolean {
  if (s.t >= def.duration) return false;
  s.t += def.rate;
  if (s.t >= def.duration) return false;
  runScript(s, act, rng);
  return true;
}

/**
 * Runs the script until it yields, waits for a later frame, or ends, handing every op that is not control flow to
 * act. chance n p r (sub_42d540) skips the next n ops when a roll below r comes up under p; pick (sub_42d950)
 * runs one of its ops.
 */
export function runScript(s: ScriptState, act: (op: ExplosionOp) => void, rng: Pick<Rng, 'below'>): void {
  for (;;) {
    const op = s.ops[s.pc];
    if (!op) return;
    switch (op[0]) {
      case 'yield':
        s.pc++;
        return;
      case 'wait':
        if (s.t < (op[1] as number) * 0x10000) return;
        break;
      case 'time':
        s.t = (((op[1] as number) << 16) | (s.t & 0xffff)) >>> 0;
        break;
      case 'branch':
        if (!(s.variant & 1)) {
          s.ops = op[1] as ExplosionOp[];
          s.pc = 0;
          continue;
        }
        break;
      case 'chance':
        if (rng.below(op[3] as number) < (op[2] as number)) s.pc += op[1] as number;
        break;
      case 'pick': {
        const choices = op[1] as ExplosionOp[];
        if (choices.length) act(choices[rng.below(choices.length)]!);
        break;
      }
      default:
        act(op);
    }
    s.pc++;
  }
}

/** A destroyed building's explosion, run by the match. */
export interface BuildingExplosion extends ScriptState {
  tile: number;
  def: ExplosionScript;
}

/** A building gone by a rubble op, and when what it becomes appears. */
export interface Rubble {
  tile: number;
  building: number;
  owner: number;
  at: number;
}
