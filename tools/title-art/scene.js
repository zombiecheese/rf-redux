// The widescreen title art (packages/client/src/title/title-art.png): Brown, Green, Blue and Red fighting at once in
// front of a fortress. A small software renderer (z-buffer, shadow map, cel outlines) draws the 3D scene at 3x and
// boxes it down to 960 x 540, then painted 2D effects go on top with a depth test. Everything is drawn from code;
// nothing comes from the original game's files. render.mjs runs it.

const OW = 960, OH = 540, SS = 3, W = OW * SS, H = OH * SS;

// ---- maths -----------------------------------------------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const rotZ = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
const rotX = (p, a) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
const shade = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}
function fbm(x, y, o = 4) {
  let s = 0, a = 0.5, t = 0;
  for (let i = 0; i < o; i++) { s += noise(x, y) * a; t += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return s / t;
}

// ---- camera and light ------------------------------------------------------------------------------------------
const CAM = [1.5, -19.5, 16.5], PITCH = 0.66, F = W * 0.78;
const CP = Math.cos(PITCH), SP = Math.sin(PITCH);
const FWD = [0, CP, -SP], UP = [0, SP, CP];
function proj(p) {
  const d = sub(p, CAM);
  const zc = d[1] * CP - d[2] * SP, yc = d[1] * SP + d[2] * CP;
  return [W / 2 + F * d[0] / zc, H / 2 - F * yc / zc, zc];
}
const LIGHT = norm([-0.55, -0.5, 0.72]);
const LU = norm(cross([0, 0, 1], LIGHT)), LV = cross(LIGHT, LU);

// ---- scene building --------------------------------------------------------------------------------------------
const tris = [];
let part = 0;
const newPart = () => ++part;

function poly(tf, pts, col, p, mat) {
  const w = pts.map(tf);
  const n = norm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
  for (let i = 1; i < w.length - 1; i++) tris.push({ v: [w[0], w[i], w[i + 1]], n, col, part: p, mat });
}
function box(tf, a, b, col, o = {}) {
  const p = o.part ?? newPart(), [ix, iy] = o.inset ?? [0, 0], fy = o.front ?? 0;
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  const B = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]];
  const T = [[x0 + ix, y0 + iy, z1], [x1 - ix, y0 + iy, z1], [x1 - ix, y1 - iy - fy, z1], [x0 + ix, y1 - iy - fy, z1]];
  const c = o.top ?? col;
  poly(tf, T, c, p, o.mat);
  if (!o.noBottom) poly(tf, B, col, p, o.mat);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; poly(tf, [B[i], B[j], T[j], T[i]], col, p, o.mat); }
  return p;
}
function basis(axis) {
  const a = norm(axis);
  const r = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(a, r));
  return [u, cross(a, u)];
}
function cyl(tf, a, b, r0, r1, n, col, o = {}) {
  const p = o.part ?? newPart(), [u, v] = basis(sub(b, a)), ph = o.phase ?? Math.PI / n;
  const ring = (c, r) => Array.from({ length: n }, (_, i) => {
    const t = ph + (i / n) * Math.PI * 2;
    return add(c, add(mul(u, Math.cos(t) * r), mul(v, Math.sin(t) * r)));
  });
  const A = ring(a, r0), B = ring(b, r1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; poly(tf, [A[i], A[j], B[j], B[i]], col, p, o.mat); }
  if (o.capA !== false) poly(tf, A, o.capCol ?? col, p, o.mat);
  if (o.capB !== false) poly(tf, B, o.capCol ?? col, p, o.mat);
  return p;
}
/** Rings along local y: [y, cx, cz, rx, rz]. */
function loft(tf, rings, n, col, o = {}) {
  const p = o.part ?? newPart();
  const R = rings.map(([y, cx, cz, rx, rz]) => Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2 + Math.PI / n;
    return [cx + Math.cos(t) * rx, y, cz + Math.sin(t) * rz];
  }));
  for (let k = 0; k < R.length - 1; k++)
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; poly(tf, [R[k][i], R[k][j], R[k + 1][j], R[k + 1][i]], col, p, o.mat); }
  poly(tf, R[0], col, p, o.mat);
  poly(tf, R[R.length - 1], col, p, o.mat);
  return p;
}
/** A side profile [[y, z]...] extruded along x. */
function extrude(tf, prof, x0, x1, col, o = {}) {
  const p = o.part ?? newPart();
  const A = prof.map(([y, z]) => [x0, y, z]), B = prof.map(([y, z]) => [x1, y, z]);
  poly(tf, A, col, p, o.mat); poly(tf, B, col, p, o.mat);
  for (let i = 0; i < prof.length; i++) { const j = (i + 1) % prof.length; poly(tf, [A[i], A[j], B[j], B[i]], col, p, o.mat); }
  return p;
}
const place = (pos, yaw = 0, pitch = 0, roll = 0, s = 1) => (q) => add(rotZ(rotX(rotY(mul(q, s), roll), pitch), yaw), pos);
const chain = (outer, inner) => (q) => outer(inner(q));

// ---- teams -----------------------------------------------------------------------------------------------------
const TEAM = {
  brown: [178, 112, 70], green: [112, 168, 34], blue: [76, 128, 224], red: [214, 64, 56],
};
const STEEL = [96, 98, 100], DARK = [52, 52, 54], TYRE = [40, 40, 42], GLASS = [150, 196, 220];

