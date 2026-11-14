// The modern view's two full-view screens, as scenes of their own drawn with the playfield's WebGL renderer: the
// bunker, where a player picks the next vehicle, and the laughing skull after a vehicle is lost.
//
// The bunker is a cutaway of the hillside, laid out as the retro bunker screen: the lift shaft in the middle, the
// helicopter and tank bays above, the ASV and jeep bays below, a model parked in each bay that still has lives, and a
// spotlight and running lights on the chosen bay. Units are the retro screen's pixels from the top of the shaft, so
// the sim's elevator (its lift height and the vehicle's slide and rise) moves the models as it moves the sprites.
//
// The skull wears the rival side's helmet; it grows and spins in over the dimmed map as the retro skull does, then
// laughs over a row of the lost vehicle's kind, the ones used up burnt out.

import * as THREE from 'three';
import { ONE, UNLIMITED, type Elevator, type Lives, type SkullLook, type VehicleKind } from '@rfw/sim';
import { Kit, type TeamPaint } from './kit.js';
import * as V from './vehicles.js';
import { BAY_AT } from './layout.js';

export { BAY_AT };

const KITS: Record<VehicleKind, () => V.VehicleKits> = { tank: V.tank, jeep: V.jeep, asv: V.asv, heli: V.heli };

const SHAFT = 17;
const BAY_FAR = 70;
const BAY_H = 28;
const SURFACE = 12;
const DEPTH = 40;
const PARK_SCALE = 1;
/** The lift's resting height, as the sim's ELEVATOR_REST. */
const LIFT_REST = 110;

const DIRT = 0x7b5434;
const DIRT_DARK = 0x5c3d25;
const CONCRETE = 0x9a968c;
const CONCRETE_DARK = 0x6f6c66;
const STEEL = 0x5d636b;
const HAZARD = 0xf0b429;
const GRASS = 0x6aa84f;

const BONE = 0xece3cc;
const SOCKET = 0x1b1512;

