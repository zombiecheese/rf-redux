// An icon for every achievement, drawn in code from a few shapes (vehicles, buildings, flags, medals...) on a 24 x 24
// grid, with a number on it for those earned by reaching one. The modern view shows them as thin line art in the
// feed's ink; the classic view draws the same lines onto a small canvas with no smoothing, so they come out as
// chunky pixels like the rest of the classic menus.

/** One piece of an icon: an SVG path, and where it goes (an SVG transform). */
interface Layer {
  d: string;
  t?: string;
  fill?: boolean;
}

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** The shapes the icons are made of. */
const S = {
  tank: 'M2 15h20v4H2z M6 11h9v4H6z M15 12.5h7 M5 19v-1M9 19v-1M13 19v-1M17 19v-1',
  jeep: `M2 13h20v4H2z M6 13l2-4h7l2 4 ${circle(7, 19, 1.8)} ${circle(17, 19, 1.8)}`,
  heli: `${circle(10, 13, 4)} M14 13h7 M21 10v6 M2 7h17 M10 7v2 M6 19h9 M8 17v2M13 17v2`,
  asv: 'M2 15h20l-3 5H5z M7 15v-4h8v4 M9 11l2-3h5',
  tower: 'M8 21h8l-1-9H9z M6 12h12V8H6z M12 8V4 M12 4h6',
  building: 'M4 21V9l8-5 8 5v12z M9 21v-5h6v5 M7 11h3M14 11h3',
  prison: 'M4 20h16V5H4z M8 5v15M12 5v15M16 5v15 M4 10h16',
  bridge: 'M2 11h20 M4 11v9 M20 11v9 M4 20c3-6 13-6 16 0 M2 8h20',
  fuel: 'M7 8h10v13H7z M7 12h10 M7 17h10 M12 2c2.5 2 1.5 4 0 5c-1.5-1-2.5-3 0-5z',
  bush: 'M12 21v-5 M6 16a4 4 0 0 1 1-7a5 5 0 0 1 10 0a4 4 0 0 1 1 7z',
  flag: 'M6 21V3 M6 4h12l-3 4 3 4H6',
  drone: `M8 8l8 8M16 8l-8 8 ${circle(6, 6, 3)} ${circle(18, 6, 3)} ${circle(6, 18, 3)} ${circle(18, 18, 3)} M10 10h4v4h-4z`,
  soldier: `${circle(12, 5, 2.5)} M12 8v8 M7 11h10 M12 16l-3 6 M12 16l3 6 M17 11l3-3`,
  sub: 'M2 16c0-3 4-4 10-4s10 1 10 4-4 3-10 3-10 0-10-3z M10 12V7h4v5 M14 8h3',
  waves: 'M1 21c2-2 4-2 6 0s4 2 6 0 4-2 6 0 3 1 4 0',
  mine: `${circle(12, 13, 5)} M12 5v3M12 18v3M4 13h3M17 13h3M6.5 7.5l2 2M17.5 7.5l-2 2`,
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  trophy: 'M7 3h10v6a5 5 0 0 1-10 0z M7 5H3v2a4 4 0 0 0 4 4 M17 5h4v2a4 4 0 0 1-4 4 M12 14v4 M7 21h10v-3H7z',
  medal: `M7 2l5 7 5-7 ${circle(12, 15, 6)} M12 12v6 M10.5 13.5l1.5-1.5`,
  chevrons: 'M4 9l8-5 8 5 M4 15l8-5 8 5 M4 21l8-5 8 5',
  bolt: 'M14 2L4 14h7l-2 8 11-13h-7z',
  shield: 'M12 2l9 3v7c0 5-4 9-9 10-5-1-9-5-9-10V5z',
  check: 'M8 12l3 3 6-7',
  moon: 'M14 3a9 9 0 1 0 7 13a7 7 0 0 1-7-13z',
  map: 'M2 6l7-3 6 3 7-3v15l-7 3-6-3-7 3z M9 3v15 M15 6v15',
  pin: `M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z ${circle(12, 10, 2.5)}`,
  crosshair: `${circle(12, 12, 7)} M12 2v6M12 16v6M2 12h6M16 12h6`,
  burst: 'M12 2l2 6 6-3-3 6 6 2-6 2 3 6-6-3-2 6-2-6-6 3 3-6-6-2 6-2-3-6 6 3z',
  screens: 'M2 5h9v11H2z M13 5h9v11h-9z M8 20h8 M12 16v4',
  people: `${circle(8, 7, 3)} ${circle(16, 7, 3)} M2 21c0-5 3-7 6-7s6 2 6 7 M10 21c0-5 3-7 6-7s6 2 6 7`,
  globe: `${circle(12, 12, 9)} M3 12h18 M12 3c4 4 4 14 0 18 M12 3c-4 4-4 14 0 18`,
  swords: 'M4 4l16 16 M20 4L4 20 M4 4h4M4 4v4 M20 4h-4M20 4v4 M15 17l2 2M9 17l-2 2',
  chart: 'M3 21h18 M3 21V3 M6 16l5-5 4 3 6-7 M16 7h5v5',
  replay: 'M4 12a8 8 0 1 0 2.5-5.8 M4 3v5h5 M10 9l5 3-5 3z',
  pencil: 'M4 20l2-6L16 4l4 4L10 18z M14 6l4 4 M4 20l6-2',
  eye: `M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z ${circle(12, 12, 3.5)}`,
  anchor: `${circle(12, 4.5, 2)} M12 6.5V21 M8 10h8 M4 14c0 4 3 7 8 7s8-3 8-7 M2 15l2-2 2 2 M18 15l2-2 2 2`,
  cross: 'M14 14l7 7 M21 14l-7 7',
  back: 'M15 18h7 M18 15l-3 3 3 3',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4 M12 15v2',
} as const;