// ---- models ----------------------------------------------------------------------------------------------------
function tank(pos, yaw, col, turretYaw, elev) {
  const tf = place(pos, yaw);
  const dk = shade(col, 0.72);
  for (const s of [-1, 1]) {
    const prof = [];
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI; prof.push([2.05 + Math.cos(a) * 0.45, 0.5 + Math.sin(a) * 0.45]); }
    for (let i = 0; i <= 6; i++) { const a = Math.PI / 2 + (i / 6) * Math.PI; prof.push([-2.05 + Math.cos(a) * 0.45, 0.5 + Math.sin(a) * 0.45]); }
    const x0 = s < 0 ? -1.9 : 1.25, x1 = s < 0 ? -1.25 : 1.9;
    extrude(tf, prof.reverse(), x0, x1, [58, 56, 52], { mat: 'tread' });
    const xo = s * 1.92;
    for (let k = 0; k < 5; k++) {
      const y = -1.6 + k * 0.8;
      cyl(tf, [xo - s * 0.08, y, 0.42], [xo + s * 0.02, y, 0.42], 0.33, 0.33, 10, [104, 102, 96]);
      cyl(tf, [xo, y, 0.42], [xo + s * 0.06, y, 0.42], 0.13, 0.13, 8, [70, 68, 64]);
    }
    box(tf, [s < 0 ? -2.0 : 1.2, -2.35, 0.95], [s < 0 ? -1.2 : 2.0, 2.4, 1.05], col);
    box(tf, [s < 0 ? -1.85 : 1.35, -1.9, 1.05], [s < 0 ? -1.4 : 1.8, -0.9, 1.35], dk);
  }
  box(tf, [-1.35, -2.2, 0.45], [1.35, 2.15, 1.35], col, { inset: [0.12, 0.25], front: 0.55 });
  box(tf, [-1.0, -2.0, 1.35], [1.0, -1.1, 1.5], dk);
  for (const x of [-0.6, -0.2, 0.2, 0.6]) box(tf, [x - 0.12, -1.95, 1.5], [x + 0.12, -1.15, 1.53], DARK);
  cyl(tf, [0.7, -2.2, 1.05], [0.7, -2.55, 1.05], 0.12, 0.14, 8, DARK);
  cyl(tf, [-0.7, -2.2, 1.05], [-0.7, -2.55, 1.05], 0.12, 0.14, 8, DARK);
  // turret
  const tt = chain(tf, (q) => add(rotZ(q, turretYaw), [0, 0.15, 0]));
  cyl(tt, [0, 0, 1.3], [0, 0, 1.45], 1.05, 1.05, 12, dk);
  cyl(tt, [0, -0.1, 1.45], [0, -0.1, 2.05], 1.1, 0.88, 8, col);
  box(tt, [-0.42, 0.75, 1.5], [0.42, 1.3, 2.0], col, { inset: [0.06, 0.1] });
  cyl(tt, [0.4, -0.35, 2.05], [0.4, -0.35, 2.22], 0.34, 0.32, 10, dk);
  cyl(tt, [0.4, -0.35, 2.22], [0.4, -0.35, 2.3], 0.3, 0.22, 10, col);
  box(tt, [-0.75, -0.6, 2.05], [-0.25, -0.2, 2.18], dk);
  box(tt, [-1.15, -0.9, 1.5], [-0.85, -0.2, 1.85], dk);
  cyl(tt, [-0.6, -1.0, 2.0], [-0.6, -1.0, 3.6], 0.025, 0.015, 4, DARK, { capA: false, capB: false });
  const bt = chain(tt, (q) => add(rotX(q, elev), [0, 1.15, 1.75]));
  cyl(bt, [0, 0, 0], [0, 3.0, 0], 0.15, 0.13, 10, col);
  cyl(bt, [0, 1.4, 0], [0, 1.9, 0], 0.2, 0.2, 10, dk);
  cyl(bt, [0, 2.85, 0], [0, 3.25, 0], 0.21, 0.21, 8, DARK, { capCol: [20, 18, 16] });
  return { muzzle: bt([0, 3.3, 0]), dir: norm(sub(bt([0, 4, 0]), bt([0, 3, 0]))) };
}

function asv(pos, yaw, col, podPitch) {
  const tf = place(pos, yaw);
  const dk = shade(col, 0.72);
  for (const x of [-1.38, 1.38]) for (const y of [-1.55, 0.05, 1.65]) {
    cyl(tf, [x - 0.24, y, 0.56], [x + 0.24, y, 0.56], 0.56, 0.56, 12, TYRE, { mat: 'tyre' });
    cyl(tf, [x + Math.sign(x) * 0.2, y, 0.56], [x + Math.sign(x) * 0.27, y, 0.56], 0.26, 0.26, 8, [120, 118, 110]);
  }
  extrude(tf, [[-2.4, 0.55], [-2.45, 1.4], [1.0, 1.45], [2.05, 1.25], [2.55, 0.85], [2.35, 0.55]], -1.2, 1.2, col);
  for (const y of [-1.55, 0.05, 1.65]) for (const s of [-1, 1])
    box(tf, [s < 0 ? -1.75 : 1.05, y - 0.7, 1.05], [s < 0 ? -1.05 : 1.75, y + 0.7, 1.18], dk);
  // cab
  box(tf, [-1.1, 0.75, 1.42], [1.1, 1.95, 2.3], col, { inset: [0.12, 0.05], front: 0.3 });
  const p = newPart();
  poly(tf, [[-0.95, 1.93, 1.55], [0.95, 1.93, 1.55], [0.85, 1.7, 2.15], [-0.85, 1.7, 2.15]], [36, 52, 72], p, 'glass');
  for (const s of [-1, 1]) poly(tf, [[s * 1.09, 0.95, 1.65], [s * 1.09, 1.75, 1.65], [s * 1.02, 1.65, 2.15], [s * 1.02, 1.0, 2.15]], [36, 52, 72], p, 'glass');
  box(tf, [-0.95, 2.3, 0.7], [0.95, 2.6, 0.95], DARK);
  // launcher
  box(tf, [-0.7, -1.9, 1.45], [0.7, 0.4, 1.7], dk);
  const pt = chain(tf, (q) => add(rotX(q, podPitch), [0, -0.6, 1.85]));
  box(pt, [-1.05, -1.5, 0], [1.05, 1.4, 0.95], col, { inset: [0.04, 0.04] });
  for (const x of [-0.6, 0, 0.6]) for (const z of [0.27, 0.68]) {
    cyl(pt, [x, 1.38, z], [x, 1.46, z], 0.2, 0.2, 10, DARK, { capCol: [18, 18, 18] });
  }
  box(pt, [-1.08, -0.4, 0.3], [1.08, 0.2, 0.65], dk);
  return { pod: pt([0.6, 1.5, 0.68]), dir: norm(sub(pt([0, 3, 0.5]), pt([0, 1, 0.5]))) };
}