/** A vehicle's model at rest, all its parts in place, as one group. */
function parked(kind: VehicleKind, team: TeamPaint, material: THREE.Material): THREE.Group {
  const kits = KITS[kind]();
  const g = new THREE.Group();
  const mesh = (k: Kit) => {
    const m = new THREE.Mesh(k.build(team), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  g.add(mesh(kits.body));
  if (kits.turret) g.add(mesh(kits.turret));
  if (kits.barrel) {
    const b = mesh(kits.barrel);
    const [py, pz] = kits.pivot ?? [0, 0];
    b.position.set(0, pz, py);
    g.add(b);
  }
  if (kits.rotor) {
    const r = mesh(kits.rotor);
    const [x, y, z] = kits.rotorAt ?? [0, 0, 0];
    r.position.set(x, z, y);
    // Blades along the bay, clear of the walls.
    r.rotation.y = Math.PI / 4;
    r.name = 'rotor';
    g.add(r);
  }
  if (kits.tail) {
    const t = mesh(kits.tail);
    const [x, y, z] = kits.tailAt ?? [0, 0, 0];
    t.position.set(x, z, y);
    g.add(t);
  }
  for (const [x, y, z] of kits.wheelAt ?? []) {
    const w = mesh(kits.wheels!);
    w.position.set(x, z, y);
    g.add(w);
  }
  return g;
}

/** The earth of the cutaway: everything below the surface but the shaft and the four bays, a notch from the top. */
function earthShape(): THREE.Shape {
  const s = new THREE.Shape();
  const W = 600;
  const bottom = -500;
  s.moveTo(-W, SURFACE);
  s.lineTo(-SHAFT, SURFACE);
  for (const floor of [-72, -110]) {
    s.lineTo(-SHAFT, floor + BAY_H);
    s.lineTo(-BAY_FAR, floor + BAY_H);
    s.lineTo(-BAY_FAR, floor);
    s.lineTo(-SHAFT, floor);
  }
  s.lineTo(-SHAFT, -320);
  s.lineTo(SHAFT, -320);
  for (const floor of [-110, -72]) {
    s.lineTo(SHAFT, floor);
    s.lineTo(BAY_FAR, floor);
    s.lineTo(BAY_FAR, floor + BAY_H);
    s.lineTo(SHAFT, floor + BAY_H);
  }
  s.lineTo(SHAFT, SURFACE);
  s.lineTo(W, SURFACE);
  s.lineTo(W, bottom);
  s.lineTo(-W, bottom);
  s.closePath();
  return s;
}

interface Bay {
  kind: VehicleKind;
  model: THREE.Group;
  door: THREE.Mesh;
  lights: THREE.Mesh[];
  lamp: THREE.PointLight;
}

export class BunkerScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 50, 3000);
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, flatShading: true });
  private readonly bays = new Map<VehicleKind, Bay>();
  private readonly spot = new THREE.SpotLight(0xfff1d0, 900, 90, 0.55, 0.5, 1.4);
  private readonly cone: THREE.Mesh;
  private readonly lift = new THREE.Group();
  private readonly doors: THREE.Mesh[] = [];
  private paint: TeamPaint | null = null;
  private readonly models = new Map<TeamPaint, Map<VehicleKind, THREE.Group>>();
  private readonly sky = new THREE.HemisphereLight(0xd8ecff, 0x4a3420, 0.9);
  private readonly sun = new THREE.DirectionalLight(0xfff0d8, 1.6);
  private night = false;
  private readonly lightOn = new THREE.MeshBasicMaterial({ color: 0xffd25a });
  private readonly lightOff = new THREE.MeshBasicMaterial({ color: 0x4a3a1c });

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x8cc8e6);
    s.fog = new THREE.Fog(0x8cc8e6, 600, 1400);
    s.add(this.sky);
    this.sun.position.set(-200, 400, 300);
    s.add(this.sun);

    // The earth, its cut face towards the camera and its cave walls in concrete.
    const earth = new THREE.ExtrudeGeometry(earthShape(), { depth: DEPTH, bevelEnabled: false });
    earth.translate(0, 0, -DEPTH);
    const face = new THREE.MeshStandardMaterial({ color: DIRT, roughness: 0.95, flatShading: true });
    const walls = new THREE.MeshStandardMaterial({ color: CONCRETE, roughness: 0.85, flatShading: true });
    const ground = new THREE.Mesh(earth, [face, walls]);
    ground.receiveShadow = true;
    s.add(ground);
    // Back walls of the shaft and bays.
    const back = new THREE.Mesh(new THREE.BoxGeometry(BAY_FAR * 2 + 4, 360, 2), new THREE.MeshStandardMaterial({ color: CONCRETE_DARK, roughness: 0.9 }));
    back.position.set(0, SURFACE - 180, -DEPTH - 1);
    back.receiveShadow = true;
    s.add(back);

    const kit = new Kit();
    // Grass along the surface each side of the shaft, and strata and stones in the cut face.
    for (const sx of [-1, 1]) kit.box(sx * (SHAFT + 300), DEPTH / 2 - DEPTH, SURFACE, 600, DEPTH + 2, 3, GRASS);
    // Bands of soil in the cut face: dark topsoil, then lighter and redder clays further down.
    for (const [top, h, c] of [[SURFACE, 10, 0x5a3b22], [-150, 26, 0x8a5e3a], [-205, 18, 0x6c4529], [-250, 40, 0x93653f]] as const) {
      for (const sx of [-1, 1]) {
        const inner = SHAFT;
        const w = 600 - inner;
        kit.box(sx * (inner + w / 2), 0.15, top - h, w, 0.3, h, c);
      }
    }
    const rnd = mulberry(7);
    for (let i = 0; i < 70; i++) {
      const x = (rnd() * 2 - 1) * 320;
      const y = SURFACE - 8 - rnd() * 300;
      if (Math.abs(x) < BAY_FAR + 6 && y > -118 && y < SURFACE) continue;
      if (Math.abs(x) < SHAFT + 6) continue;
      kit.ball(x, 0.2, y, 2 + rnd() * 4, rnd() < 0.5 ? DIRT_DARK : 0x8d8478, 0, 0.6);
    }
    // Panel seams on the back walls, a stripe along each bay floor's edge, and the shaft's guide rails.
    for (const [x, floor] of Object.values(BAY_AT).map((b) => [b.x, b.floor] as const)) {
      kit.box(x, -1.2, floor - 0.6, BAY_FAR - SHAFT, 2.2, 0.6, HAZARD);
      for (let k = -2; k <= 2; k++) kit.box(x + k * 10, -DEPTH + 0.2, floor, 0.6, 0.4, BAY_H, CONCRETE_DARK);
    }
    for (const sx of [-1, 1]) kit.box(sx * (SHAFT - 1), -DEPTH / 2, -320, 2, 6, 320 + SURFACE, STEEL);
    // Trees on the hill, and hills behind.
    for (const [x, h] of [[-130, 34], [-96, 24], [-180, 28], [92, 30], [140, 22], [200, 36], [-240, 30], [255, 26]] as const) {
      kit.cyl(x, -18, SURFACE + 1, 1.6, 2.2, h * 0.35, 0x6b4a2e, 6);
      kit.cyl(x, -18, SURFACE + h * 0.3, 0, h * 0.42, h * 0.8, 0x3f7f3a, 7);
    }
    const base = new THREE.Mesh(kit.build(), this.material);
    base.receiveShadow = true;
    // Kit puts game y south (towards the camera, +z) and z up, as this scene wants.
    s.add(base);
    const hills = new Kit();
    for (const [x, r, h] of [[-420, 220, 90], [-120, 260, 70], [220, 240, 100], [520, 260, 80]] as const) hills.cyl(x, -420, SURFACE - 4, r * 0.6, r, h, 0x5f9a4a, 9);
    for (const [x, y, r] of [[-260, 150, 26], [-200, 160, 18], [60, 170, 22], [110, 166, 30], [330, 140, 24]] as const) {
      hills.ball(x, -600, y, r, 0xffffff, 1, 0.45).ball(x + r, -600, y - 4, r * 0.7, 0xf4f6fa, 1, 0.45);
    }
    s.add(new THREE.Mesh(hills.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

    // The lift: a platform with hazard edges on a steel ram down the shaft.
    const deck = new Kit()
      .box(0, -DEPTH / 2, -3, SHAFT * 2 - 4, DEPTH - 4, 3, STEEL)
      .box(0, -1.5, -3, SHAFT * 2 - 4, 1, 3.2, HAZARD)
      .box(0, -DEPTH / 2, -300, 10, 10, 297, 0x8a9098);
    for (let i = 0; i < 6; i++) deck.box(-SHAFT + 5 + i * 5.2, -1.4, -3, 2.4, 1.2, 3.3, 0x222222);
    const lm = new THREE.Mesh(deck.build(), this.material);
    lm.receiveShadow = true;
    this.lift.add(lm);
    s.add(this.lift);

    // The lift doors at the top of the shaft.
    for (const sx of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(SHAFT, 3, DEPTH), new THREE.MeshStandardMaterial({ color: 0x4f5a3c, roughness: 0.8 }));
      d.position.set(sx * SHAFT / 2, SURFACE - 1.5, -DEPTH / 2);
      d.userData.side = sx;
      this.doors.push(d);
      s.add(d);
    }

    // The chosen bay's spotlight and its beam.
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.002;
    s.add(this.spot, this.spot.target);
    this.cone = new THREE.Mesh(
      new THREE.ConeGeometry(17, BAY_H - 4, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    s.add(this.cone);

    for (const kind of Object.keys(BAY_AT) as VehicleKind[]) {
      const b = BAY_AT[kind];
      const door = new THREE.Mesh(new THREE.BoxGeometry(26, 18, 1), new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 1 }));
      door.position.set(b.x, b.floor + 9, -DEPTH + 0.6);
      s.add(door);
      const lights: THREE.Mesh[] = [];
      for (let i = 0; i < 6; i++) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 1.4), this.lightOff);
        const along = b.left ? -BAY_FAR + 6 + i * 8 : SHAFT + 6 + i * 8;
        l.position.set(along, b.floor + 0.5, -2);
        lights.push(l);
        s.add(l);
      }
      const lamp = new THREE.PointLight(0xffd7a0, 220, 70, 1.6);
      lamp.position.set(b.x, b.floor + BAY_H - 4, -12);
      s.add(lamp);
      const fitting = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 2, 10), new THREE.MeshBasicMaterial({ color: 0xffe8b0 }));
      fitting.position.set(b.x, b.floor + BAY_H - 1, -18);
      s.add(fitting);
      this.bays.set(kind, { kind, model: new THREE.Group(), door, lights, lamp });
    }
  }

  /** Day or night over the hill; the bunker's own lamps stay lit. */
  setNight(night: boolean): void {
    if (night === this.night) return;
    this.night = night;
    const sky = night ? 0x0a1426 : 0x8cc8e6;
    (this.scene.background as THREE.Color).setHex(sky);
    (this.scene.fog as THREE.Fog).color.setHex(sky);
    this.sky.intensity = night ? 0.7 : 0.9;
    this.sky.color.setHex(night ? 0x5a6ea8 : 0xd8ecff);
    this.sun.intensity = night ? 0.35 : 1.6;
    this.sun.color.setHex(night ? 0xa8bcff : 0xfff0d8);
  }

  /** Sets up the scene for a side's bunker: the side's paint on the parked vehicles. */
  private setPaint(team: TeamPaint): void {
    if (this.paint === team) return;
    this.paint = team;
    // Each side's models are kept, so split screen can swap between two sides' bunkers every frame.
    let models = this.models.get(team);
    if (!models) {
      models = new Map();
      for (const kind of this.bays.keys()) {
        const g = parked(kind, team, this.material);
        g.scale.setScalar(kind === 'heli' ? 0.9 : PARK_SCALE);
        g.visible = false;
        this.scene.add(g);
        models.set(kind, g);
      }
      this.models.set(team, models);
    }
    for (const bay of this.bays.values()) {
      bay.model.visible = false;
      bay.model = models.get(bay.kind)!;
    }
  }

  /** Poses the bunker for this tick: the parked vehicles, the chosen bay's lights, and the elevator. */
  update(team: TeamPaint, lives: Lives, selected: VehicleKind, elevator: Elevator | null, tick: number): void {
    this.setPaint(team);
    const chosen = elevator?.kind ?? selected;
    for (const bay of this.bays.values()) {
      const b = BAY_AT[bay.kind];
      const mine = bay.kind === chosen;
      bay.model.visible = mine || lives[bay.kind] > 0;
      const dx = mine && elevator ? elevator.dx / ONE : 0;
      const dy = mine && elevator ? elevator.dy / ONE : 0;
      bay.model.position.set(b.x + dx, b.floor - dy, -DEPTH / 2 + 1);
      // Facing the shaft, turned a little towards the camera.
      bay.model.rotation.set(0, b.left ? -Math.PI / 2 + 0.38 : Math.PI / 2 - 0.38, 0);
      (bay.door.material as THREE.MeshStandardMaterial).color.setHex(mine ? 0x050403 : 0x3c3a36);
      bay.lamp.intensity = mine ? 360 : 140;
      const run = (tick >> 4) % 3;
      bay.lights.forEach((l, i) => (l.material = mine && i % 3 === (b.left ? run : 2 - run) ? this.lightOn : this.lightOff));
    }
    const b = BAY_AT[chosen];
    const ride = elevator ? Math.max(0, -elevator.dy / ONE) : 0;
    this.spot.position.set(b.x, b.floor + BAY_H + 30, 30);
    this.spot.target.position.set(b.x + (elevator ? elevator.dx / ONE : 0), b.floor + ride, -DEPTH / 2);
    this.spot.target.updateMatrixWorld();
    this.cone.visible = !elevator;
    this.cone.position.set(b.x, b.floor + (BAY_H - 4) / 2, -DEPTH / 2);
    const liftY = -(elevator ? elevator.lift / ONE : LIFT_REST);
    this.lift.position.set(0, liftY, 0);
    // The doors part as the lift nears the top.
    const open = Math.max(0, Math.min(1, (liftY + 60) / 40));
    for (const d of this.doors) d.position.x = (d.userData.side as number) * (SHAFT / 2 + open * SHAFT);
  }

  /** Frames the bunker in a view of this aspect: the bays and the surface, with more hill on wider views. */
  frame(aspect: number): void {
    const c = this.camera;
    c.aspect = aspect;
    const half = Math.tan((c.fov / 2) * (Math.PI / 180));
    const needH = 190;
    const needW = 240;
    const d = Math.max(needH / 2 / half, needW / 2 / (half * aspect));
    c.position.set(0, -60 + d * 0.12, d);
    c.lookAt(0, -60, 0);
    c.updateProjectionMatrix();
  }

  /** A point of the bunker on screen, 0 to 1 across and down. */
  project(x: number, y: number, z = 0): { x: number; y: number } {
    const p = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }
}

