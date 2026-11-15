// A sheet of every modern model, for reviewing the art in the dev server (npm run dev, then /modern-gallery.html).
// ?part=buildings (the default) lays out every building for Brown, Green and neutral; ?part=vehicles every vehicle
// in the four sides' colours; ?part=bunker and ?part=skull the two screens (skull takes &face=1-7 and &angle=0-63);
// ?part=finale the modern win scene (&base=0-3 wins, &tier=0-3, &night=1, &thermal=1, &t=ms to hold at);
// ?part=water vehicles in the sea by a shore (&map=, &night=1, &follow=tank|jeep|asv|heli|float, &split=1), for
// the sea's depth, wakes, downwash and reflections.
// It is not part of the build.

import * as THREE from 'three';
import { loadCommon } from '../assets.js';
import { TEAMS } from '../paint.js';
import { building } from './buildings.js';
import { Kit, NEUTRAL, teamPaint } from './kit.js';
import { bodyBox } from './renderer.js';
import * as V from './vehicles.js';
import { charredPlastic, gardenSky, melted, toyPlastic } from './toy.js';
import { ONE } from '@rfw/sim';
import { BunkerScene, SkullScene } from './screens.js';

const part = new URLSearchParams(location.search).get('part') ?? 'buildings';
if (part === 'finale') {
  const q = new URLSearchParams(location.search);
  const { loadAssets } = await import('../assets.js');
  const { buildWorld, createMatch } = await import('@rfw/sim');
  const { ModernRenderer } = await import('./renderer.js');
  const { modernWinScene } = await import('./finale.js');
  const assets = await loadAssets(q.get('map') ?? 'rfmap101');
  const world = buildWorld(assets.map, assets.defs, assets.shore);
  const match = createMatch(world, assets.map, world.bases.map((b) => ({ base: b.id, team: b.id })), 1, { difficulty: 5 });
  const modern = new ModernRenderer(assets);
  modern.setNight(q.get('night') === '1');
  modern.setLook(true, q.get('thermal') === '1');
  const scene = modernWinScene(match, { renderer: modern, extras: { wrecks: [], splats: [] } }, Number(q.get('base') ?? 0), Number(q.get('tier') ?? 1), 754000);
  const out = document.createElement('canvas');
  out.width = 1280;
  out.height = 720;
  document.body.style.margin = '0';
  document.body.appendChild(out);
  const ctx = out.getContext('2d')! as unknown as OffscreenCanvasRenderingContext2D;
  const hold = q.get('t') === null ? null : Number(q.get('t'));
  const begun = performance.now();
  const frame = (now: number) => {
    const t = hold ?? (now - begun) % scene.ms;
    scene.draw(ctx, hold !== null ? Math.min(hold, now - begun) : t);
    if (hold !== null && now - begun >= hold) document.title = 'ready';
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  await new Promise(() => {});
}
if (part === 'water') {
  const { waterScene } = await import('./watergallery.js');
  await waterScene(new URLSearchParams(location.search));
}
const data = await loadCommon();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
if (part === 'bunker' || part === 'skull') {
  const q = new URLSearchParams(location.search);
  const sides = TEAMS.map((t) => teamPaint(t.colour & 255, (t.colour >> 8) & 255, (t.colour >> 16) & 255));
  if (part === 'skull') {
    const sk = new SkullScene();
    sk.frame(innerWidth / innerHeight);
    const look = { map: null, scale: 0x13333, angle: Number(q.get('angle') ?? 0) * ONE, face: Number(q.get('face') ?? 1), lives: ONE, light: ONE };
    sk.update(look, sides[1]!, sides[0]!, 'tank', 2, 4);
    renderer.render(sk.dim, sk.camera);
    renderer.autoClear = false;
    renderer.render(sk.scene, sk.camera);
  } else {
    const b = new BunkerScene();
    b.frame(innerWidth / innerHeight);
    b.update(sides[Number(q.get('base') ?? 0)]!, { tank: 3, jeep: 8, asv: 0, heli: 3 }, 'tank', null, 0);
    renderer.render(b.scene, b.camera);
  }
  document.title = 'ready';
  await new Promise(() => {});
}
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9c49a);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x8a6a48, 1.25));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -900, right: 900, top: 900, bottom: -900, near: 10, far: 3000 });
scene.add(sun, sun.target);
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.04 });
const paints = TEAMS.map((t) => teamPaint(t.colour & 255, (t.colour >> 8) & 255, (t.colour >> 16) & 255));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0xe3c08a }));
floor.rotateX(-Math.PI / 2);
floor.receiveShadow = true;
scene.add(floor);
const labels: { text: string; x: number; y: number }[] = [];

