// The pictures under and between the views in a match: the panel the consoles sit in for one view (1pbscrl, 320 x 88)
// and for two (2pbscrl, 320 x 92), and the post between two views (2pmscr). The game lays each console into its bay
// (hud.ts: PANEL_1P, PANEL_2P), so a bay is only a dark recess; the post is read at every other pixel, so it is
// drawn 8 x 152 and doubled.

import { hash } from './kit.mjs';
import { canvas, cloud } from './masonry.mjs';
import { image, rgb } from './png.mjs';

const PLATE = { hi: rgb(198, 202, 216), mid: rgb(148, 154, 174), lo: rgb(106, 112, 136), deep: rgb(64, 68, 92) };
const RECESS = rgb(16, 18, 34);
/** Netting over the hull each side of the panel: olive, with dark and sand patches. */
const NET = [rgb(74, 82, 44), rgb(104, 112, 54), rgb(150, 132, 84), rgb(52, 58, 34)];

const net = (x, y) => {
  const dark = cloud(x, y, 14, 31) * 2 + cloud(x, y, 6, 32);
  const sand = cloud(x + 40, y + 9, 16, 33) * 2 + cloud(x, y, 5, 34);
  if (sand > 1.86) return NET[2];
  if (dark > 1.74) return hash(x, y, 35) < 0.06 ? NET[3] : NET[0];
  return hash(x, y, 36) < 0.04 ? NET[0] : NET[1];
};

const rivet = (cv, x, y) => cv.set(x, y, PLATE.hi).set(x + 1, y, PLATE.lo).set(x, y + 1, PLATE.lo).set(x + 1, y + 1, PLATE.deep);

/** The rail along the top of a panel, under the views. */
const rail = (cv) => cv.rect(0, 0, cv.w - 1, 0, PLATE.hi).rect(0, 1, cv.w - 1, 1, PLATE.mid).rect(0, 2, cv.w - 1, 2, PLATE.deep);

/** A console's bay: the console (144 x 56) goes in at (x, y), the bunker's frame three pixels further out. */
function bay(cv, x, y) {
  cv.sunk(x - 6, y - 5, x + 149, y + 60, PLATE, PLATE.deep).sunk(x - 4, y - 3, x + 147, y + 58, PLATE, RECESS);
  for (const [rx, ry] of [[x - 9, y - 8], [x + 151, y - 8], [x - 9, y + 62], [x + 151, y + 62]]) rivet(cv, rx, ry);
}

/** A row of vent slots, each `w` wide, centred on the xs given. */
const vents = (cv, xs, y, w) => xs.forEach((x) => cv.sunk(x - (w >> 1), y, x + (w >> 1), y + 4, PLATE));

function onePlayer() {
  const cv = canvas(320, 88, net);
  // A shelf each side, level with the housing's top.
  for (const [x0, x1] of [[0, 77], [242, 319]]) {
    cv.raised(x0, 3, x1, 13, PLATE).rect(x0, 14, x1, 14, PLATE.deep);
    const end = x0 ? x0 + 6 : x1 - 12;
    rivet(cv, end, 7);
    rivet(cv, end + 6, 7);
    cv.sunk(x0 ? end + 14 : x0 + 4, 6, x0 ? x1 - 4 : end - 8, 10, PLATE);
  }
  // The housing, its bay, and the plinth it stands on.
  cv.raised(72, 3, 247, 77, PLATE).frame(73, 4, 246, 76, PLATE.hi, PLATE.lo);
  bay(cv, 87, 16);
  vents(cv, [104, 136, 184, 216], 6, 22);
  cv.raised(68, 76, 251, 87, PLATE).rect(68, 76, 251, 76, PLATE.hi);
  rail(cv);
  return cv.img;
}

function twoPlayers() {
  const cv = canvas(320, 92, net);
  cv.raised(4, 3, 315, 78, PLATE).frame(5, 4, 314, 77, PLATE.hi, PLATE.lo);
  bay(cv, 14, 14);
  bay(cv, 165, 14);
  cv.raised(1, 77, 318, 91, PLATE).rect(1, 77, 318, 77, PLATE.hi);
  vents(cv, [22, 50, 146, 174, 270, 298], 82, 20);
  rail(cv);
  return cv.img;
}

function post() {
  const cv = canvas(8, 152, PLATE.mid);
  const across = [PLATE.lo, PLATE.mid, PLATE.hi, PLATE.hi, PLATE.mid, PLATE.mid, PLATE.lo, PLATE.deep];
  cv.each((c, x) => across[x]);
  // A collar every 38 pixels, and a foot where the post meets the panel.
  for (let y = 18; y < 148; y += 38) cv.rect(0, y, 7, y, PLATE.deep).rect(0, y + 1, 7, y + 2, PLATE.hi).rect(0, y + 3, 7, y + 3, PLATE.lo);
  cv.rect(0, 148, 7, 148, PLATE.hi).rect(0, 149, 7, 151, PLATE.mid);
  const out = image(16, 304);
  for (let y = 0; y < 304; y++) for (let x = 0; x < 16; x++) out.px[y * 16 + x] = cv.img.px[(y >> 1) * 8 + (x >> 1)];
  return out;
}

/** Each picture by its name in the pack's screens folder. */
export const screens = () => ({ '1pbscrl': onePlayer(), '2pbscrl': twoPlayers(), '2pmscr': post() });
