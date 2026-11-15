// The toys' moulded plastic and the garden sky it reflects. The modern view's vehicles, soldiers and drones are
// army-men style toys: glossy plastic with a light clear coat, catching the sky and the sun on their rounded edges.
// The sky is a photographed garden (photoSky); until it has loaded, or with ART.photoSky off, a garden around a lawn
// (blue above, a hedge and fence line on the horizon, grass below) drawn here in code stands in for it.

import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/** How strongly the plastic reflects the garden sky by day. */
export const PLASTIC_SKY = 0.22;

/**
 * The moulded plastic for a side's toys (vertex colours carry the side's paint). Parts painted 'rubber' (the kits'
 * matte attribute) come out as dull rubber instead: rough, with no clear coat and little shine.
 */
export function toyPlastic(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.22,
    specularIntensity: 0.55,
    // Enough of the garden for a sheen and glints, not so much that it washes out the side's colour.
    envMapIntensity: PLASTIC_SKY,
  });
  m.onBeforeCompile = rubber;
  return m;
}

/**
 * The shader change for the toys' surface: coloured plastic gets the fine, slightly uneven grain of a moulded toy (a
 * small wobble in the normal and the shine, fixed to the model so it never swims as the toy moves), and parts painted
 * 'rubber' come out matte. A material's other onBeforeCompile should call it first.
 */
export function rubber(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader.replace(
    'void main() {',
    'attribute float matte;\nvarying float vMatte;\nvarying vec3 vToyPos;\nvoid main() {\n  vMatte = matte;\n  vToyPos = position;',
  );
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `varying float vMatte;
varying vec3 vToyPos;
float toyHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float toyNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(toyHash(i), toyHash(i + vec3(1, 0, 0)), f.x), mix(toyHash(i + vec3(0, 1, 0)), toyHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(toyHash(i + vec3(0, 0, 1)), toyHash(i + vec3(1, 0, 1)), f.x), mix(toyHash(i + vec3(0, 1, 1)), toyHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
void main() {`)
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
  vec3 toyP = vToyPos * 3.1;
  float toyGrain = toyNoise(toyP) * 0.65 + toyNoise(toyP * 2.3 + 11.0) * 0.35;
  roughnessFactor = mix(roughnessFactor + (toyGrain - 0.5) * 0.22, 0.93, vMatte);`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
  vec3 toyBump = vec3(toyNoise(toyP + 3.7), toyNoise(toyP + 19.1), toyNoise(toyP + 41.3)) - 0.5;
  vec3 toyFine = vec3(toyNoise(toyP * 3.7 + 5.1), toyNoise(toyP * 3.7 + 23.9), toyNoise(toyP * 3.7 + 47.2)) - 0.5;
  normal = normalize(normal + (toyBump * 0.2 + toyFine * 0.12) * (1.0 - vMatte));`,
    )
    .replace(
      '#include <lights_physical_fragment>',
      '#include <lights_physical_fragment>\n  material.clearcoat *= 1.0 - vMatte;\n  material.specularColor *= 1.0 - 0.7 * vMatte;\n  material.specularF90 *= 1.0 - 0.7 * vMatte;',
    );
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 sunDir;
  varying vec3 vDir;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f));
  }
  void main() {
    vec3 d = normalize(vDir);
    float az = atan(d.x, d.z);
    // Sky: deep blue overhead to a pale hazy horizon.
    vec3 col = mix(vec3(0.82, 0.88, 0.92), vec3(0.28, 0.5, 0.82), pow(max(d.y, 0.0), 0.55));
    // A few soft clouds.
    float cl = noise(az * 5.0 + 3.0) * noise(az * 11.0 + d.y * 9.0);
    col = mix(col, vec3(1.0), smoothstep(0.35, 0.7, cl) * smoothstep(0.05, 0.25, d.y) * smoothstep(0.7, 0.3, d.y) * 0.6);
    // The garden's edge: a hedge and trees of uneven height, a fence below them.
    float edge = 0.05 + 0.09 * noise(az * 7.0) + 0.05 * noise(az * 23.0 + 5.0);
    if (d.y < edge) {
      float leaf = 0.6 + 0.4 * noise(az * 61.0 + d.y * 40.0);
      col = vec3(0.13, 0.2, 0.09) * leaf;
      if (d.y < 0.035) col = mix(vec3(0.42, 0.33, 0.24), vec3(0.3, 0.23, 0.17), step(0.5, fract(az * 40.0)));
    }
    // The lawn and beds below the horizon, lit by the sun.
    if (d.y < 0.0) col = mix(vec3(0.22, 0.32, 0.12), vec3(0.3, 0.24, 0.16), 0.5 + 0.5 * sin(az * 3.0)) * (0.9 + 0.2 * noise(az * 30.0));
    // The sun, very bright, so the plastic gets a sharp glint.
    float s = max(dot(d, sunDir), 0.0);
    col += vec3(1.0, 0.86, 0.66) * (pow(s, 900.0) * 60.0 + pow(s, 24.0) * 0.5);
    gl_FragColor = vec4(col, 1.0);
  }`;

const skies = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/** The garden sky as a prefiltered environment map for gl, made once per renderer. sun points toward the sun. */
export function gardenSky(gl: THREE.WebGLRenderer, sun: THREE.Vector3): THREE.Texture {
  const had = skies.get(gl);
  if (had) return had;
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: sun.clone().normalize() } },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), material);
  scene.add(ball);
  const pmrem = new THREE.PMREMGenerator(gl);
  const target = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  ball.geometry.dispose();
  material.dispose();
  skies.set(gl, target.texture);
  return target.texture;
}

/** The photographed skies, prefiltered for the plastic: a sunny garden by day, a lamplit park by night. */
export interface PhotoSkies {
  day: THREE.Texture;
  night: THREE.Texture;
}

/**
 * How far the photographed skies are turned about the up axis (envMapRotation's y), so the garden photo's sun stands
 * where the scene's sun is.
 */
export const PHOTO_SKY_TURN = -1.6;

const photoSkies = new WeakMap<THREE.WebGLRenderer, Promise<PhotoSkies>>();

/**
 * The CC0 sky photos (Poly Haven's Garden Nook and Blaubeuren Night, credited in assets/art/pack/cc0/README.md),
 * loaded and prefiltered once per renderer. They replace the code-drawn sky once they have come.
 */
export function photoSky(gl: THREE.WebGLRenderer): Promise<PhotoSkies> {
  const had = photoSkies.get(gl);
  if (had) return had;
  const loader = new HDRLoader();
  const one = async (file: string) => {
    const t = await loader.loadAsync(`/art/pack/cc0/sky/${file}`);
    t.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromEquirectangular(t);
    pmrem.dispose();
    t.dispose();
    return target.texture;
  };
  const p = Promise.all([one('garden.hdr'), one('night.hdr')]).then(([day, night]) => ({ day, night }));
  photoSkies.set(gl, p);
  return p;
}

/**
 * Burnt, melted plastic for the toys' wrecks: the vertex colours (the side's paint) scorched nearly black in blotches,
 * with the sticky shine of plastic that has melted and set again.
 */
export function charredPlastic(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    specularIntensity: 0.4,
    envMapIntensity: PLASTIC_SKY,
  });
  m.onBeforeCompile = (shader) => {
    rubber(shader);
    // Soot in blotches: mostly black, with patches where the side's colour still shows through, darkened.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  float soot = toyNoise(vToyPos * 0.15) * 0.7 + toyNoise(vToyPos * 0.6 + 7.0) * 0.3;
  diffuseColor.rgb *= mix(0.02, 0.11, smoothstep(0.3, 0.75, soot));`,
    );
  };
  return m;
}

