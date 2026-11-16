// The modern view's vehicles, soldiers, drones, the submarine and the shots: moulded plastic toys in the army-men
// style, built from simple shapes and sized to the art pack's models so they cover the same ground. A side's toys
// are moulded in its own colour all over (tracks, guns, rotors and seats in a deep shade of it), with black rubber
// tyres, tinted clear canopies and printed white stars. Each faces north (-y) at heading 0. Parts that move on their
// own (turret, launcher, rotor, wheels) are kits of their own, turned by the renderer.

import * as THREE from 'three';
import { Kit, type Paint } from './kit.js';

const TRACK: Paint = 'teamDeep';
const TRACK_LIGHT: Paint = 'teamDark';
const METAL: Paint = 'teamDark';
const GUNMETAL: Paint = 'teamDeep';
const BLADE: Paint = 'teamDeep';
const TYRE: Paint = 'rubber';
const HUB: Paint = 'teamLight';
const GLASS = 0x9fd6ea;
const SEAT: Paint = 'teamDeep';
const WHITE = 0xf2f2ee;
/** The printed markings. */
const PRINT = 0xeeeee6;

export interface VehicleKits {
  body: Kit;
  /** Tank turret, turned by the turret angle about (0, 0). */
  turret?: Kit;
  /** Tank barrel or ASV launcher, pitched about its pivot, which sits at pivot (y, z) on the turret or body. */
  barrel?: Kit;
  pivot?: [number, number];
  /** Helicopter main rotor, spun about (0, 0) at its own height. */
  rotor?: Kit;
  rotorAt?: [number, number, number];
  /** Helicopter tail rotor, spun about the east-west axis at its point. */
  tail?: Kit;
  tailAt?: [number, number, number];
  /** Jeep wheels, each at its point; the renderer scales them up as the tyres blow up. */
  wheels?: Kit;
  wheelAt?: [number, number, number][];
}

export function tank(): VehicleKits {
  const body = new Kit(true);
  for (const s of [-1, 1]) {
    body.box(s * 9, 0, 0, 6, 25, 4.5, TRACK);
    body.box(s * 9, 0, 4.5, 6.4, 24, 0.8, 'teamDark');
    for (let i = 0; i < 4; i++) body.axle(s * 9.3, -8 + i * 5.4, 2.2, 1.9, 6.2, TRACK_LIGHT, 8);
  }
  body.box(0, 1, 1.5, 12, 20, 4, 'team');
  body.wedge(0, -10.5, 1.5, 12, 3, 4, 1.6, 'team');
  body.box(0, 9.5, 2, 10, 2.5, 3.2, 'teamDark');
  body.box(-3.5, 10.6, 3, 2, 1, 1.4, 0xd8c070).box(3.5, 10.6, 3, 2, 1, 1.4, 0xd8c070);
  body.star(0, 7.2, 5.5, 2, PRINT);
  const turret = new Kit(true);
  turret.cyl(0, 0, 5.5, 4.2, 5.2, 3.8, 'team', 8);
  turret.box(0, 1.5, 5.6, 7, 6, 3.4, 'teamDark');
  turret.cyl(1.8, 1.8, 9.3, 1.4, 1.6, 1, 'teamLight', 8);
  turret.box(-2.6, 3.5, 9.2, 0.4, 0.4, 3.5, GUNMETAL);
  const barrel = new Kit(true);
  barrel.tube(0, -6.5, 0, 1.25, 11, METAL, 8);
  barrel.tube(0, -12, 0, 1.6, 2, GUNMETAL, 8);
  barrel.box(0, -1.5, -1, 3, 3, 2, 'teamDark');
  return { body, turret, barrel, pivot: [-3.5, 7.5] };
}