const L = (d: string, t?: string): Layer => ({ d, t });
/** Small, in a corner: for a second shape beside the main one. */
const small = (d: string, x: number, y: number, s = 0.5): Layer => L(d, `translate(${x} ${y}) scale(${s})`);
/** Room for a number in the bottom right: the main shape a little smaller, up and to the left. */
const shrunk = (d: string): Layer => L(d, 'scale(.78)');

/** Each achievement's shapes, and the number it shows, if any. */
const ICONS: Record<string, { layers: Layer[]; badge?: string }> = {
  'first-match': { layers: [L(S.medal)] },
  'first-win': { layers: [L(S.trophy)] },
  'wins-25': { layers: [shrunk(S.trophy)], badge: '25' },
  'wins-100': { layers: [shrunk(S.trophy)], badge: '100' },
  'top-brass': { layers: [shrunk(S.chevrons)], badge: '9' },
  flawless: { layers: [L(S.shield), L(S.check)] },
  blitz: { layers: [L(S.bolt)] },
  'last-jeep': { layers: [shrunk(S.jeep)], badge: '0' },
  'night-win': { layers: [L(S.moon), small(S.star, 12, 1, 0.45)] },
  'three-base': { layers: [shrunk(S.map)], badge: '3' },
  'four-base': { layers: [shrunk(S.map)], badge: '4' },
  tour: { layers: [shrunk(S.globe)], badge: '10' },
  'custom-map': { layers: [L(S.pin)] },
  'split-screen': { layers: [L(S.screens)] },

  'first-blood': { layers: [L(S.crosshair)] },
  'kills-50': { layers: [shrunk(S.burst)], badge: '50' },
  'kills-250': { layers: [shrunk(S.burst)], badge: '250' },
  'tanks-25': { layers: [shrunk(S.tank)], badge: '25' },
  'helis-10': { layers: [shrunk(S.heli)], badge: '10' },
  'combined-arms': { layers: [shrunk(S.crosshair)], badge: '×4' },
  'jeep-vs-tank': { layers: [small(S.jeep, 0, 11, 0.55), small(S.tank, 10, 0, 0.58), small(S.burst, 13, 1, 0.38)] },
  'hat-trick': { layers: [shrunk(S.crosshair)], badge: '3' },
  rampage: { layers: [shrunk(S.crosshair)], badge: '5' },
  interception: { layers: [L(S.flag), L(S.cross)] },
  'drone-down': { layers: [L(S.drone)] },
  'drones-25': { layers: [shrunk(S.drone)], badge: '25' },
  'soldiers-100': { layers: [shrunk(S.soldier)], badge: '100' },

  'tower-down': { layers: [L(S.tower), small(S.burst, 12, 0, 0.5)] },
  'towers-50': { layers: [shrunk(S.tower)], badge: '50' },
  'buildings-500': { layers: [shrunk(S.building)], badge: '500' },
  prison: { layers: [L(S.prison)] },
  bridge: { layers: [L(S.bridge)] },
  fuel: { layers: [L(S.fuel)] },
  'crush-50': { layers: [shrunk(S.bush)], badge: '50' },

  'flag-take': { layers: [L(S.flag), small(S.jeep, 11, 13, 0.45)] },
  'flag-capture': { layers: [L(S.flag), L('M13 17l2 2 5-5')] },
  'flags-10': { layers: [shrunk(S.flag)], badge: '10' },
  'flag-return': { layers: [L(S.flag), L(S.back)] },

  'all-vehicles': { layers: [small(S.tank, 0, 0), small(S.jeep, 12, 0), small(S.asv, 0, 12), small(S.heli, 12, 12)] },
  tyres: { layers: [L(S.jeep, 'translate(0 -4)'), L(S.waves)] },
  'mines-50': { layers: [shrunk(S.mine)], badge: '50' },
  sub: { layers: [L(S.sub), small(S.heli, 13, 0, 0.42)] },
  drowned: { layers: [L(S.anchor)] },

  'online-first': { layers: [L(S.globe)] },
  'online-win': { layers: [L(S.swords)] },
  'team-win': { layers: [L(S.people)] },
  ladder: { layers: [L(S.chart)] },

  replay: { layers: [L(S.replay)] },
  architect: { layers: [L(S.pencil)] },
  thermal: { layers: [L(S.eye)] },
  /** A hidden achievement not yet earned. */
  hidden: { layers: [L(S.lock)] },
};

