// The gallery's water scene (modern-gallery.html?part=water): vehicles wading, floating and a helicopter hovering by
// a shore, drawn by the modern renderer, to look at the sea's depth, wakes, downwash and reflections. Not part of
// the build.

import { DEEP, GRID, LAND, SHALLOW, groundAt, makeVehicle, type Vehicle, type VehicleKind } from '@rfw/sim';
import { Camera, layout } from '../camera.js';
import { lightOf } from './buildings.js';
import { bodyBox } from './renderer.js';

const TILE = 32;

export async function waterScene(q: URLSearchParams): Promise<never> {
  const { loadAssets } = await import('../assets.js');
  const { buildWorld, createMatch } = await import('@rfw/sim');
  const { ModernRenderer, modernLayout } = await import('./renderer.js');
  const assets = await loadAssets(q.get('map') ?? 'rfmap101');
  const world = buildWorld(assets.map, assets.defs, assets.shore);
  const match = createMatch(world, assets.map, world.bases.map((b) => ({ base: b.id, team: b.id })), 1, { difficulty: 5 });
  const modern = new ModernRenderer(assets);
  const night = q.get('night') === '1';
  modern.setNight(night);
  modern.setLook(true, q.get('thermal') === '1');
  const g = (x: number, y: number) => groundAt(world, Math.round(x * 65536), Math.round(y * 65536));

  // The shore to look at: shallows with deep water beyond, land, and lamps (lit buildings) close by.
  let best = { score: -1, x: 0, y: 0, lamps: 0 };
  for (let ty = 4; ty < GRID - 4; ty += 2) {
    for (let tx = 6; tx < GRID - 6; tx += 2) {
      let shallow = 0;
      let deep = 0;
      let land = 0;
      let lamps = 0;
      for (let j = -3; j <= 3; j++) {
        for (let i = -5; i <= 5; i++) {
          const k = g((tx + i) * TILE + 16, (ty + j) * TILE + 16);
          if (k === SHALLOW) shallow++;
          else if (k === DEEP) deep++;
          else land++;
          const bid = world.building[(ty + j) * GRID + tx + i]!;
          const def = bid ? world.defs[bid] : null;
          if (def && lightOf(def.name, bodyBox(assets.parts[bid] ?? [])) && Math.abs(i) < 4 && Math.abs(j) < 3) {
            // A lamp counts when there is water right by it.
            let wet = false;
            for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (g((tx + i + a) * TILE + 16, (ty + j + b) * TILE + 16) !== LAND) wet = true;
            if (wet) lamps++;
          }
        }
      }
      const score = Math.min(shallow, 22) * 2 + Math.min(deep, 18) + Math.min(land, 14) + Math.min(lamps, 4) * (q.get('lamps') === '1' ? 40 : 8);
      if (shallow >= 10 && deep >= 8 && land >= 6 && score > best.score) best = { score, x: tx * TILE + 16, y: ty * TILE + 16, lamps };
    }
  }
  // A circle to drive round that stays all in one ground, as near the shore as can be.
  const used: { x: number; y: number }[] = [];
  const circle = (want: number, r: number) => {
    for (let d = 0; d < 700; d += 8) {
      for (let k = 0; k < 32; k++) {
        const x = best.x + Math.cos((k / 32) * Math.PI * 2) * d;
        const y = best.y + Math.sin((k / 32) * Math.PI * 2) * d;
        if (used.some((u) => Math.hypot(u.x - x, u.y - y) < r * 2 + 20)) continue;
        let ok = true;
        for (let i = 0; i < 24 && ok; i++) {
          for (const rr of [r - 12, r, r + 12]) if (g(x + Math.cos((i / 24) * Math.PI * 2) * rr, y + Math.sin((i / 24) * Math.PI * 2) * rr) !== want) ok = false;
        }
        if (ok) {
          used.push({ x, y });
          return { x, y };
        }
      }
    }
    return { x: best.x, y: best.y };
  };
  type Actor = { v: Vehicle; cx: number; cy: number; r: number; a: number; sp: number };
  const actors: Actor[] = [];
  const add = (kind: VehicleKind, ground: number, name: string) => {
    const r = kind === 'heli' ? 26 : 34;
    const at = circle(ground, r);
    const p = match.players[actors.length % match.players.length]!;
    const v = makeVehicle(kind, p.id, p.team, p.base, Math.round(at.x * 65536), Math.round(at.y * 65536));
    if (name === 'float') {
      v.tyres = true;
      v.inflate = 65536;
    }
    if (kind === 'heli' && v.heli) {
      v.z = 50 << 16;
      v.heli.phase = 'flying' as typeof v.heli.phase;
      v.heli.rotorSpeed = 0x40000;
      v.heli.engine = 65536;
    }
    const sp = { tank: 0.75, jeep: name === 'float' ? 0.5 : 1.1, asv: 0.6, heli: 0.5 }[kind];
    actors.push({ v, cx: at.x, cy: at.y, r, a: Math.random() * Math.PI * 2, sp });
    return v;
  };
  const named: Record<string, Vehicle> = {
    tank: add('tank', SHALLOW, 'tank'),
    jeep: add('jeep', SHALLOW, 'jeep'),
    asv: add('asv', SHALLOW, 'asv'),
    float: add('jeep', DEEP, 'float'),
    heli: add('heli', DEEP, 'heli'),
  };
  // Each player shows one of them (the renderer draws players' vehicles); the rest ride on spare player slots.
  const shown = actors.map((a) => a.v);
  while (match.players.length < shown.length) match.players.push({ ...match.players[0]!, id: match.players.length });
  shown.forEach((v, i) => (match.players[i]!.vehicle = v));
  const follow = named[q.get('follow') ?? 'tank'] ?? named.tank!;
  const split = q.get('split') === '1';
  const cams = layout(split ? 2 : 1).map((r) => new Camera(r));
  const rects = modernLayout(cams.length);
  const out = document.createElement('canvas');
  out.width = 1280;
  out.height = 720;
  Object.assign(out.style, { width: '100vw', height: '100vh', objectFit: 'contain' });
  document.body.style.margin = '0';
  document.body.appendChild(out);
  const ctx = out.getContext("2d")!;
  const tick = () => {
    for (const a of actors) {
      const v = a.v;
      // Round the circle clockwise, facing the way it goes.
      a.a += a.sp / a.r;
      v.x = Math.round((a.cx + Math.cos(a.a) * a.r) * 65536);
      v.y = Math.round((a.cy + Math.sin(a.a) * a.r) * 65536);
      v.heading = Math.round(((a.a + Math.PI) / (Math.PI * 2)) * 64 * 65536) & 0x3fffff;
      v.speed = Math.round(a.sp * 65536);
      v.ground = v.kind === 'heli' ? LAND : g(v.x / 65536, v.y / 65536);
      if (v.heli) v.heli.rotor = (v.heli.rotor + v.heli.rotorSpeed) & 0x3fffff;
    }
    // &follow=none rests the camera on the shore found (moved by &dx= and &dy= pixels).
    if (q.get('follow') === 'none') cams[0]!.update(null, best.x + Number(q.get('dx') ?? 0), best.y + Number(q.get('dy') ?? 0));
    else cams[0]!.update(follow, 0, 0);
    if (cams[1]) cams[1].update(named[q.get('follow2') ?? 'heli']!, 0, 0);
  };
  // &fixed=1 runs at a steady 60 frames a second of make-believe time, however slowly the browser draws (for
  // screenshots from a software renderer): the clock the renderer reads moves on a frame each frame.
  const fixed = q.get('fixed') === '1';
  let clock = performance.now();
  if (fixed) performance.now = () => clock;
  let frames = 0;
  let last = performance.now();
  let acc = 0;
  const frame = (real: number) => {
    if (fixed) clock += 1000 / 60;
    const now = fixed ? clock : real;
    frames++;
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= 16) {
      tick();
      match.tick++;
      acc -= 16;
    }
    // At make-believe time only the last frames are drawn: the ones before only move the water along.
    const skip = fixed && (frames * 1000) / 60 < wait - 100;
    modern.draw(match, cams.map((cam, i) => ({ cam, rect: rects[i]!, viewer: 0, skip })), { wrecks: [], splats: [] });
    ctx.drawImage(modern.canvas, 0, 0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const wait = Number(q.get('wait') ?? 4000);
  if (fixed) {
    const check = () => (frames * 1000) / 60 >= wait ? (document.title = 'ready') : setTimeout(check, 50);
    check();
  } else setTimeout(() => (document.title = 'ready'), wait);
  return new Promise<never>(() => {});
}
