// On-screen controls for phones and tablets, drawn as see-through pixel buttons over the camo either side of the
// panel: a stick that comes to wherever the left thumb lands and points the vehicle the way to go, and on the right the buttons the vehicle in play
// actually has (the tank's turret, the jeep's tyres and flag, the ASV's mines, the helicopter's strafe and weapon
// swap), the four launch buttons on the lift screen, and pause, chat and the scores along the top. Each control
// presses the same key a keyboard player would (the left half's, as rebound in Options > Controls > Vehicle Keys), so the game
// and menus handle touch exactly like the keyboard.

import { ANGLE_MASK, FIXED_SHIFT, YAW_DOWN } from '@rfw/sim';
import { ONLINE_KEYS, SHORTCUTS, touchKey, type Action } from './keys.js';

/** What the controls are showing for: the lift screen, a vehicle, watching a match online, or nothing to steer. */
export type TouchMode = 'bunker' | 'jeep' | 'tank' | 'asv' | 'heli' | 'watch' | 'idle';

/** Keys a control can press besides the play keys: pause, and online the chat line, the scores and following a player. */
type Extra = 'pause' | 'chat' | 'scores' | 'follow1' | 'follow2' | 'follow3' | 'follow4';
type Press = Action | Extra;

/** One on-screen button: its label, the key (or keys, pressed together) it holds, its look and when it shows. */
export interface TouchButton {
  label: string;
  press: Press[];
  cls: string;
  modes: TouchMode[];
}

const DRIVING: TouchMode[] = ['jeep', 'tank', 'asv', 'heli'];

/**
 * Every button. The right-hand cluster follows the sim's buttons for each vehicle (match.ts): Fire for all; the
 * second button floats the jeep's tyres, fires the tank's and the ASV's gun raised at aircraft and fires the
 * helicopter's weapon straight ahead; the third puts down or picks up the jeep's flag, lays the ASV's mines and
 * swaps the helicopter between gun and missiles. The turret keys swing the tank's turret (both centre it) and
 * strafe the helicopter.
 */
export const TOUCH_BUTTONS: TouchButton[] = [
  { label: 'Jeep', press: ['launchJeep'], cls: 'top', modes: ['bunker'] },
  { label: 'Tank', press: ['launchTank'], cls: 'top', modes: ['bunker'] },
  { label: 'ASV', press: ['launchAsv'], cls: 'top', modes: ['bunker'] },
  { label: 'Heli', press: ['launchHeli'], cls: 'top', modes: ['bunker'] },
  { label: 'Dock', press: ['dock'], cls: 'top', modes: DRIVING },
  { label: 'P1', press: ['follow1'], cls: 'top', modes: ['watch'] },
  { label: 'P2', press: ['follow2'], cls: 'top', modes: ['watch'] },
  { label: 'P3', press: ['follow3'], cls: 'top', modes: ['watch'] },
  { label: 'P4', press: ['follow4'], cls: 'top', modes: ['watch'] },
  { label: 'Chat', press: ['chat'], cls: 'top online', modes: ['bunker', ...DRIVING, 'watch', 'idle'] },
  { label: 'Scores', press: ['scores'], cls: 'top online', modes: ['bunker', ...DRIVING, 'watch', 'idle'] },
  { label: '❚❚', press: ['pause'], cls: 'top offline', modes: ['bunker', ...DRIVING, 'watch', 'idle'] },

  { label: 'Launch', press: ['fire'], cls: 'fire', modes: ['bunker'] },
  { label: 'Fire', press: ['fire'], cls: 'fire', modes: DRIVING },
  { label: 'Tyres', press: ['fire2'], cls: 'b2', modes: ['jeep'] },
  { label: 'Flag', press: ['fire3'], cls: 'b3', modes: ['jeep'] },
  { label: 'AA', press: ['fire2'], cls: 'b2', modes: ['tank', 'asv'] },
  { label: 'Mine', press: ['fire3'], cls: 'b3', modes: ['asv'] },
  { label: 'Ahead', press: ['fire2'], cls: 'b2', modes: ['heli'] },
  { label: 'Swap', press: ['fire3'], cls: 'b3', modes: ['heli'] },
  { label: '◀', press: ['turretLeft'], cls: 'turn left', modes: ['tank', 'heli'] },
  { label: '●', press: ['turretLeft', 'turretRight'], cls: 'turn centre', modes: ['tank'] },
  { label: '▶', press: ['turretRight'], cls: 'turn right', modes: ['tank', 'heli'] },
];

