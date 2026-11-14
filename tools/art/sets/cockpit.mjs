// The cockpit: the four vehicles' consoles, the bunker's console frame and pad, the radar's grid, the lights,
// pips, digits and icons the game lays over them, and a few small effects (a missile seen end on, a swirl and
// sparkles on water). Gauges, radar windows and lights sit where the game draws into them (hud.ts).

import { hash } from '../kit.mjs';
import { WOOD, canvas, cloud } from '../masonry.mjs';
import { rgb } from '../png.mjs';

const PLATE = { hi: rgb(198, 202, 216), mid: rgb(148, 154, 174), lo: rgb(106, 112, 136), deep: rgb(64, 68, 92) };
const NAVY = rgb(28, 30, 66);
const SLOT = rgb(16, 18, 34);
const FACE = rgb(232, 240, 246);
const RED = [rgb(236, 40, 34), rgb(150, 20, 22)];
const YELLOW = [rgb(250, 214, 48), rgb(196, 150, 24)];
const BLUE = [rgb(110, 176, 240), rgb(48, 112, 204), rgb(28, 66, 140)];
const OLIVE = [rgb(132, 140, 62), rgb(88, 96, 44), rgb(56, 62, 30)];
const CYAN = [rgb(150, 236, 240), rgb(86, 190, 206)];

// ---- parts ---------------------------------------------------------------------------------------------------

const rivet = (cv, x, y) => cv.set(x, y, PLATE.hi).set(x + 1, y + 1, PLATE.deep);

/** A console's plate: bevelled, a rivet in each corner. */
function plate(w, h) {
  const cv = canvas(w, h, PLATE.mid);
  cv.frame(0, 0, w - 1, h - 1, PLATE.hi, PLATE.deep).frame(1, 1, w - 2, h - 2, PLATE.hi, PLATE.lo);
  for (const [x, y] of [[3, 3], [w - 5, 3], [3, h - 5], [w - 5, h - 5]]) rivet(cv, x, y);
  return cv;
}

/** A raised block of the console. */
const block = (cv, x0, y0, x1, y1) => cv.rect(x0, y0, x1, y1, PLATE.mid).frame(x0, y0, x1, y1, PLATE.hi, PLATE.lo);

/** The slot a bar gauge lights up in: the game draws rows y0 to y1, columns x0 to x1. */
function housing(cv, x0, x1, y0, y1) {
  cv.rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2, SLOT).frame(x0 - 3, y0 - 3, x1 + 3, y1 + 3, PLATE.deep, PLATE.hi);
}

/** A screen: one dark colour throughout (the radar paints only pixels of it) in a bezel. */
function screen(cv, x0, y0, x1, y1) {
  cv.frame(x0 - 3, y0 - 3, x1 + 3, y1 + 3, PLATE.hi, PLATE.lo).frame(x0 - 2, y0 - 2, x1 + 2, y1 + 2, PLATE.mid, PLATE.mid);
  cv.frame(x0 - 1, y0 - 1, x1 + 1, y1 + 1, PLATE.deep, PLATE.hi).rect(x0, y0, x1, y1, NAVY);
}

/** A fuel can: yellow, crossed, with its cap. */
function can(cv, x, y) {
  cv.rect(x, y + 2, x + 9, y + 11, YELLOW[0]).frame(x, y + 2, x + 9, y + 11, YELLOW[0], YELLOW[1]);
  cv.rect(x + 1, y, x + 3, y + 1, RED[0]).rect(x + 5, y + 1, x + 8, y + 1, YELLOW[1]);
  cv.line(x + 2, y + 4, x + 7, y + 9, YELLOW[1]).line(x + 7, y + 4, x + 2, y + 9, YELLOW[1]);
}

/** A round standing on its base: red nose, yellow case. */
function round(cv, x, y, tall = 10, tones = [RED[0], YELLOW[0], YELLOW[1]]) {
  cv.rect(x, y + 3, x + 2, y + tall, tones[1]).rect(x + 2, y + 3, x + 2, y + tall, tones[2]).rect(x, y + 1, x + 2, y + 2, tones[0]).set(x + 1, y, tones[0]);
  cv.rect(x, y + tall - 3, x + 2, y + tall - 3, tones[0]);
}