/** The skull's helmet in the rival's paint, the skull, its jaw on a hinge, and the row of lives under it. */
export class SkullScene {
  readonly scene = new THREE.Scene();
  /** A black sheet over the map behind the skull, drawn before the skull (transparent things draw last in a scene). */
  readonly dim = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 50, 1000);
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, flatShading: true });
  private readonly burnt = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0x2e2a26, flatShading: true });
  private readonly head = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private helmet: THREE.Mesh | null = null;
  private helmetPaint: TeamPaint | null = null;
  private readonly back: THREE.Mesh;
  private readonly icons: THREE.Group[] = [];
  private iconsKey = '';
  private readonly rim = new THREE.PointLight(0xffffff, 3000, 400, 1.5);

  constructor() {
    const s = this.scene;
    // A black sheet just in front of the camera dims the map behind the skull.
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false }));
    this.back.position.set(0, 0, -60);
    this.camera.add(this.back);
    this.dim.add(this.camera);
    s.add(new THREE.HemisphereLight(0xfff2e0, 0x302018, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-120, 160, 260);
    s.add(key);
    this.rim.position.set(90, 40, -40);
    s.add(this.rim);

    const skull = new Kit()
      // Cranium and cheekbones, the face ending 6 below the middle.
      .ball(0, 0, 4, 15, BONE, 1, 1)
      .box(0, -2, -6, 22, 18, 7, BONE)
      .ball(-8.5, -7, -4, 5, BONE, 0, 0.9)
      .ball(8.5, -7, -4, 5, BONE, 0, 0.9)
      // Sockets and the nose.
      .ball(-6, -12, 2.5, 4.4, SOCKET, 1, 1.05)
      .ball(6, -12, 2.5, 4.4, SOCKET, 1, 1.05)
      .cyl(0, -11.2, -4, 0, 2.4, 4, SOCKET, 3, { tilt: 0.3 });
    // The upper teeth, hanging under the face.
    for (let i = 0; i < 6; i++) skull.box(-6.25 + i * 2.5, -10.4, -8.2, 2.1, 1.8, 2.6, 0xfffaee);
    this.head.add(new THREE.Mesh(skull.build(), this.material));
    // The jaw, made about its hinge at the back of the mouth (the skull's (0, 2, -7)): a block with the lower teeth.
    const jaw = new Kit().box(0, -6, -7.6, 18, 12, 4.2, BONE).box(0, -1, -4, 14, 2, 1, SOCKET);
    for (let i = 0; i < 6; i++) jaw.box(-6.25 + i * 2.5, -12.4, -3.6, 2.1, 1.8, 2.6, 0xfffaee);
    this.jaw.add(new THREE.Mesh(jaw.build(), this.material));
    this.jaw.position.set(0, -7, 2);
    this.head.add(this.jaw);
    // Face the camera (the kit's south, +z, is towards it; its north is the face).
    this.head.rotation.y = Math.PI;
    const holder = new THREE.Group();
    holder.add(this.head);
    holder.name = 'holder';
    s.add(holder);
  }

  private setHelmet(team: TeamPaint): void {
    if (this.helmetPaint === team) return;
    this.helmetPaint = team;
    if (this.helmet) {
      this.head.remove(this.helmet);
      this.helmet.geometry.dispose();
    }
    const k = new Kit()
      .add(new THREE.SphereGeometry(17.5, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1, 5, 'team')
      .cyl(0, 1, 4, 19.5, 20.5, 1.6, 'teamDark', 14)
      .box(0, -15, 8, 9, 3, 4, 'teamLight', { tilt: -0.5 })
      .cyl(-13, 0, 4.6, 1.2, 1.2, 1, 0x2a2a2a, 8)
      .box(0, 17, 4.5, 30, 2, 1, 0x3a3a3a);
    this.helmet = new THREE.Mesh(k.build(team), this.material);
    this.head.add(this.helmet);
  }

  /** Poses the skull for its look; kind and the lives say which icons show under it and how many are burnt out. */
  update(look: SkullLook, rival: TeamPaint, own: TeamPaint, kind: VehicleKind | null, left: number, start: number): void {
    this.setHelmet(rival);
    const holder = this.scene.getObjectByName('holder')!;
    const s = look.scale / ONE;
    holder.scale.setScalar(s);
    holder.position.set(0, 10, 0);
    // Spun in the screen's plane as the retro skull is, rocking side to side as it goes so it reads as solid.
    const a = (look.angle / ONE / 64) * Math.PI * 2;
    holder.rotation.set(0, Math.sin(a * 2) * 0.35, -a);
    // Faces 1 (shut) to 7 (wide open): the jaw drops and the head tips back as it laughs.
    const open = Math.max(0, (look.face - 1) / 6);
    this.jaw.rotation.x = -open * 0.5;
    this.head.rotation.x = -open * 0.18;
    (this.back.material as THREE.MeshBasicMaterial).opacity = look.map === null ? 1 : 1 - look.map / ONE;
    this.rim.color.setHex(rival.main);

    const n = kind ? Math.min(8, start === UNLIMITED ? 8 : start) : 0;
    const key = `${kind}:${n}:${own.main}`;
    if (key !== this.iconsKey) {
      this.iconsKey = key;
      for (const g of this.icons) this.scene.remove(g);
      this.icons.length = 0;
      for (let i = 0; i < n && kind; i++) {
        const g = parked(kind, own, this.material);
        g.scale.setScalar(kind === 'heli' ? 0.32 : 0.4);
        this.icons.push(g);
        this.scene.add(g);
      }
    }
    const show = look.lives !== null;
    const remain = left === UNLIMITED ? Infinity : left;
    let i = 0;
    for (let row = 0; i < n; row++) {
      const inRow = Math.min(4, n - i);
      for (let k = 0; k < inRow; k++, i++) {
        const g = this.icons[i]!;
        g.visible = show;
        g.position.set((k - (inRow - 1) / 2) * 16, -34 - row * 14, 0);
        g.rotation.set(0.7, 0.5, 0);
        // The first ones are the lives already used (as the retro crosses), burnt out.
        const used = n - 1 - i >= remain;
        g.traverse((o) => {
          if (o instanceof THREE.Mesh) o.material = used ? this.burnt : this.material;
        });
      }
    }
  }

  frame(aspect: number): void {
    const c = this.camera;
    c.aspect = aspect;
    // As the retro skull: 64 px of a 240 px view at full size, so the view is 160 units high at this distance.
    const half = Math.tan((c.fov / 2) * (Math.PI / 180));
    const d = 80 / half;
    c.position.set(0, 0, d);
    c.lookAt(0, 0, 0);
    c.updateProjectionMatrix();
    this.back.scale.set(aspect * 60 * half, 60 * half, 1);
  }
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