function jeep(pos, yaw, col, flagCol) {
  const tf = place(pos, yaw, 0.03, 0.04, 1.3);
  const dk = shade(col, 0.72);
  for (const x of [-0.98, 0.98]) for (const y of [-1.15, 1.2]) {
    cyl(tf, [x - 0.2, y, 0.42], [x + 0.2, y, 0.42], 0.42, 0.42, 12, TYRE, { mat: 'tyre' });
    cyl(tf, [x + Math.sign(x) * 0.17, y, 0.42], [x + Math.sign(x) * 0.22, y, 0.42], 0.2, 0.2, 8, [150, 146, 136]);
  }
  box(tf, [-0.8, -1.7, 0.42], [0.8, 1.0, 1.02], col);
  box(tf, [-0.8, 1.0, 0.42], [0.8, 1.95, 1.02], col, { inset: [0.05, 0], front: 0.2 });
  box(tf, [-0.62, 1.94, 0.5], [0.62, 2.0, 0.92], DARK);
  for (const s of [-1, 1]) {
    box(tf, [s < 0 ? -1.2 : 0.78, 0.75, 0.75], [s < 0 ? -0.78 : 1.2, 1.7, 0.85], dk);
    box(tf, [s < 0 ? -1.2 : 0.78, -1.6, 0.75], [s < 0 ? -0.78 : 1.2, -0.7, 0.85], dk);
    cyl(tf, [s * 0.52, 1.97, 0.85], [s * 0.52, 2.02, 0.85], 0.11, 0.11, 8, [250, 240, 190], { mat: 'lamp' });
  }
  // seats, windscreen, roll bar, gun
  box(tf, [-0.7, -0.4, 1.0], [-0.1, 0.25, 1.2], [70, 50, 40]);
  box(tf, [0.1, -0.4, 1.0], [0.7, 0.25, 1.2], [70, 50, 40]);
  box(tf, [-0.7, -0.5, 1.0], [-0.1, -0.35, 1.6], [70, 50, 40]);
  box(tf, [0.1, -0.5, 1.0], [0.7, -0.35, 1.6], [70, 50, 40]);
  box(tf, [-0.8, 1.0, 1.02], [0.8, 1.06, 1.65], DARK, { inset: [0, 0] });
  const g = newPart();
  poly(tf, [[-0.72, 1.07, 1.08], [0.72, 1.07, 1.08], [0.72, 1.07, 1.58], [-0.72, 1.07, 1.58]], GLASS, g, 'glass');
  for (const s of [-1, 1]) cyl(tf, [s * 0.78, -0.9, 1.02], [s * 0.78, -0.9, 2.0], 0.05, 0.05, 6, DARK);
  cyl(tf, [-0.78, -0.9, 2.0], [0.78, -0.9, 2.0], 0.05, 0.05, 6, DARK);
  // driver
  box(tf, [-0.65, -0.3, 1.2], [-0.15, 0.1, 1.75], [96, 104, 64]);
  cyl(tf, [-0.4, -0.1, 1.75], [-0.4, -0.1, 1.95], 0.14, 0.14, 8, [220, 170, 130]);
  loft(tf, [[-0.33, -0.4, 1.93, 0.01, 0.01], [-0.3, -0.4, 1.93, 0.2, 0.16], [-0.1, -0.4, 2.05, 0.24, 0.14], [0.12, -0.4, 1.95, 0.2, 0.1]], 8, [90, 100, 60]);
  // gun post
  cyl(tf, [0.45, -1.3, 1.0], [0.45, -1.3, 1.75], 0.06, 0.06, 6, DARK);
  box(tf, [0.33, -1.5, 1.75], [0.57, -0.9, 1.95], DARK);
  cyl(tf, [0.45, -0.9, 1.85], [0.45, -0.1, 1.98], 0.05, 0.05, 6, DARK);
  // stolen flag
  const top = [-0.6, -1.55, 3.9];
  cyl(tf, [-0.6, -1.55, 1.0], top, 0.06, 0.05, 6, [215, 210, 196]);
  cyl(tf, top, add(top, [0, 0, 0.12]), 0.1, 0.1, 6, [230, 200, 90]);
  const fp = newPart();
  const cx = (u, v) => [-0.6 - u * 1.8, -1.55 - u * 0.5 + Math.sin(u * 5.5 + 1) * 0.2, 3.85 - v * 1.1 + Math.sin(u * 5.5) * 0.12 - u * 0.2];
  for (let i = 0; i < 6; i++) {
    const u0 = i / 6, u1 = (i + 1) / 6;
    poly(tf, [cx(u0, 0), cx(u1, 0), cx(u1, 1), cx(u0, 1)], flagCol, fp, 'cloth');
  }
  return { tf };
}

function heli(pos, yaw, pitch, roll, col, rotorPhase) {
  const tf = place(pos, yaw, pitch, roll, 1.15);
  const dk = shade(col, 0.72);
  loft(tf, [[2.55, 0, -0.05, 0.12, 0.12], [2.3, 0, -0.08, 0.42, 0.38], [1.5, 0, 0, 0.78, 0.68], [0.4, 0, 0.05, 0.95, 0.85],
    [-0.8, 0, 0.12, 0.85, 0.78], [-1.6, 0, 0.22, 0.5, 0.45], [-2.4, 0, 0.32, 0.3, 0.28], [-4.7, 0, 0.62, 0.13, 0.15]], 10, col);
  loft(tf, [[2.3, 0, 0.2, 0.05, 0.05], [2.15, 0, 0.3, 0.32, 0.25], [1.5, 0, 0.55, 0.55, 0.42], [0.7, 0, 0.62, 0.55, 0.42], [0.35, 0, 0.6, 0.3, 0.3]], 10, [40, 60, 84], { mat: 'glass' });
  box(tf, [-0.5, -1.0, 0.8], [0.5, 0.5, 1.15], dk, { inset: [0.15, 0.2] });
  cyl(tf, [0.5, -0.8, 0.9], [0.5, -1.6, 0.9], 0.18, 0.12, 8, DARK);
  cyl(tf, [-0.5, -0.8, 0.9], [-0.5, -1.6, 0.9], 0.18, 0.12, 8, DARK);
  // tail
  poly(tf, [[0, -4.2, 0.6], [0, -4.85, 0.6], [0, -5.0, 1.6], [0, -4.6, 1.6]], col, newPart());
  box(tf, [-0.8, -4.55, 0.55], [0.8, -4.25, 0.62], col);
  // wings and pods
  for (const s of [-1, 1]) {
    box(tf, [s < 0 ? -1.75 : 0.8, -0.25, -0.05], [s < 0 ? -0.8 : 1.75, 0.45, 0.05], dk);
    cyl(tf, [s * 1.55, 1.0, -0.25], [s * 1.55, -0.6, -0.25], 0.22, 0.22, 10, [70, 74, 64], { capCol: [20, 20, 20] });
    cyl(tf, [s * 1.1, 0.7, -0.22], [s * 1.1, -0.3, -0.22], 0.12, 0.12, 8, DARK);
    // skids
    cyl(tf, [s * 0.75, -1.3, -1.05], [s * 0.75, 1.5, -1.05], 0.06, 0.06, 6, DARK);
    cyl(tf, [s * 0.75, 1.5, -1.05], [s * 0.75, 1.8, -0.85], 0.06, 0.06, 6, DARK);
    cyl(tf, [s * 0.75, 0.9, -1.05], [s * 0.45, 0.9, -0.5], 0.05, 0.05, 6, DARK);
    cyl(tf, [s * 0.75, -0.8, -1.05], [s * 0.45, -0.8, -0.4], 0.05, 0.05, 6, DARK);
  }
  // nose gun
  box(tf, [-0.2, 1.9, -0.65], [0.2, 2.3, -0.4], DARK);
  cyl(tf, [0, 2.2, -0.55], [0, 3.1, -0.6], 0.05, 0.05, 6, DARK);
  // rotor
  cyl(tf, [0, -0.25, 1.15], [0, -0.25, 1.45], 0.12, 0.1, 8, DARK);
  cyl(tf, [0, -0.25, 1.45], [0, -0.25, 1.58], 0.26, 0.22, 8, STEEL);
  for (let k = 0; k < 2; k++) {
    const a = rotorPhase + k * Math.PI;
    const d = [Math.cos(a), Math.sin(a)], q = [-d[1] * 0.17, d[0] * 0.17];
    poly(tf, [[q[0], -0.25 + q[1], 1.55], [d[0] * 4.4 + q[0], -0.25 + d[1] * 4.4 + q[1], 1.6],
      [d[0] * 4.4 - q[0], -0.25 + d[1] * 4.4 - q[1], 1.6], [-q[0], -0.25 - q[1], 1.55]], [44, 44, 46], newPart());
  }
  return { tf, hub: tf([0, -0.25, 1.58]), pods: [tf([1.55, 1.05, -0.25]), tf([-1.55, 1.05, -0.25])], tail: tf([0.1, -4.75, 1.1]) };
}