export function jeep(): VehicleKits {
  const body = new Kit(true);
  body.box(0, 1, 2.6, 10, 18, 3.6, 'team');
  body.wedge(0, -9, 2.6, 10, 4, 3.6, 2.6, 'team');
  body.box(0, -9.5, 2.6, 8.4, 1, 2.2, GUNMETAL);
  body.star(0, -6.3, 6.2, 1.6, PRINT);
  body.box(-3.2, -10.8, 3.6, 2, 0.4, 1, 0xfff4b0).box(3.2, -10.8, 3.6, 2, 0.4, 1, 0xfff4b0);
  // Windscreen frame and glass.
  body.box(0, -4.5, 6.2, 9.4, 0.6, 3.4, 'teamDark', { tilt: 0.35 });
  body.box(0, -4.6, 6.4, 8.2, 0.3, 2.8, GLASS, { tilt: 0.35 });
  body.box(-2.4, -1, 6.2, 3.4, 3.4, 1, SEAT).box(2.4, -1, 6.2, 3.4, 3.4, 1, SEAT);
  body.box(0, 5, 6.2, 8, 4, 1, SEAT);
  // Roll bar and spare.
  for (const s of [-1, 1]) body.box(s * 4.6, 3, 6.2, 0.7, 0.7, 5.6, GUNMETAL);
  body.box(0, 3, 11.6, 9.9, 0.7, 0.7, GUNMETAL);
  body.axle(0, 10.6, 5, 2.4, 1.6, TYRE, 10, { turn: Math.PI / 2 });
  const wheels = new Kit(true);
  wheels.axle(0, 0, 0, 2.9, 2.2, TYRE, 12);
  wheels.axle(0, 0, 0, 1.4, 2.4, HUB, 8);
  return { body, wheels, wheelAt: [[-5.4, -6.5, 2.9], [5.4, -6.5, 2.9], [-5.4, 7, 2.9], [5.4, 7, 2.9]] };
}

export function asv(): VehicleKits {
  const body = new Kit(true);
  for (const s of [-1, 1]) {
    body.box(s * 9.5, 0, 0, 5, 24, 4, TRACK);
    for (let i = 0; i < 3; i++) body.axle(s * 9.8, -7.5 + i * 7.5, 2.4, 2.4, 5.4, TRACK_LIGHT, 10);
  }
  body.box(0, 1.5, 2, 15, 21, 5, 'team');
  body.wedge(0, -10.5, 2, 15, 3, 5, 2.4, 'team');
  body.box(-3.5, -6.5, 7, 6, 5, 2.4, 'teamDark');
  body.box(-3.5, -9.1, 7.6, 4.6, 0.3, 1.3, GLASS);
  body.box(4, 5, 7, 6, 8, 1.6, 'teamDark');
  body.star(4, -4.5, 7, 2, PRINT);
  const barrel = new Kit(true);
  // Three missile tubes in a frame, pitched about the pivot at the back of the launcher.
  barrel.box(0, -5, 0, 11, 10, 1.2, 'teamDark');
  for (let i = -1; i <= 1; i++) {
    barrel.tube(i * 3.4, -5, 2.6, 1.5, 11, METAL, 8);
    barrel.tube(i * 3.4, -10.7, 2.6, 1.1, 0.6, 0xd04030, 8);
  }
  return { body, barrel, pivot: [6, 7.5] };
}