const plastic = toyPlastic();
plastic.envMap = gardenSky(renderer, new THREE.Vector3(-0.55, 0.85, 0.7));
const charred = charredPlastic();
charred.envMap = plastic.envMap;
// The buildings' plastic, as the renderer's playset material.
const playsetPlastic = toyPlastic();
playsetPlastic.roughness = 0.4;
playsetPlastic.clearcoat = 0.25;
playsetPlastic.envMap = plastic.envMap;
const put = (kit: Kit | null, x: number, y: number, team = NEUTRAL, label = '', lift = 0) => {
  if (kit) {
    const mesh = new THREE.Mesh(kit.build(team), kit.burnt ? charred : kit.toy ? (part === 'vehicles' ? plastic : playsetPlastic) : material);
    mesh.position.set(x, lift, y);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (label) labels.push({ text: label, x, y: y + 26 });
};

let w = 0;
let h = 0;
let focus: [number, number] | null = null;
if (part === 'vehicles') {
  const makers = [V.tank, V.jeep, V.asv, V.heli, V.drone];
  makers.forEach((make, i) => {
    paints.forEach((p, t) => {
      const k = make();
      const all = new Kit(true).merge(k.body);
      if (k.turret) all.merge(k.turret);
      if (k.barrel) all.merge(k.barrel, 0, k.pivot![0], k.pivot![1]);
      if (k.rotor) all.merge(k.rotor, ...k.rotorAt!);
      // &tyres=1 shows the jeep on its blown-up tyres, scaled and raised as the renderer does when they inflate.
      const blown = make === V.jeep && new URLSearchParams(location.search).get('tyres') === '1';
      // &melt=1 shows each body as its burnt-out wreck, melted, as a wreck at rest is drawn.
      if (new URLSearchParams(location.search).get('melt') === '1') {
        Kit.fine = true;
        const body = make().body;
        Kit.fine = false;
        const m = new THREE.Mesh(melted(body.build(p), t + 3), charred);
        m.position.set(t * 70, 0, i * 80);
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
        if (t === 0) labels.push({ text: ['tank', 'jeep', 'asv', 'heli', 'drone'][i]!, x: 0, y: i * 80 + 26 });
        return;
      }
      if (!blown) for (const at of k.wheelAt ?? []) all.merge(k.wheels!, ...at);
      put(all, t * 70, i * 80, p, t === 0 ? ['tank', 'jeep', 'asv', 'heli', 'drone'][i] : '', blown ? 2.2 : 0);
      if (blown) {
        for (const [wx, wy, wz] of k.wheelAt!) {
          const w = new THREE.Mesh(k.wheels!.build(p), plastic);
          w.scale.set(1.5, 1.75, 1.75);
          w.position.set(t * 70 + wx, wz + 2.2, i * 80 + wy);
          w.castShadow = w.receiveShadow = true;
          scene.add(w);
        }
      }
    });
  });
  put(V.submarine(), 340, 120, NEUTRAL, 'sub');
  ['tracer', 'shell', 'missile', 'big'].forEach((s, i) => put(V.shot(s as 'tracer'), 300 + i * 20, 320, NEUTRAL));
  for (let i = 0; i < 4; i++) put(V.soldier(i * 1.57), 300 + i * 12, 360, paints[i]!);
  w = 420;
  h = 420;
  // &zoom=<row 0-4> looks closely along one row (tank, jeep, asv, heli, drone), &zoom=men at the soldiers.
  const zoom = new URLSearchParams(location.search).get('zoom');
  if (zoom === 'men') {
    w = 36;
    h = 36;
    focus = [318, 360];
  } else if (zoom !== null && zoom.includes(',')) {
    // &zoom=x,y,span looks closely at one spot, e.g. &zoom=0,0,30 at the Brown tank.
    const [zx, zy, span] = zoom.split(',').map(Number);
    w = span!;
    h = span!;
    focus = [zx!, zy!];
  } else if (zoom !== null) {
    w = 200;
    h = 70;
    focus = [105, Number(zoom) * 80];
  }
} else {
  const cols = 8;
  const from = Number(new URLSearchParams(location.search).get('from') ?? 1);
  const to = Number(new URLSearchParams(location.search).get('to') ?? data.defs.length - 1);
  data.defs.forEach((def, i) => {
    if (i < from || i > to) return;
    const x = ((i - from) % cols) * 80;
    const y = Math.floor((i - from) / cols) * 80;
    const box = bodyBox(data.parts[i] ?? []);
    put(building(def, def.name, box, i), x, y, paints[0], `${i} ${def.name}`);
  });
  w = cols * 80;
  h = Math.ceil((to - from + 1) / cols) * 80;
  // &zoom=x,y,span looks closely at one spot here too, e.g. &from=23&zoom=80,0,170 at a row of houses.
  const zoom = new URLSearchParams(location.search).get('zoom');
  if (zoom?.includes(',')) {
    const [zx, zy, span] = zoom.split(',').map(Number);
    w = span!;
    h = span!;
    focus = [zx!, zy!];
  }
}
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 10, 6000);
const cx = focus ? focus[0] : w / 2 - 40;
const cy = focus ? focus[1] : h / 2 - 40;
camera.position.set(cx, Math.max(w, h) * 1.25, cy + Math.max(w, h) * 0.9);
camera.lookAt(cx, 0, cy);
sun.target.position.set(cx, 0, cy);
sun.position.set(cx - 400, 900, cy + 500);
renderer.render(scene, camera);
const overlay = document.createElement('canvas');
overlay.width = innerWidth;
overlay.height = innerHeight;
Object.assign(overlay.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none' });
document.body.appendChild(overlay);
const g = overlay.getContext('2d')!;
g.font = '11px system-ui';
g.textAlign = 'center';
g.fillStyle = '#222';
for (const l of labels) {
  const p = new THREE.Vector3(l.x, 0, l.y).project(camera);
  g.fillText(l.text, ((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight);
}
document.title = 'ready';