/** A little dial: a white face with a needle. */
function dial(cv, x, y, turn) {
  cv.rect(x, y, x + 8, y + 8, FACE).frame(x - 1, y - 1, x + 9, y + 9, PLATE.deep, PLATE.hi);
  cv.line(x + 4, y + 4, x + 4 + [3, 0, -3, 2][turn], y + 4 + [-2, -3, 2, 3][turn], turn & 1 ? RED[0] : BLUE[1]).set(x + 4, y + 4, PLATE.deep);
}

/** A push button. */
const button = (cv, x0, y0, x1, y1) => block(cv, x0, y0, x1, y1).rect(x0 + 2, y0 + 2, x1 - 2, y1 - 2, PLATE.lo).frame(x0 + 2, y0 + 2, x1 - 2, y1 - 2, PLATE.deep, PLATE.hi);

// ---- consoles (144 x 56) -------------------------------------------------------------------------------------

function tankConsole() {
  const cv = plate(144, 56);
  block(cv, 8, 3, 62, 52);
  screen(cv, 17, 9, 53, 45);
  for (const y of [12, 37]) cv.rect(3, y, 9, y + 6, PLATE.lo).frame(3, y, 9, y + 6, PLATE.hi, PLATE.deep);
  block(cv, 67, 3, 139, 22);
  can(cv, 72, 6);
  housing(cv, 88, 127, 12, 15);
  block(cv, 67, 24, 139, 42);
  housing(cv, 76, 115, 31, 34);
  round(cv, 123, 27);
  round(cv, 128, 27);
  for (const x of [69, 93, 117]) button(cv, x, 45, x + 20, 52);
  return cv.img;
}

function jeepConsole() {
  const cv = plate(144, 56);
  housing(cv, 15, 50, 10, 12);
  can(cv, 56, 5);
  // The speedometer.
  cv.disc(34, 35, 17, PLATE.lo).disc(33.5, 34.5, 16, PLATE.hi).disc(34, 35, 14.5, FACE);
  for (let k = 0; k < 9; k++) cv.set(Math.round(34 + [-12, -11, -8, -4, 0, 4, 8, 11, 12][k]), Math.round(35 - [0, 5, 9, 11, 12, 11, 9, 5, 0][k]), BLUE[1]);
  cv.line(34, 35, 40, 26, RED[0]).rect(33, 34, 35, 36, PLATE.deep).rect(27, 40, 41, 43, BLUE[0]).frame(27, 40, 41, 43, BLUE[1], BLUE[1]);
  block(cv, 86, 4, 138, 17);
  for (const x of [92, 104, 116, 128]) cv.rect(x, 8, x + 3, 13, PLATE.lo).rect(x + 1, 6, x + 2, 10, PLATE.hi);
  // The grenade rack: two shelves on two posts; the grenades stand on the shelves.
  for (const x of [58, 131]) cv.rect(x, 19, x + 2, 53, WOOD.lo).rect(x, 19, x, 53, WOOD.mid);
  for (const y of [30, 47]) cv.rect(59, y, 132, y + 3, WOOD.mid).rect(59, y, 132, y, WOOD.hi).rect(59, y + 3, 132, y + 3, WOOD.deep);
  cv.each((c, x, y) => (c === WOOD.mid && hash(x >> 2, y, 3) < 0.2 ? WOOD.lo : c));
  return cv.img;
}

function asvConsole() {
  const cv = plate(144, 56);
  for (const y of [6, 22, 38]) cv.rect(3, y, 8, y + 10, PLATE.lo).frame(3, y, 8, y + 10, PLATE.hi, PLATE.deep);
  block(cv, 11, 3, 80, 19);
  round(cv, 15, 6);
  round(cv, 20, 6);
  housing(cv, 29, 73, 11, 13);
  block(cv, 11, 20, 80, 35);
  housing(cv, 19, 63, 26, 28);
  can(cv, 68, 21);
  block(cv, 11, 36, 80, 52);
  cv.disc(20, 44.5, 5.2, YELLOW[1]).disc(20, 44.5, 4.2, YELLOW[0]).disc(20, 44.5, 2, RED[0]);
  housing(cv, 29, 73, 41, 43);
  block(cv, 83, 3, 135, 52);
  screen(cv, 88, 8, 128, 44);
  for (const y of [8, 22, 36]) cv.rect(137, y, 140, y + 8, PLATE.lo).frame(137, y, 140, y + 8, PLATE.hi, PLATE.deep);
  return cv.img;
}