/** Every achievement's id has an icon (and 'hidden' for those still secret). */
export const ICON_IDS = Object.keys(ICONS);

/** The icon as SVG markup, in the given colour (currentColor follows the text). */
export function iconSvg(id: string, colour = 'currentColor', stroke = 1.8): string {
  const icon = ICONS[id] ?? { layers: [L(S.star)] };
  const paths = icon.layers.map((l) => {
    // A shape drawn a little smaller keeps its line width on screen; a small one beside the main shape gets thinner
    // lines, so it does not fill in.
    const scale = Number(/scale\(([\d.]+)/.exec(l.t ?? '')?.[1] ?? 1);
    return `<path d="${l.d}"${l.t ? ` transform="${l.t}"` : ''} stroke-width="${(stroke / Math.max(scale, 0.75)).toFixed(2)}"/>`;
  }).join('');
  const badge = icon.badge
    ? `<text x="24" y="24" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="${icon.badge.length > 2 ? 8 : 9.5}" fill="${colour}" stroke="none">${icon.badge}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-linecap="square" stroke-linejoin="miter">${paths}${badge}</svg>`;
}

/** Classic icons are drawn this many pixels across, then scaled up whole. */
const PIXELS = 32;

/** A classic icon: the lines drawn small with no in-between shades, so they scale up as pixels. */
function pixelIcon(id: string, colour: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PIXELS;
  c.height = PIXELS;
  c.className = 'ach-pixels';
  const img = new Image();
  img.onload = () => {
    const g = c.getContext('2d');
    if (!g) return;
    g.drawImage(img, 0, 0, PIXELS, PIXELS);
    const data = g.getImageData(0, 0, PIXELS, PIXELS);
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = data.data[i]! >= 110 ? 255 : 0;
    g.putImageData(data, 0, 0);
  };
  img.src = `data:image/svg+xml,${encodeURIComponent(iconSvg(id, colour, 2))}`;
  return c;
}

/** The icon for the current look (body[data-visuals]): line art in the modern view, pixels in the classic one. */
export function achievementIcon(id: string, colour: string): HTMLElement {
  const box = document.createElement('span');
  box.className = 'ach-icon';
  box.setAttribute('aria-hidden', 'true');
  if (document.body.dataset.visuals === 'retro') box.append(pixelIcon(id, colour));
  else box.innerHTML = iconSvg(id);
  return box;
}
