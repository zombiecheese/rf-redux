// The gallery's lift scene (modern-gallery.html?part=lift): a vehicle coming up on the bunker lift, or going down
// on it, drawn by the modern renderer and the classic view side by side, to look at the launch and dock frame by
// frame. &kind=tank|jeep|asv|heli, &dock=1, &night=1. window.liftAt(tick, part) runs the real sim to that tick of
// the lift (part, 0-1, is how far on to the next tick) and draws it. Not part of the build.

import { GATE_H, GATE_V, GRID, ONE, createMatch, dock, launch, launchNow, liftOf, makeVehicle, openGate, stepGate, stepMatch, type VehicleKind } from '@rfw/sim';
import { Camera, layout } from '../camera.js';
import { Frame, SCREEN_H, SCREEN_W } from '../raster.js';
import { drawView } from '../view.js';
import { dimView } from './hud.js';

export async function liftScene(q: URLSearchParams): Promise<never> {
  const { loadAssets } = await import('../assets.js');
  const { buildWorld } = await import('@rfw/sim');
  const { ModernRenderer, modernLayout } = await import('./renderer.js');
  const assets = await loadAssets(q.get('map') ?? 'rfmap101');
  const kind = (q.get('kind') ?? 'tank') as VehicleKind;
  const docking = q.get('dock') === '1';
  const modern = new ModernRenderer(assets);
  modern.setNight(q.get('night') === '1');
  modern.setLook(true, false);
  const fixed = q.get('fixed') !== '0';
  let clock = performance.now();
  if (fixed) performance.now = () => clock;

  const out = document.createElement('canvas');
  out.width = 1280;
  out.height = 720;
  const low = document.createElement('canvas');
  low.width = SCREEN_W;
  low.height = SCREEN_H;
  Object.assign(out.style, { width: '1280px', height: '720px', display: 'block' });
  Object.assign(low.style, { width: '1280px', height: '960px', display: 'block', imageRendering: 'pixelated' });
  document.body.style.margin = '0';
  document.body.append(out, low);
  const ctx = out.getContext('2d')!;
  const lowCtx = low.getContext('2d')!;
  const frame = new Frame();
  const image = new ImageData(new Uint8ClampedArray(frame.px.buffer), SCREEN_W, SCREEN_H);

  const gateMode = q.get('gate') === '1';
  const fresh = () => {
    const world = buildWorld(assets.map, assets.defs, assets.shore);
    const m = createMatch(world, assets.map, world.bases.map((b) => ({ base: b.id, team: b.id })), 1, { difficulty: 5 });
    const cam = new Camera(layout(1)[0]!);
    const home = world.bases[m.players[0]!.base]!.start;
    const follow = () => {
      const p = m.players[0]!;
      cam.update(p.vehicle ?? (p.state === 'docking' ? liftOf(m, 0)?.vehicle ?? null : null), home.tx * 32 + 16, home.ty * 32 + 16);
    };
    const step = () => {
      stepMatch(m, []);
      follow();
    };
    if (gateMode) {
      // The base's own gate nearest its lift, opened by a vehicle that stays in its zone for &stay= ticks.
      const b = world.bases[0]!.start;
      let best = -1;
      for (let i = 0; i < GRID * GRID; i++) {
        const bid = world.building[i]!;
        if (bid !== GATE_H && bid !== GATE_V) continue;
        const d = Math.hypot((i % GRID) - b.tx, Math.floor(i / GRID) - b.ty);
        if (best < 0 || d < Math.hypot((best % GRID) - b.tx, Math.floor(best / GRID) - b.ty)) best = i;
      }
      const gx = (best % GRID) * 32 + 16;
      const gy = Math.floor(best / GRID) * 32 + 16;
      const v = makeVehicle(kind, 0, 0, 0, gx << 16, gy << 16);
      const g = openGate(world, best, 0, v)!;
      m.gates.push(g);
      m.players[0]!.fade = ONE;
      const stay = Number(q.get('stay') ?? 45);
      let t = 0;
      const gstep = () => {
        t++;
        const r = stepGate(world, g, () => t < stay);
        if (!r.keep) m.gates.splice(m.gates.indexOf(g), 1);
        m.tick++;
        cam.update(null, gx + Number(q.get('dx') ?? 0), gy + Number(q.get('dy') ?? 0));
      };
      for (let i = 0; i < 40; i++) cam.update(null, gx, gy);
      return { m, cam, step: gstep, start: m.tick };
    }
    if (docking) {
      launchNow(m, 0, kind);
      for (let i = 0; i < 90; i++) step();
      dock(m, 0);
    } else {
      while (!launch(m, 0, kind)) step();
    }
    return { m, cam, step, start: m.tick };
  };
  let s = fresh();
  const rect = modernLayout(1)[0]!;
  const draw = (part: number) => {
    const p = s.m.players[0]!;
    modern.part = part;
    modern.draw(s.m, [{ cam: s.cam, rect, viewer: 0, skip: false }], { wrecks: [], splats: [] });
    ctx.drawImage(modern.canvas, 0, 0);
    dimView(ctx, rect, p.fade);
    frame.setClip(0, 0, SCREEN_W, SCREEN_H);
    frame.fill(0xff000000);
    drawView(frame, s.cam, s.m, assets, 0, { sprites: [], wrecks: [], splats: [] });
    if (p.fade < ONE) frame.dim(p.fade / ONE);
    lowCtx.putImageData(image, 0, 0);
    return { opening: (s.m.gates[0]?.opening ?? 0) / ONE, state: p.state, phase: liftOf(s.m, 0)?.phase ?? null, z: (liftOf(s.m, 0)?.z ?? 0) / ONE, fade: p.fade / ONE, elevator: !!p.elevator };
  };
  // Ticks after the launch (or the dock) that the lift's own steps start: the bunker's elevator and fade come first.
  (window as unknown as { liftAt: (t: number, part?: number) => unknown }).liftAt = (t: number, part = 0) => {
    if (s.m.tick - s.start > t) s = fresh();
    while (s.m.tick - s.start < t) {
      s.step();
      clock += 16;
      modern.draw(s.m, [{ cam: s.cam, rect, viewer: 0, skip: true }], { wrecks: [], splats: [] });
    }
    clock += 16;
    return draw(part);
  };
  document.title = 'ready';
  return new Promise<never>(() => {});
}