function heliConsole() {
  const cv = plate(144, 56);
  cv.line(30, 22, 48, 4, PLATE.lo).line(31, 22, 49, 4, PLATE.hi).line(113, 22, 95, 4, PLATE.lo).line(112, 22, 94, 4, PLATE.hi);
  for (const [x, turn] of [[6, 0], [19, 1], [118, 2], [131, 3]]) dial(cv, x, 5, turn);
  // The sockets the two weapon lights sit in.
  for (const [x, y] of [[36, 36], [91, 20]]) cv.rect(x, y, x + 17, y + 17, PLATE.lo).frame(x - 1, y - 1, x + 18, y + 18, PLATE.deep, PLATE.hi);
  // The round radar: a dark disc in a ring with tick marks.
  cv.disc(70.5, 20, 20, PLATE.lo).disc(70, 19.5, 19, PLATE.hi).disc(70.5, 20, 17.6, PLATE.deep).disc(70.5, 20, 16.4, NAVY);
  for (const [dx, dy] of [[0, -18], [13, -13], [18, 0], [13, 13], [0, 18], [-13, 13], [-18, 0], [-13, -13]]) cv.rect(Math.round(70 + dx), Math.round(19.5 + dy), Math.round(71 + dx), Math.round(20.5 + dy), BLUE[1]);
  housing(cv, 9, 33, 25, 27);
  can(cv, 39, 21);
  housing(cv, 110, 135, 25, 27);
  housing(cv, 55, 103, 45, 47);
  for (const x of [4, 18, 114, 128]) button(cv, x, 40, x + 11, 51);
  return cv.img;
}

/** A weapon light: missiles or the gun, lit or dark. */
function light(missiles, lit) {
  const cv = canvas(18, 18, lit ? rgb(214, 220, 236) : PLATE.lo);
  cv.frame(0, 0, 17, 17, lit ? FACE : PLATE.mid, lit ? PLATE.mid : PLATE.deep);
  const tones = lit ? [RED[0], YELLOW[0], YELLOW[1]] : [PLATE.deep, PLATE.deep, PLATE.deep];
  if (missiles) {
    round(cv, 8, 3, 11, tones);
    cv.rect(6, 12, 7, 14, tones[0]).rect(11, 12, 12, 14, tones[0]);
  } else {
    round(cv, 5, 5, 9, tones);
    round(cv, 10, 5, 9, tones);
  }
  return cv.img;
}

// ---- bunker console ------------------------------------------------------------------------------------------

/** The frame round the bunker's pad: steel with a round-cornered opening. */
function bunkerFrame() {
  const cv = plate(148, 59);
  for (const x of [6, 138]) cv.rect(x, 2, x + 3, 56, PLATE.lo).rect(x, 2, x, 56, PLATE.hi);
  const inside = (x, y) => {
    const dx = Math.max(15 + 8 - x, x - (132 - 8), 0);
    const dy = Math.max(7 + 8 - y, y - (51 - 8), 0);
    return x >= 15 && x <= 132 && y >= 7 && y <= 51 && dx * dx + dy * dy <= 64;
  };
  cv.each((c, x, y) => (inside(x, y) ? 0 : inside(x + 1, y + 1) ? PLATE.deep : inside(x - 1, y - 1) ? PLATE.hi : c));
  for (const [x, y] of [[13, 4], [133, 4], [13, 53], [133, 53]]) rivet(cv, x, y);
  return cv.img;
}

