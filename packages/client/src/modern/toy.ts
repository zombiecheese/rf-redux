// The toys' moulded plastic and the garden sky it reflects. The modern view's vehicles, soldiers and drones are
// army-men style toys: glossy plastic with a light clear coat, catching the sky and the sun on their rounded edges.
// The sky is a garden around a lawn (blue above, a hedge and fence line on the horizon, grass below), drawn here in
// code and prefiltered once into an environment map for the plastic's reflections.

import * as THREE from 'three';

/** How strongly the plastic reflects the garden sky by day. */
export const PLASTIC_SKY = 0.22;

/** The moulded plastic for a side's toys (vertex colours carry the side's paint). */
export function toyPlastic(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.22,
    specularIntensity: 0.55,
    // Enough of the garden for a sheen and glints, not so much that it washes out the side's colour.
    envMapIntensity: PLASTIC_SKY,
  });
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