function tower(pos, yaw, gunYaw) {
  const tf = place(pos, yaw);
  box(tf, [-1.25, -1.25, 0], [1.25, 1.25, 2.4], [168, 168, 160], { inset: [0.3, 0.3], mat: 'stone' });
  box(tf, [-1.0, -1.0, 2.4], [1.0, 1.0, 2.62], [128, 128, 122], { mat: 'stone' });
  const gt = chain(tf, (q) => add(rotZ(q, gunYaw), [0, 0, 2.62]));
  cyl(gt, [0, 0, 0], [0, 0, 0.5], 0.82, 0.7, 10, STEEL);
  loft(gt, [[-0.6, 0, 0.75, 0.01, 0.01], [-0.55, 0, 0.75, 0.6, 0.35], [0.4, 0, 0.78, 0.62, 0.38], [0.75, 0, 0.72, 0.45, 0.25], [0.8, 0, 0.72, 0.01, 0.01]], 10, [80, 82, 84]);
  for (const x of [-0.3, 0, 0.3]) cyl(gt, [x, 0.6, 0.72], [x, 1.7, 0.72], 0.08, 0.08, 6, DARK, { capCol: [10, 10, 10] });
  cyl(gt, [0, 0, 1.0], [0, 0, 1.12], 0.12, 0.12, 8, [230, 60, 40], { mat: 'lamp' });
  return { muzzles: [-0.3, 0, 0.3].map((x) => gt([x, 1.75, 0.72])), dir: norm(sub(gt([0, 2, 0.72]), gt([0, 1, 0.72]))) };
}

function wall(x0, y0, x1, y1, h = 1.9, t = 1.1) {
  const len = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(-(x1 - x0), y1 - y0);
  const tf = place([x0, y0, 0], a);
  box(tf, [-t / 2, 0, 0], [t / 2, len, h], [176, 176, 168], { inset: [0.1, 0], mat: 'stone' });
}

function palm(x, y, h, lean, seed) {
  const r = rng(seed), p = newPart();
  let base = [x, y, 0];
  const segs = 9;
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push([x + lean[0] * t * t * h, y + lean[1] * t * t * h, t * h]);
  }
  for (let i = 0; i < segs; i++)
    cyl((q) => q, pts[i], pts[i + 1], 0.24 - i * 0.012, 0.2 - i * 0.012, 7, i % 2 ? [128, 92, 58] : [104, 74, 46], { part: p });
  const top = pts[segs];
  const leaf = newPart();
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.5, L = 2.4 + r() * 0.9, droop = 1.2 + r() * 0.8;
    const d = [Math.cos(a), Math.sin(a), 0], s = [-Math.sin(a), Math.cos(a), 0];
    const c = (t) => add(top, [d[0] * L * t, d[1] * L * t, 0.55 * t - droop * t * t]);
    const col = mix([46, 120, 40], [96, 168, 56], r());
    const st = 8;
    for (let i = 0; i < st; i++) {
      const t0 = i / st, t1 = (i + 1) / st;
      const w0 = 0.45 * Math.sin(Math.PI * Math.min(1, t0 * 1.15 + 0.05)), w1 = 0.45 * Math.sin(Math.PI * Math.min(1, t1 * 1.15 + 0.05));
      const c0 = c(t0), c1 = c(t1);
      const up0 = [0, 0, 0.18 * w0], up1 = [0, 0, 0.18 * w1];
      poly((q) => q, [c0, c1, add(add(c1, mul(s, w1)), mul(up1, -1)), add(add(c0, mul(s, w0)), mul(up0, -1))], col, leaf, 'leaf');
      poly((q) => q, [c0, add(add(c0, mul(s, -w0)), mul(up0, -1)), add(add(c1, mul(s, -w1)), mul(up1, -1)), c1], shade(col, 0.85), leaf, 'leaf');
    }
  }
  for (let k = 0; k < 3; k++) cyl((q) => q, add(top, [0.15 * Math.cos(k * 2), 0.15 * Math.sin(k * 2), -0.25]), add(top, [0.15 * Math.cos(k * 2), 0.15 * Math.sin(k * 2), -0.5]), 0.14, 0.14, 6, [96, 72, 30]);
}

function rock(x, y, s, seed, col = [150, 146, 138]) {
  const r = rng(seed);
  const tf = place([x, y, -0.1 * s], r() * 6, (r() - 0.5) * 0.4, (r() - 0.5) * 0.4, s);
  // a lumpy hexagonal frustum
  const p = newPart();
  const n = 6, A = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, k = 0.75 + r() * 0.5;
    A.push([Math.cos(a) * k, Math.sin(a) * k, 0]);
    B.push([Math.cos(a + 0.3) * k * 0.55, Math.sin(a + 0.3) * k * 0.55, 0.5 + r() * 0.35]);
  }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; poly(tf, [A[i], A[j], B[j]], col, p, 'stone'); poly(tf, [A[i], B[j], B[i]], col, p, 'stone'); }
  poly(tf, B, col, p, 'stone');
}

function hut(x, y, yaw, col) {
  const tf = place([x, y, 0], yaw);
  const p = newPart(), n = 10, L = 3.2, R = 1.5;
  const arc = (i) => [Math.cos((i / n) * Math.PI) * R, Math.sin((i / n) * Math.PI) * R * 1.05];
  for (let i = 0; i < n; i++) {
    const [ax, az] = arc(i), [bx, bz] = arc(i + 1);
    poly(tf, [[ax, -L, az], [bx, -L, bz], [bx, L, bz], [ax, L, az]], i % 2 ? [150, 156, 160] : [128, 134, 140], p, 'metal');
  }
  for (const y0 of [-L, L]) poly(tf, Array.from({ length: n + 1 }, (_, i) => { const [ax, az] = arc(i); return [ax, y0, az]; }), col, newPart());
  box(tf, [-0.55, L - 0.02, 0], [0.55, L + 0.04, 1.2], DARK);
}