/** The pad behind it: a dark grid (the counters go on its left) with the two bunker buttons and what they do. */
function bunkerPad() {
  const cv = canvas(124, 50, rgb(24, 26, 60));
  cv.each((c, x, y) => (x % 6 === 5 || y % 6 === 5 ? rgb(42, 46, 92) : c));
  // Go up in the lift: a yellow arrow on red. Look at the map: a globe on blue.
  cv.rect(76, 27, 92, 43, RED[0]).frame(76, 27, 92, 43, YELLOW[0], YELLOW[0]);
  for (let k = 0; k < 7; k++) cv.rect(84 - k, 30 + k, 84 + k, 30 + k, YELLOW[0]);
  cv.rect(82, 37, 86, 41, YELLOW[0]);
  cv.rect(98, 27, 114, 43, BLUE[1]).frame(98, 27, 114, 43, YELLOW[0], YELLOW[0]);
  cv.disc(106.5, 35.5, 6, BLUE[0]).rect(106, 30, 106, 41, BLUE[2]).rect(101, 35, 112, 35, BLUE[2]).rect(103, 32, 110, 32, BLUE[2]).rect(103, 38, 110, 38, BLUE[2]);
  cv.rect(70, 5, 120, 19, rgb(52, 54, 62)).frame(70, 5, 120, 19, rgb(84, 86, 96), rgb(30, 32, 40));
  cv.disc(84.5, 12, 4, RED[1]).disc(84.5, 12, 3, RED[0]).disc(106.5, 12, 4, BLUE[2]).disc(106.5, 12, 3, BLUE[1]);
  cv.rect(84, 17, 84, 26, YELLOW[0]).rect(106, 17, 106, 26, YELLOW[0]);
  return cv.img;
}

// ---- digits and icons ----------------------------------------------------------------------------------------

// Seven segments: top, top left, top right, middle, bottom left, bottom right, bottom.
const SEGMENTS = ['1110111', '0010010', '1011101', '1011011', '0111010', '1101011', '1101111', '1010010', '1111111', '1111011'];

/** A red digit, seven pixels wide in the top left of its sprite (a 1 is five wide). */
function digit(n) {
  const cv = canvas(16, 16);
  const on = SEGMENTS[n];
  const x1 = n === 1 ? 4 : 6;
  const bar = (y) => cv.rect(n === 1 ? 3 : 1, y, x1 - 1, y + 1, RED[0]);
  const post = (x, y) => cv.rect(x, y, x + 1, y + 4, RED[0]).rect(x + 1, y + 1, x + 1, y + 4, RED[1]);
  if (on[0] === '1') bar(2);
  if (on[3] === '1') bar(7);
  if (on[6] === '1') bar(12);
  if (on[1] === '1') post(0, 3);
  if (on[2] === '1') post(x1 - 1, 3);
  if (on[4] === '1') post(0, 8);
  if (on[5] === '1') post(x1 - 1, 8);
  return cv.img;
}

/** A picture from rows of characters: each letter a colour, a dot clear. */
function picture(rows, colours, w = 16, h = 16) {
  const cv = canvas(w, h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => cv.set(x, y, colours[ch] ?? 0)));
  return cv.img;
}

const INK = { '#': BLUE[1], o: BLUE[0], '-': BLUE[2] };
const SIDE_VIEWS = {
  tank: [
    '................', '................', '................', '................',
    '.....o####......', '....######-.....', '.##########.....', '....######-.....',
    '..o###########..', '.##############.', '.#-#-#-#-#-#-##.', '..############..',
  ],
  jeep: [
    '................', '................', '................', '................',
    '................', '.......o#.......', '......#..#......', '.o#...#..#.#o...',
    '.##############.', '.##############.', '..#--#....#--#..', '...##......##...',
  ],
  asv: [
    '................', '................', '................', '.....o####......',
    '.....######.....', '..o###########..', '..############o.', '.###-###-###-##.',
    '.##############.', '.##############.', '.#-#-#-#-#-#-##.', '..############..',
  ],
  heli: [
    '................', '................', '................', 'o##############.',
    '.......##.......', '#.....o####.....', '##...########...', '.############o..',
    '.....########...', '......######....', '.....#....#.....', '....#########...',
  ],
};
const sideView = (kind) => picture(SIDE_VIEWS[kind], INK);

const WEAPONS = {
  grenade: picture([
    '................', '................', '.......ss.......', '......ssss......', '.......ss.......', '......oooo......',
    '.....o#o##-.....', '.....#o###-.....', '.....o#o##-.....', '.....#o###-.....', '.....o#o##-.....', '......####......', '.......--.......',
  ], { s: PLATE.hi, o: OLIVE[0], '#': OLIVE[1], '-': OLIVE[2] }),
  missile: picture([
    '................', '.......o........', '......o#-.......', '......o#-.......', '......o#-.......', '......o#-.......', '......o#-.......',
    '......o#-.......', '......o#-.......', '......o#-.......', '.....oo#--......', '....oo.#.--.....', '....o..#..-.....',
  ], INK),
  rocket: picture([
    '................', '.......r........', '......rrR.......', '......rrR.......', '......yyY.......', '......yyY.......', '......rrR.......',
    '......yyY.......', '......yyY.......', '......yyY.......', '.....ryyYR......', '....rr.y.RR.....', '....r..y..R.....',
  ], { r: RED[0], R: RED[1], y: YELLOW[0], Y: YELLOW[1] }),
  shell: picture([
    '................', '................', '................', '................', '.......o........', '......o#-.......', '......o#-.......',
    '......o#-.......', '......o#-.......', '......yyY.......', '......o#-.......', '......---.......',
  ], { o: PLATE.hi, '#': PLATE.mid, '-': PLATE.deep, y: YELLOW[0], Y: YELLOW[1] }),
};

