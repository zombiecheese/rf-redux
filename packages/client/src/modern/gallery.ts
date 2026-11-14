// A sheet of every modern model, for reviewing the art in the dev server (npm run dev, then /modern-gallery.html).
// ?part=buildings (the default) lays out every building for Brown, Green and neutral; ?part=vehicles every vehicle
// in the four sides' colours. It is not part of the build.

import * as THREE from 'three';
import { loadCommon } from '../assets.js';
import { TEAMS } from '../paint.js';
import { building } from './buildings.js';
import { Kit, NEUTRAL, teamPaint } from './kit.js';
import { bodyBox } from './renderer.js';
import * as V from './vehicles.js';

const part = new URLSearchParams(location.search).get('part') ?? 'buildings';
const data = await loadCommon();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
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

const put = (kit: Kit | null, x: number, y: number, team = NEUTRAL, label = '') => {
  if (kit) {
    const mesh = new THREE.Mesh(kit.build(team), material);
    mesh.position.set(x, 0, y);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (label) labels.push({ text: label, x, y: y + 26 });
};

let w = 0;
let h = 0;
if (part === 'vehicles') {
  const makers = [V.tank, V.jeep, V.asv, V.heli, V.drone];
  makers.forEach((make, i) => {
    paints.forEach((p, t) => {
      const k = make();
      const all = new Kit().merge(k.body);
      if (k.turret) all.merge(k.turret);
      if (k.barrel) all.merge(k.barrel, 0, k.pivot![0], k.pivot![1]);
      if (k.rotor) all.merge(k.rotor, ...k.rotorAt!);
      for (const at of k.wheelAt ?? []) all.merge(k.wheels!, ...at);
      put(all, t * 70, i * 80, p, t === 0 ? ['tank', 'jeep', 'asv', 'heli', 'drone'][i] : '');
    });
  });
  put(V.submarine(), 340, 120, NEUTRAL, 'sub');
  ['tracer', 'shell', 'missile', 'big'].forEach((s, i) => put(V.shot(s as 'tracer'), 300 + i * 20, 320, NEUTRAL));
  for (let i = 0; i < 4; i++) put(V.soldier(i * 1.57), 300 + i * 12, 360, paints[i]!);
  w = 420;
  h = 420;
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
}
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 10, 6000);
const cx = w / 2 - 40;
const cy = h / 2 - 40;
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