// ---- terrain ---------------------------------------------------------------------------------------------------
const ROAD = [[-3.2, 40], [-3.2, 11.5], [-2.6, 6.5], [-1.0, 1.5], [1.2, -3], [3.2, -8], [4.5, -14]];
const CRATERS = [[-3.7, -0.4, 1.5], [4.4, -2.6, 1.3], [-6, 1.5, 1.9], [-9, 7, 1.3], [11, -8.5, 1.1], [-4.2, -6.5, 1.2], [5, 3, 1.0], [-1.5, -9, 1.0]];
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function coast(x, y) { return (x - 9.5) * 0.85 + (y - 3) * 0.55 + (fbm(x * 0.18, y * 0.18) - 0.5) * 3.2; }
function groundCol(x, y) {
  const n = fbm(x * 0.12, y * 0.12), g = noise(x * 2.7, y * 2.7), fine = hash(Math.floor(x * 22), Math.floor(y * 22));
  let c = mix([200, 174, 124], [228, 206, 154], n);
  c = shade(c, 0.93 + 0.08 * g + 0.04 * fine);
  const gr = fbm(x * 0.1 + 40, y * 0.1 - 13);
  const away = Math.min(...ROAD.slice(1).map((p, i) => segDist(x, y, ROAD[i][0], ROAD[i][1], p[0], p[1])));
  if (gr > 0.56 && away > 2.2) c = mix(c, mix([110, 136, 60], [140, 160, 76], g), smooth((gr - 0.56) / 0.07) * 0.9);
  // tread marks behind the brown tank and the jeep's tyre tracks
  const tread = (ax, ay, bx, by, off, w) => {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const t = (x - ax) * ux + (y - ay) * uy, sd = -(x - ax) * uy + (y - ay) * ux;
    if (t < 0 || t > L) return 0;
    return (Math.abs(Math.abs(sd) - off) < w ? 1 : 0) * (1 - t / L);
  };
  const tm = tread(6.9, -5.4, 11.7, -14.2, 1.55, 0.32);
  if (tm) c = shade(c, 1 - 0.16 * tm * (0.7 + 0.3 * (Math.floor((x + y) * 6) % 2)));
  // road
  if (away < 1.75) {
    const a = mix([118, 114, 106], [136, 132, 124], fbm(x * 0.8, y * 0.8));
    c = mix(c, shade(a, 0.95 + 0.06 * fine), smooth((1.75 - away) / 0.25));
    if (away > 1.45 && away < 1.6) c = shade(c, 0.82);
  }
  // craters
  for (const [cx, cy, r] of CRATERS) {
    const d = Math.hypot(x - cx, y - cy) / r;
    if (d < 1.35) {
      const w = fbm(x * 1.5, y * 1.5);
      if (d < 0.75 + 0.15 * w) c = mix(c, [58, 48, 38], smooth((0.8 - d) / 0.4) * 0.85 + 0.1);
      else if (d < 1.0 + 0.2 * w) c = shade(c, 1.12);
      else c = mix(c, [120, 100, 76], smooth((1.35 - d) / 0.35) * 0.3);
    }
  }
  // sea
  const s = coast(x, y);
  if (s > -1.2 && s <= 0) c = shade(c, lerp(1, 0.8, smooth((s + 1.2) / 1.2)));
  if (s > 0) {
    const deep = smooth(s / 6);
    let wcol = mix([96, 206, 200], [32, 118, 176], deep);
    const ripple = noise(x * 1.2 + y * 0.4, y * 3.2);
    wcol = shade(wcol, 0.92 + 0.14 * ripple);
    if (s < 0.45 + 0.25 * noise(x * 3, y * 3) || (Math.abs(s - 1.3 - 0.3 * noise(x, y * 2)) < 0.12)) wcol = mix(wcol, [240, 248, 244], 0.85);
    c = wcol;
  }
  return c;
}
function groundTris() {
  const p = newPart();
  for (let gx = -40; gx < 40; gx += 4) for (let gy = -12; gy < 70; gy += 4)
    poly((q) => q, [[gx, gy, 0], [gx + 4, gy, 0], [gx + 4, gy + 4, 0], [gx, gy + 4, 0]], [0, 0, 0], p, 'ground');
}

// ---- the scene -------------------------------------------------------------------------------------------------
const aim = (from, to) => Math.atan2(-(to[0] - from[0]), to[1] - from[1]);
groundTris();

// fortress along the back
wall(-30, 12.5, -6.2, 12.5);
wall(-0.2, 12.5, 4.5, 12.5);
wall(-30, 12.5, -30, 30);
wall(4.5, 12.5, 7.2, 17.5);
const t1 = tower([-12, 12.5, 0], 0, 0.6);
const t2 = tower([-5.2, 12.6, 0], 0, 2.6);
const t3 = tower([1.6, 12.6, 0], 0, 3.4);
tower([-20, 12.5, 0], 0, 0.2);
hut(-12, 18, Math.PI / 2, [150, 150, 140]);
hut(-3, 21, Math.PI / 2 + 0.1, [150, 150, 140]);
// gate posts
box((q) => q, [-6.3, 12, 0], [-5.9, 13.0, 2.6], [150, 150, 142], { mat: 'stone' });
box((q) => q, [-0.5, 12, 0], [-0.1, 13.0, 2.6], [150, 150, 142], { mat: 'stone' });

const HELI = [2.0, 4.4, 4.0], TANK = [6.9, -5.4, 0];
const heliYaw = aim(HELI, [6, -4]);
const h = heli(HELI, heliYaw, -0.22, 0.18, TEAM.blue, 0.7);

const tankYaw = 0.5;
const tAim = aim(TANK, HELI);
const tk = tank(TANK, tankYaw, TEAM.brown, tAim - tankYaw, 0.42);

const ASV = [12.2, 2.6, 0];
const av = asv(ASV, aim(ASV, [4, -2]), TEAM.green, 0.45);

const JEEP = [-0.9, 0.9, 0];
jeep(JEEP, aim(JEEP, [1.2, -3]) + 0.15, TEAM.red, TEAM.green);

palm(-9.5, 9.0, 4.6, [0.25, -0.1], 3);
palm(-7.6, 10.2, 3.9, [-0.2, 0.05], 5);
palm(-1.8, 9.6, 4.2, [0.15, 0.1], 7);
palm(5.6, 9.2, 4.4, [0.22, 0.05], 11);
palm(7.4, 10.8, 3.6, [-0.1, 0.1], 13);
palm(-13.5, 6, 4.4, [0.1, -0.2], 17);
palm(-9.8, -2.2, 4.9, [0.3, -0.15], 19);
palm(14.5, -6, 4.6, [-0.3, 0.1], 31);
palm(-4.5, -9.5, 4.4, [0.2, 0.2], 37);
palm(9.5, 6.5, 4.2, [-0.25, 0.1], 23);
palm(-15, 1, 4.0, [0.2, 0.1], 29);

