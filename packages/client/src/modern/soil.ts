// The soil of the bunker's cut face in the modern view: a picture of real earth made in code, with dark topsoil and
// roots under the grass, bands of brown and red clay below, crumbs and grit throughout and stones set into it, plus a
// matching bump map so the face catches the light like dug earth. It repeats across (seamlessly) but not down, so the
// layers stay in order from the surface to the bottom of the shaft.

import * as THREE from 'three';

/** How much of the face one copy of the picture covers, in the bunker scene's units. */
export const SOIL_ACROSS = 256;
export const SOIL_DOWN = 512;
const W = 1024;
const H = 2048;
/** Pixels to a scene unit. */
const PX = W / SOIL_ACROSS;

let made: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null = null;

/** The soil's colour and bump maps, made once. v = 1 is the surface, v = 0 is SOIL_DOWN units below it. */
export function soilMaps(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  if (made) return made;
  const colour = document.createElement('canvas');
  const relief = document.createElement('canvas');
  colour.width = relief.width = W;
  colour.height = relief.height = H;
  const cg = colour.getContext('2d')!;
  const bg = relief.getContext('2d')!;
  const rnd = mulberry(1913);
  const hash = (x: number, y: number, s: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  // Value noise that wraps across every `period` cells, so the picture tiles left to right.
  const noise = (x: number, y: number, cells: number, seed: number) => {
    const fx = (x / W) * cells;
    const fy = (y / W) * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = hash(((ix % cells) + cells) % cells, iy, seed);
    const b = hash((((ix + 1) % cells) + cells) % cells, iy, seed);
    const c = hash(((ix % cells) + cells) % cells, iy + 1, seed);
    const d = hash((((ix + 1) % cells) + cells) % cells, iy + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const fbm = (x: number, y: number, seed: number) =>
    noise(x, y, 8, seed) * 0.5 + noise(x, y, 24, seed + 1) * 0.28 + noise(x, y, 64, seed + 2) * 0.14 + noise(x, y, 160, seed + 3) * 0.08;

  // The layers, from the surface down (units below it): topsoil, a brown loam, red clay, a sandy band, then ochre clay.
  const layers: { to: number; rgb: [number, number, number] }[] = [
    { to: 26, rgb: [52, 36, 24] },
    { to: 92, rgb: [96, 66, 42] },
    { to: 140, rgb: [128, 72, 46] },
    { to: 168, rgb: [150, 118, 80] },
    { to: 260, rgb: [118, 80, 50] },
    { to: 330, rgb: [140, 98, 58] },
    { to: SOIL_DOWN + 1, rgb: [110, 82, 58] },
  ];
  const img = cg.createImageData(W, H);
  const bump = bg.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Wavy boundaries between the layers.
      const depth = y / PX + (noise(x, y * 0.15, 6, 9) - 0.5) * 18;
      let i = 0;
      while (i < layers.length - 1 && depth > layers[i]!.to) i++;
      const here = layers[i]!.rgb;
      const next = layers[Math.min(layers.length - 1, i + 1)]!.rgb;
      // A soft edge into the next layer.
      const edge = Math.max(0, Math.min(1, (depth - (layers[i]!.to - 5)) / 5));
      const n = fbm(x, y, 3);
      const crumb = hash(x, y, 77);
      const shade = 0.78 + n * 0.44 + (crumb - 0.5) * 0.12;
      const k = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) img.data[k + c] = Math.max(0, Math.min(255, (here[c]! + (next[c]! - here[c]!) * edge) * shade));
      img.data[k + 3] = 255;
      const b = 110 + n * 100 + (crumb - 0.5) * 40 + (noise(x, y, 220, 41) - 0.5) * 50;
      bump.data[k] = bump.data[k + 1] = bump.data[k + 2] = Math.max(0, Math.min(255, b));
      bump.data[k + 3] = 255;
    }
  }
  cg.putImageData(img, 0, 0);
  bg.putImageData(bump, 0, 0);

  // Draws a shape at x and again one picture-width either side, so things on the edge wrap round.
  const wrap = (x: number, r: number, draw: (x: number) => void) => {
    draw(x);
    if (x - r < 0) draw(x + W);
    if (x + r > W) draw(x - W);
  };

  // Roots under the grass: thin dark threads wandering down through the topsoil.
  for (let i = 0; i < 70; i++) {
    let x = rnd() * W;
    let y = rnd() * 10 * PX;
    let a = Math.PI / 2 + (rnd() - 0.5) * 0.8;
    const len = (20 + rnd() * 50) * PX;
    const width = 0.6 + rnd() * 1.8;
    cg.strokeStyle = `rgba(${30 + rnd() * 30},${20 + rnd() * 15},${12},0.85)`;
    bg.strokeStyle = 'rgba(200,200,200,0.7)';
    cg.lineWidth = bg.lineWidth = width;
    cg.beginPath();
    bg.beginPath();
    cg.moveTo(x, y);
    bg.moveTo(x, y);
    for (let s = 0; s < len; s += 6) {
      a += (rnd() - 0.5) * 0.5;
      x += Math.cos(a) * 6;
      y += Math.sin(a) * 6;
      cg.lineTo(x, y);
      bg.lineTo(x, y);
    }
    cg.stroke();
    bg.stroke();
  }

  // Stones and grit set in the soil: more grit than stones, fewer stones in the topsoil.
  for (let i = 0; i < 2200; i++) {
    const big = rnd() < 0.08;
    const r = (big ? 2.5 + rnd() * 6 : 0.5 + rnd() * 1.6) * PX * 0.5;
    const x = rnd() * W;
    const y = rnd() * H;
    if (y < 20 * PX && rnd() < 0.7) continue;
    // Most grit is the soil's own colour; only some of the bigger stones are grey flint.
    const grey = rnd() < (big ? 0.5 : 0.2);
    const base = grey ? 90 + rnd() * 45 : 70 + rnd() * 45;
    const [cr, cgr, cb] = grey ? [base, base * 0.97, base * 0.92] : [base * 1.15, base * 0.85, base * 0.6];
    const rot = rnd() * Math.PI;
    const sq = 0.6 + rnd() * 0.4;
    wrap(x, r, (px) => {
      // The pit it sits in, then the stone, lit from the top left.
      cg.fillStyle = 'rgba(20,12,6,0.55)';
      cg.beginPath();
      cg.ellipse(px + r * 0.18, y + r * 0.22, r * 1.12, r * sq * 1.12, rot, 0, Math.PI * 2);
      cg.fill();
      const grad = cg.createRadialGradient(px - r * 0.35, y - r * 0.35, r * 0.1, px, y, r);
      grad.addColorStop(0, `rgb(${Math.min(255, cr * 1.2)},${Math.min(255, cgr * 1.2)},${Math.min(255, cb * 1.2)})`);
      grad.addColorStop(0.6, `rgb(${cr},${cgr},${cb})`);
      grad.addColorStop(1, `rgb(${cr * 0.55},${cgr * 0.55},${cb * 0.55})`);
      cg.fillStyle = grad;
      cg.beginPath();
      cg.ellipse(px, y, r, r * sq, rot, 0, Math.PI * 2);
      cg.fill();
      const bgr = bg.createRadialGradient(px, y, 0, px, y, r);
      bgr.addColorStop(0, 'rgb(255,255,255)');
      bgr.addColorStop(1, 'rgb(150,150,150)');
      bg.fillStyle = bgr;
      bg.beginPath();
      bg.ellipse(px, y, r, r * sq, rot, 0, Math.PI * 2);
      bg.fill();
    });
  }

  const map = new THREE.CanvasTexture(colour);
  map.colorSpace = THREE.SRGBColorSpace;
  const relief2 = new THREE.CanvasTexture(relief);
  for (const t of [map, relief2]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
  }
  made = { map, bump: relief2 };
  return made;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