export function heli(): VehicleKits {
  const body = new Kit(true);
  body.ball(0, -5, 6.5, 7.4, 'team', 1, 0.85);
  body.ball(0, -9.5, 7.6, 5.2, GLASS, 1, 0.8);
  body.box(0, 2, 3.2, 9, 8, 6.5, 'team');
  body.tube(0, 16, 8, 2.6, 25, 'team', 8, undefined, 1.4);
  body.box(0, 28.5, 8, 0.9, 5, 7, 'teamDark', { tilt: -0.3 });
  body.box(0, 27, 8.5, 9, 3, 0.7, 'teamDark');
  body.cyl(0, 0, 9.5, 2.2, 3, 2.2, GUNMETAL, 8);
  // Stub wings with a rocket pod and a gun each side.
  for (const s of [-1, 1]) {
    body.box(s * 7, 0, 5.5, 6, 3.4, 0.8, 'teamDark');
    body.star(s * 7.4, 0, 6.3, 1.4, PRINT);
    body.tube(s * 9.5, -0.5, 5, 1.6, 7, GUNMETAL, 8);
    body.tube(s * 9.5, -4.4, 5, 1, 1.2, 0x2a2a2a, 8);
    body.box(s * 5, 1, 0.3, 1, 18, 0.8, GUNMETAL);
    body.box(s * 5, -5, 0.3, 1, 1, 3.2, GUNMETAL).box(s * 5, 6, 0.3, 1, 1, 3.2, GUNMETAL);
  }
  const rotor = new Kit(true);
  rotor.cyl(0, 0, -0.6, 1.4, 1.4, 1.4, GUNMETAL, 8);
  // Each blade runs out from the hub; a shape turns about its own centre, so place the centre along the blade's line.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    rotor.box(Math.sin(a) * 13.5, -Math.cos(a) * 13.5, 0, 2.6, 27, 0.4, BLADE, { turn: a });
  }
  const tail = new Kit(true);
  // Two blades crossed about the hub, centred on it.
  for (let i = 0; i < 2; i++) tail.add(new THREE.BoxGeometry(0.4, 7, 1.2), 0, 0, 0, BLADE, { tilt: (i * Math.PI) / 2 });
  return { body, rotor, rotorAt: [0, 0, 12], tail, tailAt: [1.2, 30, 11] };
}

export function drone(): VehicleKits {
  const body = new Kit(true);
  body.ball(0, 0, 1.8, 5, 'team', 1, 0.7);
  body.box(0, 6, 1.5, 2, 10, 2, 'teamDark');
  body.box(0, 11, 2, 5, 1, 0.6, 'teamDark');
  for (const s of [-1, 1]) body.box(s * 4, 0, -1.5, 0.8, 9, 0.8, GUNMETAL);
  const barrel = new Kit(true);
  barrel.box(0, 0, -1, 3, 4, 2.4, GUNMETAL);
  barrel.tube(0, -4, -0.2, 0.7, 5, METAL, 6);
  const rotor = new Kit(true);
  for (let i = 0; i < 2; i++) rotor.box(0, 0, 0, 1.8, 30, 0.3, BLADE, { turn: (i * Math.PI) / 2 });
  return { body, barrel, pivot: [-3, 0], rotor, rotorAt: [0, 0, 6] };
}

/** The submarine that hunts a helicopter off the map: a long hull with a conning tower, facing north. */
export function submarine(): Kit {
  const k = new Kit(true);
  k.tube(0, 0, 0, 9, 90, 0x3d4a55, 12, undefined, 9);
  k.ball(0, -45, 0, 9, 0x3d4a55, 1, 1);
  k.tube(0, 48, 0, 9, 10, 0x3d4a55, 12, undefined, 4);
  k.box(0, -8, 4, 7, 20, 13, 0x33404a);
  k.box(0, -12, 17, 5, 6, 3, 0x2b353d);
  k.box(0, -8, 9, 22, 4, 0.8, 0x33404a);
  k.box(0, 52, 0, 18, 3, 0.8, 0x33404a);
  k.box(0, 52, -6, 0.8, 3, 12, 0x33404a);
  return k;
}

/** Shots: the tracer and shell glow, the missiles carry a flame; the renderer adds the glow sprites. */
export function shot(kind: 'tracer' | 'shell' | 'missile' | 'big'): Kit {
  const k = new Kit(true);
  if (kind === 'tracer') k.tube(0, 0, 0, 0.6, 5, 0xfff1a0, 6);
  else if (kind === 'shell') k.tube(0, 0, 0, 1, 3.2, 0x5a5a50, 6, undefined, 0.6);
  else {
    const r = kind === 'big' ? 1.8 : 1.1;
    k.tube(0, 1, 0, r, 8, WHITE, 6);
    k.tube(0, -3.8, 0, r, 1.6, 0xd03a2a, 6, undefined, 0.2);
    for (let i = 0; i < 2; i++) k.box(0, 4.2, 0, r * 4, 1.4, 0.3, 0x707070, { roll: (i * Math.PI) / 2 });
  }
  return k;
}