const R = rng(99);
for (const [x, y, s] of [[-2.8, -1.8, 0.55], [-2.1, -2.4, 0.35], [6.8, -1.2, 0.45], [-7.2, 4.2, 0.6], [-6.4, 4.8, 0.4], [9.2, -4.6, 0.5],
  [-11, -4, 0.7], [3.5, 7.5, 0.5], [-4.5, 9.4, 0.4], [-0.9, -5.5, 0.35], [12, 7.8, 0.6], [-13, 10, 0.5]]) rock(x, y, s, Math.floor(R() * 1e6));
// wall rubble at the breach
for (let i = 0; i < 9; i++) rock(-6.2 + R() * 5.6, 11.4 - R() * 2.0, 0.25 + R() * 0.3, i + 300, [170, 170, 162]);

// ---- effects (2D, depth tested) --------------------------------------------------------------------------------
const FX = [];
const fx = (world, size, draw, bias = 0) => FX.push({ world, size, draw, bias });

function blob(ctx, x, y, r, rnd, n = 13, jag = 0.35) {
  ctx.beginPath();
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const k = r * (1 - jag / 2 + rnd() * jag); pts.push([x + Math.cos(a) * k, y + Math.sin(a) * k]); }
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (i === 0) ctx.moveTo((pts[n - 1][0] + p[0]) / 2, (pts[n - 1][1] + p[1]) / 2);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const LINE = SS * 0.9;

function puff(ctx, x, y, r, col, rnd, alpha = 1) {
  blob(ctx, x, y, r, rnd, 11, 0.3);
  ctx.fillStyle = css(col, alpha); ctx.fill();
  ctx.lineWidth = LINE; ctx.strokeStyle = css(shade(col, 0.45), alpha); ctx.stroke();
  blob(ctx, x - r * 0.25, y - r * 0.3, r * 0.55, rnd, 9, 0.3);
  ctx.fillStyle = css(mix(col, [255, 255, 255], 0.25), alpha * 0.8); ctx.fill();
}

function explosion(seed, size, smokeUp = 1) {
  return (ctx, x, y, k) => {
    const rnd = rng(seed), r = size * k;
    // smoke column
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      puff(ctx, x + (rnd() - 0.5) * r * 1.2 + t * r * 0.6, y - r * (0.6 + t * 1.8 * smokeUp), r * (0.55 + t * 0.35), mix([96, 86, 76], [150, 144, 136], t), rnd, 0.95);
    }
    // flame tongues
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6, L = r * (1.1 + rnd() * 0.9), w = r * 0.22;
      const tip = [x + Math.cos(a) * L, y + Math.sin(a) * L * 0.9], n = [-Math.sin(a) * w, Math.cos(a) * w];
      ctx.beginPath(); ctx.moveTo(x + n[0], y + n[1]); ctx.quadraticCurveTo(x + Math.cos(a) * L * 0.6 + n[0] * 1.2, y + Math.sin(a) * L * 0.6 + n[1], tip[0], tip[1]);
      ctx.quadraticCurveTo(x + Math.cos(a) * L * 0.6 - n[0] * 1.2, y + Math.sin(a) * L * 0.6 - n[1], x - n[0], y - n[1]); ctx.closePath();
      ctx.fillStyle = css([240, 128, 36]); ctx.fill(); ctx.lineWidth = LINE; ctx.strokeStyle = css([120, 36, 16]); ctx.stroke();
    }
    const layers = [[[196, 52, 24], 1.0], [[244, 132, 34], 0.8], [[255, 206, 64], 0.56], [[255, 248, 196], 0.3]];
    for (const [col, s] of layers) {
      for (let j = 0; j < 4; j++) {
        blob(ctx, x + (rnd() - 0.5) * r * 0.6 * s, y + (rnd() - 0.6) * r * 0.5 * s, r * s * (0.65 + rnd() * 0.3), rnd);
        ctx.fillStyle = css(col); ctx.fill();
        if (s === 1.0) { ctx.lineWidth = LINE; ctx.strokeStyle = css([110, 30, 12]); ctx.stroke(); }
      }
    }
    // debris
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, d = r * (1.0 + rnd() * 1.6), sz = r * (0.06 + rnd() * 0.12);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.8 - r * 0.4;
      ctx.strokeStyle = css([255, 220, 140], 0.6); ctx.lineWidth = sz * 0.5;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.cos(a) * sz * 3, py - Math.sin(a) * sz * 2.4); ctx.stroke();
      ctx.beginPath();
      for (let v = 0; v < 4; v++) { const b = rnd() * 6.28; ctx.lineTo(px + Math.cos(b) * sz, py + Math.sin(b) * sz); }
      ctx.closePath(); ctx.fillStyle = css(mix([60, 56, 50], [120, 116, 108], rnd())); ctx.fill();
      ctx.lineWidth = LINE * 0.7; ctx.strokeStyle = css([20, 18, 16]); ctx.stroke();
    }
  };
}
function flash(dir2, size) {
  return (ctx, x, y, k) => {
    const r = size * k, a = Math.atan2(dir2[1], dir2[0]);
    const star = (s, col) => {
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const b = a + (i / 14) * Math.PI * 2, along = Math.abs(Math.cos((i / 14) * Math.PI * 2));
        const L = (i % 2 ? 0.35 : 0.7 + along * 1.4) * r * s;
        ctx.lineTo(x + Math.cos(b) * L, y + Math.sin(b) * L);
      }
      ctx.closePath(); ctx.fillStyle = css(col); ctx.fill();
    };
    star(1, [240, 120, 30]); ctx.lineWidth = LINE; ctx.strokeStyle = css([120, 40, 10]); ctx.stroke();
    star(0.7, [255, 210, 70]); star(0.4, [255, 255, 220]);
  };
}
/** A world-space path drawn as a trail of puffs (missiles, rockets, shells) with an optional glowing head. */
function trail(path, o) {
  return (ctx) => {
    const rnd = rng(o.seed ?? 1);
    const pts = path.map(proj);
    const n = o.puffs ?? 18;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), f = t * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f)), u = f - k;
      const x = lerp(pts[k][0], pts[k + 1][0], u), y = lerp(pts[k][1], pts[k + 1][1], u), z = lerp(pts[k][2], pts[k + 1][2], u);
      const r = (F / z) * lerp(o.r0, o.r1, t);
      if (o.smoke) puff(ctx, x + (rnd() - 0.5) * r * 0.4, y + (rnd() - 0.5) * r * 0.4, r, mix([236, 232, 224], [176, 170, 162], t), rnd, lerp(0.95, 0.55, t));
    }
    if (o.tracer) {
      const [a, b] = [pts[0], pts[pts.length - 1]];
      ctx.lineCap = 'round';
      ctx.strokeStyle = css([255, 190, 60], 0.45); ctx.lineWidth = (F / a[2]) * o.tracer * 2.2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.strokeStyle = css([255, 250, 210]); ctx.lineWidth = (F / a[2]) * o.tracer;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    if (o.head) {
      const p = pts[0], q = pts[1], k = F / p[2], a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(a);
      ctx.fillStyle = css([255, 200, 80]); blob(ctx, k * 0.45, 0, k * 0.28, rnd, 9, 0.4); ctx.fill();
      ctx.fillStyle = css(o.head); ctx.strokeStyle = css([20, 20, 20]); ctx.lineWidth = LINE;
      ctx.beginPath(); ctx.moveTo(-k * 0.55, -k * 0.09); ctx.lineTo(k * 0.3, -k * 0.09); ctx.lineTo(k * 0.38, 0); ctx.lineTo(k * 0.3, k * 0.09); ctx.lineTo(-k * 0.55, k * 0.09); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  };
}
function rotorDisc(tf, R) {
  return (ctx) => {
    const ring = Array.from({ length: 48 }, (_, i) => proj(tf([Math.cos((i / 48) * 6.283) * R, -0.25 + Math.sin((i / 48) * 6.283) * R, 1.6])));
    ctx.beginPath(); ring.forEach((p) => ctx.lineTo(p[0], p[1])); ctx.closePath();
    ctx.fillStyle = 'rgba(40,46,54,0.16)'; ctx.fill();
    ctx.strokeStyle = 'rgba(30,34,40,0.35)'; ctx.lineWidth = LINE; ctx.stroke();
    for (const off of [0.35, 1.9, 3.5, 4.9]) {
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) { const p = proj(tf([Math.cos(off + i * 0.06) * R * 0.97, -0.25 + Math.sin(off + i * 0.06) * R * 0.97, 1.6])); ctx.lineTo(p[0], p[1]); }
      ctx.strokeStyle = 'rgba(30,30,34,0.3)'; ctx.lineWidth = LINE * 2.5; ctx.stroke();
    }
  };
}
function dust(seed, n) {
  return (ctx, x, y, k) => { const rnd = rng(seed); for (let i = 0; i < n; i++) puff(ctx, x - i * k * 0.7 + rnd() * k * 0.3, y - i * k * 0.32 - rnd() * k * 0.3, k * (0.35 + i * 0.1), [206, 184, 140], rnd, 0.85 - i * 0.12); };
}