/**
 * Melts shapes in place, as one: slumped down toward the ground, spread out at the foot like a puddle, sagging and
 * lumpy, leaning a little one way. The shapes stand on y = 0 in three.js axes; keep is how much of the height is left.
 */
export function slump(geos: readonly THREE.BufferGeometry[], seed = 1, keep = 0.55): void {
  const box = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  const floor = Math.max(0, box.min.y);
  const h = Math.max(0.01, box.max.y - floor);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const reach = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const lx = Math.cos(seed * 2.4);
  const lz = Math.sin(seed * 2.4);
  const wobble = (x: number, z: number) => Math.sin(x * 0.7 + seed) * Math.cos(z * 0.6 - seed * 1.3) * 0.5 + Math.sin(x * 1.9 + z * 1.4 + seed * 2.1) * 0.25;
  for (const g of geos) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const t = Math.max(0, Math.min(1, (pos.getY(i) - floor) / h));
      const w = wobble(x, z);
      // How far out from the middle, 0 to 1: the edges droop more than the middle as it softens.
      const out = Math.min(1, Math.hypot(x - cx, z - cz) / Math.max(0.01, reach));
      // Lower and lumpier the higher it was, the top and the edges sagging most.
      const y = floor + h * t * (keep + 0.12 * w) - Math.max(0, w) * t * t * h * 0.15 - out * out * t * h * keep * 0.45;
      // The foot spreads out where the plastic ran, in uneven tongues rather than evenly.
      const run = wobble(z * 0.8 + 3.1, x * 0.8 - 1.7);
      const spread = 1 + (1 - t) * (1 - t) * (0.16 + 0.14 * run) + t * 0.06 * w;
      // Straight edges go wavy.
      const wx = wobble(pos.getY(i) * 1.3 + 5.0, z) * reach * 0.06;
      const wz = wobble(x, pos.getY(i) * 1.3 - 2.0) * reach * 0.06;
      // Everything leans a little one way as it sank.
      const lean = t * t * reach * 0.12;
      pos.setXYZ(i, cx + (x - cx) * spread + lean * lx + wx, Math.max(0, y), cz + (z - cz) * spread + lean * lz + wz);
    }
    pos.needsUpdate = true;
    g.boundingBox = null;
    g.boundingSphere = null;
  }
}

/** A built toy's geometry (standing on y = 0) melted by fire, with new normals: a new geometry. */
export function melted(g: THREE.BufferGeometry, seed = 1): THREE.BufferGeometry {
  const out = g.clone();
  slump([out], seed);
  out.deleteAttribute('normal');
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}