/** The cross over a lost life. */
const cross = () => picture(['rr...rr', 'rrr.rrr', '.rrrrr.', '..rrr..', '.rrrrr.', 'RRR.RRR', 'RR...RR'], { r: RED[0], R: RED[1] }, 7, 7);

/** A grenade for the jeep's rack. */
const pip = () => picture(['...ss...', '..ssss..', '...ss...', '..oooo..', '.o#o##-.', '.#o###-.', '.o#o##-.', '..####..'], { s: PLATE.hi, o: OLIVE[0], '#': OLIVE[1], '-': OLIVE[2] }, 8, 8);

// ---- small effects -------------------------------------------------------------------------------------------

/** The radar's grid lines. */
function radarGrid() {
  const cv = canvas(32, 32);
  return cv.each((c, x, y) => (x % 8 === 7 || y % 8 === 7 ? rgb(70, 176, 224) : 0)).img;
}

/** A missile seen end on: its motor's glow. */
function glow() {
  return canvas(32, 32).disc(16, 16, 6.2, rgb(226, 86, 18)).disc(16, 16, 4.6, rgb(252, 150, 26)).disc(16, 16, 2.4, rgb(255, 226, 72)).img;
}

/** A swirl on the water, turning a little with each frame. */
function swirl(frame) {
  const cv = canvas(32, 32);
  return cv.each((c, x, y) => {
    const dx = x - 15.5;
    const dy = y - 15.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 15 || d < 1.5) return 0;
    const s = Math.abs(dx) + Math.abs(dy);
    const turn = ((dx >= 0 ? 1 + dy / s : 3 - dy / s) * 6 + d * 0.9 + frame * 2.5) % 6;
    return turn < 2.6 && (x + y) % 2 === 0 && cloud(x, y, 4, 7 + frame) < 0.8 ? CYAN[d < 8 ? 0 : 1] : 0;
  }).img;
}

/** Sparkles on the water. */
function sparkles(frame) {
  const cv = canvas(32, 32);
  for (let k = 0; k < 9; k++) {
    const x = 9 + Math.floor(hash(k, 1, 31 + frame) * 14);
    const y = 9 + Math.floor(hash(k, 2, 31 + frame) * 14);
    cv.set(x, y, CYAN[0]);
    if (k % 3 === 0) cv.set(x - 1, y, CYAN[1]).set(x + 1, y, CYAN[1]).set(x, y - 1, CYAN[1]).set(x, y + 1, CYAN[1]);
  }
  return cv.img;
}

export function draw(put) {
  put(1940, bunkerFrame());
  put(1942, bunkerPad());
  put(1943, tankConsole());
  put(1944, jeepConsole());
  put(1945, asvConsole());
  put(1946, heliConsole());
  put(1952, glow());
  put(1963, radarGrid(), { mode: 3 });
  put(1968, pip());
  put(1977, light(true, true));
  put(1978, light(true, false));
  put(1979, light(false, true));
  put(1980, light(false, false));
  for (let i = 0; i < 3; i++) {
    put(1987 + i, swirl(i));
    put(1993 + i, sparkles(i));
  }
  put(2104, sideView('tank'));
  put(2109, sideView('jeep'));
  put(2114, sideView('asv'));
  put(2120, sideView('heli'));
  put(2125, cross());
  for (let n = 0; n < 10; n++) put(2146 + n, digit(n));
  put(2156, WEAPONS.grenade);
  put(2157, WEAPONS.missile);
  put(2159, WEAPONS.rocket);
  put(2160, WEAPONS.shell);
  put(2161, sideView('jeep'));
  put(2162, sideView('heli'));
  put(2163, sideView('tank'));
  put(2164, sideView('asv'));
}