// background smoke from the breach and a burning hut
fx([-3.2, 13.2, 1.0], 7, explosion(5, 1.1, 1.6));
fx([-14.6, 4.6, 0.2], 6, (ctx, x, y, k) => { const rnd = rng(8); for (let i = 0; i < 8; i++) puff(ctx, x + i * k * 0.35, y - i * k * 0.9, k * (0.5 + i * 0.16), mix([60, 56, 52], [130, 126, 120], i / 8), rnd, 0.9); });
// tower tracers at the jeep
for (const m of t2.muzzles.slice(0, 2)) fx(m, 3, trail([m, add(JEEP, [-1.0 + m[0] * 0.05, 1.6, 0.6])], { r0: 0, r1: 0, tracer: 0.06 }), 0.3);
// near miss behind the jeep
fx([-3.6, -0.2, 0.3], 6, explosion(11, 1.2));
fx(add(JEEP, [-0.9, 1.7, 0.2]), 5, dust(4, 3));
// ASV missile climbing at the helicopter
const mStart = av.pod, mEnd = add(HELI, [2.2, -0.5, -0.6]);
const mid = add(mix(mStart, mEnd, 0.5), [0, 0, 1.2]);
fx(mStart, 12, trail([mix(mid, mEnd, 0.35), mid, mix(mStart, mid, 0.5), mStart], { smoke: true, r0: 0.18, r1: 0.42, puffs: 16, head: [220, 220, 214], seed: 3 }), 1.0);
// helicopter rockets at the tank, one already hitting
for (const [i, pod] of h.pods.entries()) {
  const hit = [4.3 + i * 0.7, -2.7 - i * 0.3, 0.2];
  const head = mix(pod, hit, 0.55 + i * 0.12);
  fx(pod, 12, trail([head, mix(pod, head, 0.5), pod], { smoke: true, r0: 0.12, r1: 0.26, puffs: 10, head: [80, 80, 76], seed: 7 + i }), 1.0);
}
fx(h.hub, 8, rotorDisc(h.tf, 4.4), 2.0);
fx(h.tail, 2, (ctx, x, y, k) => { ctx.beginPath(); ctx.ellipse(x, y, k * 0.12, k * 0.75, 0.2, 0, 6.283); ctx.fillStyle = 'rgba(40,40,40,0.25)'; ctx.fill(); }, 1.0);
fx([4.4, -2.6, 0.3], 6, explosion(21, 1.05), 0);
// tank shell streaking past the helicopter
fx(tk.muzzle, 14, trail([add(tk.muzzle, mul(tk.dir, 4.5)), add(tk.muzzle, mul(tk.dir, 0.8))], { r0: 0, r1: 0, tracer: 0.09 }), 0.5);
const fd = proj(add(tk.muzzle, tk.dir)), fm = proj(tk.muzzle);
fx(tk.muzzle, 4, flash([fd[0] - fm[0], fd[1] - fm[1]], 0.75), 0.5);
fx(add(tk.muzzle, mul(tk.dir, -0.2)), 4, (ctx, x, y, k) => { const rnd = rng(31); for (let i = 0; i < 4; i++) puff(ctx, x - k * (0.3 + i * 0.25), y + k * (0.2 + i * 0.08), k * (0.2 + i * 0.05), [200, 196, 188], rnd, 0.8 - i * 0.15); }, 0.2);
// tower 3 firing at the ASV
for (const m of t1.muzzles.slice(1)) fx(m, 3, flash([1, 0.6], 0.3), 0.3);

// ---- rendering -------------------------------------------------------------------------------------------------
function raster(pts, w, h, cb) {
  const [a, b, c] = pts;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) * inv;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      cb(y * w + x, w0 * a[2] + w1 * b[2] + w2 * c[2]);
    }
  }
}