/** The modes the stick is out for: steering a vehicle. On the lift screen the bays are tapped instead (game.ts). */
export const STICK_MODES: TouchMode[] = [...DRIVING];

/**
 * The controls for the player this browser steers: P1-P4 while watching (a spectator, or a player whose base is out),
 * none while launching, docking or under the skull.
 */
export function touchModeFor(state: string | null, kind: string | null): TouchMode {
  if (state === null || state === 'out') return 'watch';
  if (state === 'bunker') return 'bunker';
  if (state === 'driving' && kind && (DRIVING as string[]).includes(kind)) return kind as TouchMode;
  return 'idle';
}

/** The key behind a control, looked up as it is pressed so a rebinding takes effect at once. */
function codeFor(p: Press): string {
  switch (p) {
    case 'pause': return SHORTCUTS.find((s) => s.id === 'pause')!.code;
    case 'chat': return ONLINE_KEYS.chat;
    case 'scores': return ONLINE_KEYS.scoreboard;
    case 'follow1': case 'follow2': case 'follow3': case 'follow4': return ONLINE_KEYS.follow[Number(p.slice(-1)) - 1]!;
    default: return touchKey(p);
  }
}

function key(type: 'keydown' | 'keyup', code: string): void {
  dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

/** A button that holds its keys down while touched; sliding off it lets go. */
function button(def: TouchButton): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `touch-btn ${def.cls} ${def.modes.map((m) => `for-${m}`).join(' ')}`;
  b.textContent = def.label;
  b.tabIndex = -1;
  let codes: string[] = [];
  const release = () => {
    if (!codes.length) return;
    b.classList.remove('down');
    for (const c of codes) key('keyup', c);
    codes = [];
  };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    release();
    codes = def.press.map(codeFor);
    b.classList.add('down');
    for (const c of codes) key('keydown', c);
  });
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('lostpointercapture', release);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

/** What the stick steers: the heading of the player's vehicle and, for the helicopter, the turn it is still carrying. */
export interface Steered {
  heading: number;
  yaw: number;
}

/** The keys the stick holds: the turn (-1 left, 1 right) and whether to drive forward. */
export interface Steer {
  turn: -1 | 0 | 1;
  forward: boolean;
}

const STEPS = ANGLE_MASK + 1;
const STEP = 1 << FIXED_SHIFT;
/** It drives on while the vehicle faces within this many of the 64 headings of the stick (45 degrees); further round, it turns on the spot first. */
const DRIVE_WITHIN = 8;
/** A turn starts once the heading is this far (in headings) from the middle of the one the stick points along, and stops inside it. */
const START_TURN = 1;

/**
 * Directional steering: the stick points the way to go on screen (up is north, as the camera always looks), and
 * this works out the keys a keyboard player would hold to get there, so the sim, replays and online play see
 * nothing new. The vehicle turns the short way round until it faces along the stick, driving forward once it is
 * near enough, and turns on the spot when the stick points well away from it. Movement goes by the 64 headings of
 * the sine table, so it aims for the middle of the heading the stick is nearest. The helicopter's turn carries on
 * after the key is let go, so it lets go early by as much as it will still turn.
 */
export function steer(dx: number, dy: number, v: Steered, turning: -1 | 0 | 1 = 0): Steer {
  const angle = (Math.atan2(dx, -dy) / (Math.PI * 2)) * 64;
  const target = (((Math.round(angle) % 64) + 64) % 64) + 0.5;
  const heading = (v.heading & ANGLE_MASK) / STEP;
  let diff = target - heading;
  if (diff > 32) diff -= 64;
  if (diff < -32) diff += 64;
  const coast = v.yaw ? (v.yaw * Math.abs(v.yaw)) / (2 * YAW_DOWN) / STEP : 0;
  const left = diff - coast;
  // A turn under way runs on until the heading (where it will come to rest) is the stick's; a new one waits until
  // the heading is a step off, so a nudge of the vehicle does not set it hunting.
  const rest = Math.floor((((heading + coast) % 64) + 64) % 64);
  const going = turning !== 0 && Math.sign(left) === turning ? rest !== target - 0.5 : Math.abs(left) > START_TURN;
  const turn = going ? (left > 0 ? 1 : -1) : 0;
  return { turn, forward: Math.abs(diff) <= DRIVE_WITHIN };
}