/** A soldier: a little army man moulded in the side's colour (trousers, helmet and rifle in its deep shade), his arms and legs swinging with his walk. */
export function soldier(stride: number): Kit {
  const k = new Kit(true);
  const leg = Math.sin(stride) * 0.6;
  k.box(-0.8, leg, 0, 1.2, 1.4, 3, 'teamDeep').box(0.8, -leg, 0, 1.2, 1.4, 3, 'teamDeep');
  k.box(0, 0, 3, 3, 1.8, 3.2, 'team');
  k.box(-1.9, -leg, 3.4, 0.8, 1, 2.6, 'teamDark').box(1.9, leg, 3.4, 0.8, 1, 2.6, 'teamDark');
  k.ball(0, 0, 7, 1.2, 'team', 1);
  k.ball(0, 0, 7.6, 1.45, 'teamDeep', 1, 0.6);
  k.box(1.4, -1.6, 4.5, 0.4, 3.6, 0.5, 'teamDeep');
  // The moulded base army men stand on.
  k.cyl(0, 0, -0.4, 2.4, 2.4, 0.4, 'team', 12);
  return k;
}

/** A man swimming: head, shoulders and arms at the water line. */
export function swimmer(stroke: number): Kit {
  const k = new Kit(true);
  k.box(0, 0.5, -0.6, 3, 2, 1, 'team');
  k.ball(0, -1.2, 0.4, 1.2, 'team', 1);
  k.ball(0, -1.2, 1, 1.4, 'teamDeep', 1, 0.6);
  const a = Math.sin(stroke) * 1.5;
  k.box(-2, a - 1, 0, 0.8, 2.4, 0.6, 'team').box(2, -a - 1, 0, 0.8, 2.4, 0.6, 'team');
  return k;
}

/** The lift's platform and the doors over the shaft, coloured for the base. */
export function liftPlatform(): Kit {
  const k = new Kit(true);
  k.box(0, 0, -1.5, 30, 30, 1.5, METAL);
  k.box(0, 0, 0, 26, 26, 0.6, 'teamDark');
  // Tread plates across the deck.
  for (let i = -2; i <= 2; i++) k.box(i * 5, 0, 0.6, 1.2, 24, 0.12, 0x3a3d42);
  for (const s of [-1, 1]) k.box(s * 14, 0, 0, 1.4, 30, 0.6, 0xe0b81c).box(0, s * 14, 0, 30, 1.4, 0.6, 0xe0b81c);
  return k;
}

export function liftShaft(): Kit {
  const k = new Kit(true);
  const d = 40;
  for (const s of [-1, 1]) {
    k.box(s * 14.5, 0, -d, 1, 30, d, 0x2a2c30);
    k.box(0, s * 14.5, -d, 30, 1, d, 0x34373c);
  }
  k.box(0, 0, -d - 1, 30, 30, 1, 0x1c1d20);
  return k;
}

/**
 * One of the hatch's two doors, from the middle of the shaft at x = 0 out to x = 16: a steel plate with hazard
 * stripes, a lip along the edge where it meets the other, and runners underneath.
 */
export function liftDoor(): Kit {
  const k = new Kit(true);
  k.box(8, 0, 0, 16, 32, 0.8, 0x4b5057);
  for (let i = -3; i <= 3; i++) k.box(8.6, i * 4.5, 0.8, 14, 1.6, 0.12, i & 1 ? 0xe0b81c : 0x202020);
  k.box(0.6, 0, 0.8, 1.2, 32, 0.2, 0xe0b81c);
  for (const y of [-12, 12]) k.box(8, y, -0.6, 15, 1.2, 0.6, 0x2a2c30);
  return k;
}

/** A beacon at a corner of the lift's shaft, turned on while the lift moves: a dark housing under an amber lens. */
export function liftBeacon(): Kit {
  const k = new Kit(true);
  k.cyl(0, 0, 0, 1.1, 1.3, 0.9, 0x2a2c30, 10);
  k.cyl(0, 0, 0.9, 0.9, 1, 1.2, 0xc88a20, 10);
  return k;
}