function render() {
  const N = W * H;
  const depth = new Float32Array(N), id = new Int32Array(N).fill(-1);
  tris.forEach((t, i) => {
    const p = t.v.map(proj);
    if (p.some((q) => q[2] < 0.5)) return;
    raster(p.map((q) => [q[0], q[1], 1 / q[2]]), W, H, (k, iz) => { if (iz > depth[k]) { depth[k] = iz; id[k] = i; } });
  });
  // shadow map
  const SM = 4096, SR = 34, SC = [0, 4, 0];
  const sdepth = new Float32Array(SM * SM).fill(-1e9);
  const lp = (p) => { const d = sub(p, SC); return [(dot(d, LU) / SR + 1) * SM / 2, (1 - dot(d, LV) / SR) * SM / 2, dot(d, LIGHT)]; };
  tris.forEach((t) => {
    if (t.mat === 'ground') return;
    raster(t.v.map(lp), SM, SM, (k, d) => { if (d > sdepth[k]) sdepth[k] = d; });
  });
  const shadowAt = (p) => {
    const [sx, sy, d] = lp(p);
    let lit = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const x = Math.floor(sx) + ox * 2, y = Math.floor(sy) + oy * 2;
      if (x < 0 || y < 0 || x >= SM || y >= SM) { lit++; continue; }
      lit += d >= sdepth[y * SM + x] - 0.06 ? 1 : 0;
    }
    return lit / 9;
  };
  const col = new Float32Array(N * 3);
  const world = (k) => {
    const px = (k % W) + 0.5, py = Math.floor(k / W) + 0.5, zc = 1 / depth[k];
    const xc = (px - W / 2) * zc / F, yc = -(py - H / 2) * zc / F;
    return add(CAM, add([xc, 0, 0], add(mul(UP, yc), mul(FWD, zc))));
  };
  for (let k = 0; k < N; k++) {
    const i = id[k];
    if (i < 0) { const t = Math.floor(k / W) / H; col.set(mix([150, 190, 226], [214, 226, 232], clamp(t * 5)), k * 3); continue; }
    const t = tris[i], p = world(k);
    let n = t.n;
    const view = norm(sub(p, CAM));
    if (dot(n, view) > 0) n = mul(n, -1);
    let base = t.col;
    let amb = 0.5, dif = 0.62, spec = 0;
    if (t.mat === 'ground') { base = groundCol(p[0], p[1]); amb = 0.62; dif = 0.45; }
    else if (t.mat === 'stone') { const b = fbm(p[0] * 1.3 + p[2], p[1] * 1.3 + p[2] * 0.7); base = shade(base, 0.86 + 0.24 * b - (b < 0.38 ? 0.1 : 0)); }
    else if (t.mat === 'glass' || t.mat === 'metal') spec = t.mat === 'glass' ? 0.9 : 0.35;
    else if (t.mat === 'lamp') { amb = 1.05; dif = 0; }
    else if (t.mat === 'tread') base = shade(base, 0.85 + 0.3 * ((Math.floor(p[0] * 0 + (p[1] + p[2]) * 6) & 1)));
    const nl = dot(n, LIGHT), sh = nl > 0 ? shadowAt(p) : 0;
    let light = amb + dif * Math.max(0, nl) * sh;
    if (t.mat === 'leaf') light = amb + 0.2 + dif * Math.abs(nl) * sh * 0.8;
    let c = shade(base, light);
    if (!t.mat || spec) {
      const hv = norm(sub(LIGHT, view)), s = Math.pow(Math.max(0, dot(n, hv)), 24) * (spec || 0.22) * sh;
      c = add(c, [255 * s, 250 * s, 235 * s]);
    }
    // haze with distance
    const zc = 1 / depth[k], hz = clamp((zc - 24) / 46, 0, 0.45);
    c = mix(c, [196, 214, 222], hz);
    col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
  }
  // cel outlines: on the far side of every edge between parts, plus a fainter crease between faces of a part
  const out = new Float32Array(col);
  const r = 2;
  for (let y = r; y < H - r; y++) for (let x = r; x < W - r; x++) {
    const k = y * W + x, i = id[k];
    if (i < 0) continue;
    let edge = 0;
    for (let d = 1; d <= r && edge < 1; d++) for (const o of [d, -d, d * W, -d * W]) {
      const j = id[k + o];
      if (j < 0 || j === i) continue;
      const tj = tris[j], ti = tris[i];
      if (tj.part !== ti.part) { if (depth[k + o] > depth[k] * 1.0005 || (d === 1 && depth[k + o] >= depth[k])) { edge = 1; break; } }
      else if (d === 1 && ti.mat !== 'ground' && ti.mat !== 'leaf' && dot(ti.n, tj.n) < 0.75 && dot(ti.n, tj.n) > -0.75) edge = Math.max(edge, 0.45);
    }
    if (edge) {
      const f = 1 - 0.68 * edge;
      out[k * 3] = col[k * 3] * f; out[k * 3 + 1] = col[k * 3 + 1] * f; out[k * 3 + 2] = col[k * 3 + 2] * f;
    }
  }
  // effects with a depth test against the scene
  for (const e of FX) {
    const a = proj(e.world), k = F / a[2], R = Math.ceil(e.size * k * 1.6 + 40);
    const full = e.size >= 12;
    const ox = full ? 0 : Math.floor(a[0] - R), oy = full ? 0 : Math.floor(a[1] - R), cw = full ? W : 2 * R, ch = full ? H : 2 * R;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d'); ctx.translate(-ox, -oy); ctx.lineJoin = 'round';
    e.draw(ctx, a[0], a[1], k);
    const img = ctx.getImageData(0, 0, cw, ch).data, iz = 1 / Math.max(0.5, a[2] - e.bias);
    for (let y = 0; y < ch; y++) {
      const sy = y + oy; if (sy < 0 || sy >= H) continue;
      for (let x = 0; x < cw; x++) {
        const sx = x + ox; if (sx < 0 || sx >= W) continue;
        const al = img[(y * cw + x) * 4 + 3] / 255; if (!al) continue;
        const kk = sy * W + sx;
        if (id[kk] >= 0 && tris[id[kk]].mat !== 'ground' && depth[kk] > iz) continue;
        for (let c = 0; c < 3; c++) out[kk * 3 + c] = lerp(out[kk * 3 + c], img[(y * cw + x) * 4 + c], al);
      }
    }
  }
  // downsample
  const cv = document.getElementById('c'); cv.width = OW; cv.height = OH;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(OW, OH);
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
    const s = [0, 0, 0];
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) { const k = ((y * SS + j) * W + x * SS + i) * 3; s[0] += out[k]; s[1] += out[k + 1]; s[2] += out[k + 2]; }
    const o = (y * OW + x) * 4;
    img.data[o] = s[0] / (SS * SS); img.data[o + 1] = s[1] / (SS * SS); img.data[o + 2] = s[2] / (SS * SS); img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
render();
window.done = true;