let steered: Steered | null = null;
let restick: (() => void) | null = null;

/** The vehicle the stick steers, or null when there is none (game.ts calls it every frame). */
export function setTouchVehicle(v: Steered | null): void {
  const same = v === null ? steered === null : steered !== null && steered.heading === v.heading && steered.yaw === v.yaw;
  if (same) return;
  steered = v ? { heading: v.heading, yaw: v.yaw } : null;
  restick?.();
}

/**
 * The stick: a thumb landing anywhere in the left-hand zone brings the stick to it, and the way it is pushed is the
 * way the vehicle goes (see steer()), with a dead zone in the middle. Let go and it goes back to its resting place
 * and the vehicle coasts to a stop.
 */
function stick(): HTMLElement {
  const zone = document.createElement('div');
  zone.className = 'touch-zone';
  const pad = document.createElement('div');
  pad.className = 'touch-stick';
  const knob = document.createElement('div');
  knob.className = 'touch-knob';
  pad.append(knob);
  zone.append(pad);
  const held = new Set<string>();
  const set = (codes: string[]) => {
    for (const c of held) if (!codes.includes(c)) key('keyup', c);
    for (const c of codes) if (!held.has(c)) key('keydown', c);
    held.clear();
    codes.forEach((c) => held.add(c));
  };
  let origin: { x: number; y: number; id: number } | null = null;
  let aim: { dx: number; dy: number } | null = null;
  let turning: -1 | 0 | 1 = 0;
  const update = () => {
    if (!aim || !steered) {
      turning = 0;
      set([]);
      return;
    }
    const s = steer(aim.dx, aim.dy, steered, turning);
    turning = s.turn;
    const codes: string[] = [];
    if (s.forward) codes.push(codeFor('up'));
    if (s.turn < 0) codes.push(codeFor('left'));
    if (s.turn > 0) codes.push(codeFor('right'));
    set(codes);
  };
  restick = update;
  zone.addEventListener('pointerdown', (e) => {
    if (origin) return;
    e.preventDefault();
    zone.setPointerCapture(e.pointerId);
    // Centre the stick under the thumb, kept whole inside the zone.
    const z = zone.getBoundingClientRect();
    const half = pad.offsetWidth / 2;
    const x = Math.min(Math.max(e.clientX, z.left + half), z.right - half);
    const y = Math.min(Math.max(e.clientY, z.top + half), z.bottom - half);
    pad.style.left = `${x - z.left - half}px`;
    pad.style.top = `${y - z.top - half}px`;
    pad.style.bottom = 'auto';
    pad.classList.add('active');
    origin = { x, y, id: e.pointerId };
    move(e);
  });
  const move = (e: PointerEvent) => {
    if (!origin || e.pointerId !== origin.id) return;
    const reach = pad.offsetWidth / 2;
    let dx = e.clientX - origin.x;
    let dy = e.clientY - origin.y;
    const len = Math.hypot(dx, dy);
    if (len > reach) {
      dx *= reach / len;
      dy *= reach / len;
    }
    knob.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    aim = len > reach * 0.3 ? { dx, dy } : null;
    update();
  };
  const end = (e: PointerEvent) => {
    if (!origin || e.pointerId !== origin.id) return;
    origin = null;
    aim = null;
    knob.style.transform = '';
    pad.style.left = pad.style.top = pad.style.bottom = '';
    pad.classList.remove('active');
    update();
  };
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  return zone;
}

/** Shows the controls for a mode (game.ts calls it every frame; only a change touches the page). */
export function setTouchMode(mode: TouchMode | null): void {
  const value = mode ?? '';
  if (document.body.dataset.touch !== value) document.body.dataset.touch = value;
}

/** Adds the controls to the page; they show only while a match is being played (body.playing). */
export function addTouchControls(): void {
  const root = document.createElement('div');
  root.className = 'touch';
  const top = document.createElement('div');
  top.className = 'touch-top';
  const right = document.createElement('div');
  right.className = 'touch-right';
  for (const def of TOUCH_BUTTONS) (def.cls.startsWith('top') ? top : right).append(button(def));
  root.append(stick(), top, right);
  document.body.append(root);
}
