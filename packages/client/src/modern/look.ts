// The modern view's camera look: a surveillance drone's feed over the toy-soldier world, and its thermal camera.
//
// The drone feed is a pass over the finished picture: a slightly washed, cool grade, a soft lens (colour fringes and
// a darker rim), film grain, a faint rolling line, and the stream's encoder errors (torn rows, broken macroblocks)
// when something is destroyed nearby, worst when the player's own vehicle is hit. Thermal is drawn by the models
// themselves: every material shows its heat instead of its lit colour (vehicles, soldiers and drones hot, wrecks
// warm, buildings and ground cool, the sea cold, lit windows warm at night), so darkness hides nothing; the pass then
// shows it white-hot, grainy and a touch soft, as an infrared camera does, and the hottest things leave a faint
// afterimage as they move, as a real sensor's slow response does: the white-hot is burnt into the screen for a
// moment and fades, leaving a trail.

import * as THREE from 'three';
import { ART } from './art.js';
import { tiltShiftOn } from '../quality.js';

/** 1 while the thermal camera is on: shared by every material that draws its heat. */
export const THERMAL = { value: 0 };

/** Seconds, for the lights' flicker: shared by every material whose lights are made less clean. */
export const LIGHT_TIME = { value: 0 };

/**
 * A vehicle's beam's shape across its cone (GLSL): q is where a point lies across the beam (beamAcross), cone the
 * cone's cosine, shape the vehicle's lamp (beamDistance): 0 one plain beam, 1 twin headlamps (two pools side by side),
 * 2 hooded blackout lamps (twin, dim, cut off above so only the ground just ahead is lit), 3 a searchlight (a
 * hard-edged disc with a hot middle). Shared by the lit materials and the sea, which lights itself.
 */
export const BEAM_SHAPE_GLSL = `
vec2 beamAcross(vec3 toLight, vec3 axis) {
  float c = max(dot(toLight, axis), 0.2);
  vec3 side = normalize(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 up = cross(axis, side);
  return vec2(dot(toLight, side), dot(toLight, up)) / c;
}
float beamShape(vec2 q, float cone, float shape) {
  // Across the cone, 0 in the middle to 1 at its edge; for a beam pointed down at the ground, n.y grows toward the
  // far side of its pool.
  vec2 n = q / max(sqrt(1.0 - cone * cone) / cone, 0.01);
  if (shape > 2.5) {
    float r = length(n);
    return 0.15 + smoothstep(0.9, 0.75, r) * (0.9 + 0.6 * smoothstep(0.45, 0.0, r));
  }
  if (shape > 0.5) {
    float spread = shape > 1.5 ? 0.13 : 0.07;
    vec2 l1 = n - vec2(0.42, 0.0);
    vec2 l2 = n + vec2(0.42, 0.0);
    float s = 0.15 + 1.35 * max(exp(-dot(l1, l1) / spread), exp(-dot(l2, l2) / spread));
    // Hooded: the hood cuts the top of the beam off, so the far side goes dark.
    if (shape > 1.5) s *= smoothstep(0.45, -0.1, n.y);
    return s;
  }
  return 1.0;
}
`;

const GRAIN_GLSL = `${BEAM_SHAPE_GLSL}
uniform float lightTime;
float grainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float grainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(grainHash(i), grainHash(i + vec2(1.0, 0.0)), f.x), mix(grainHash(i + vec2(0.0, 1.0)), grainHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// A headlight or searchlight through scratched, dirty glass: blotches across the beam, faint rings from the
// reflector, and a slight flutter from the engine. Worked out across the cone in the world's directions, so the
// pattern travels with the beam and nothing in it turns when the camera tilts or follows.
// shape is the vehicle's lamp (beamDistance): 0 one plain beam, 1 twin headlamps (two pools side by side), 2 hooded
// blackout lamps (twin, dim, cut off above so only the ground just ahead is lit), 3 a searchlight (a hard-edged,
// cleaner disc with a hot middle). cone is the light's cone's cosine, to measure across the cone from 0 to 1.
float beamGrain(vec3 toLight, vec3 axis, float k, float cone, float shape) {
  vec3 l = (vec4(toLight, 0.0) * viewMatrix).xyz;
  vec3 a = (vec4(axis, 0.0) * viewMatrix).xyz;
  float c = max(dot(l, a), 0.2);
  vec3 side = normalize(cross(a, abs(a.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 up = cross(a, side);
  vec2 q = vec2(dot(l, side), dot(l, up)) / c;
  float blotch = grainNoise(q * 7.0 + k * 7.3) * 0.6 + grainNoise(q * 21.0 - k * 3.1) * 0.4;
  float rings = 0.5 + 0.5 * sin(length(q) * 46.0 + k);
  float grime = 1.0 - 0.6 * smoothstep(0.62, 0.8, grainNoise(q * 13.0 + vec2(k * 5.1, 2.0)));
  float scratch = 1.0 - 0.35 * smoothstep(0.86, 0.97, grainNoise(vec2(q.x * 3.0 + q.y * 1.4, q.y * 60.0 - q.x * 12.0) + k));
  float flutter = 0.95 + 0.05 * sin(lightTime * (19.0 + k * 3.0) + k * 5.0) * sin(lightTime * 4.3 + k);
  float grain = (0.3 + 1.05 * blotch * blotch) * (0.8 + 0.2 * rings) * grime * scratch;
  // A searchlight's glass is cleaner than a headlamp's.
  if (shape > 2.5) grain = mix(1.0, grain, 0.35);
  return grain * beamShape(q, cone, shape) * flutter;
}
// A lamp through its cage and grimy glass: soft bars of shadow round it, smudges, and an old bulb's or a flame's
// flicker. Worked out in the world's directions, so the bars stand upright whatever the camera does, and seeded by
// where the lamp stands, so each lamp keeps its own pattern and flicker however the lights are shared out.
float lampSeed(vec3 lightPos) {
  vec3 w = (vec4(lightPos - viewMatrix[3].xyz, 0.0) * viewMatrix).xyz;
  return grainHash(floor(w.xz / 4.0 + 0.5)) * 23.0;
}
float lampGrain(vec3 toLight, float k) {
  vec3 d = normalize((vec4(-toLight, 0.0) * viewMatrix).xyz);
  float a = atan(d.x, d.z);
  float bars = smoothstep(0.5, 0.95, abs(sin(a * 4.0 + k * 1.7)));
  float smudge = grainNoise(vec2(a * 2.5, d.y * 5.0) + k * 11.0);
  float flick = 0.84 + 0.16 * grainNoise(vec2(lightTime * 8.0, k * 13.0));
  return (1.0 - 0.5 * bars) * (0.6 + 0.6 * smudge) * flick;
}
`;

/** A vehicle's beam's shape (beamGrain). */
export type BeamShape = 0 | 1 | 2 | 3;
export const BEAM_PLAIN: BeamShape = 0;
export const BEAM_TWIN: BeamShape = 1;
export const BEAM_HOODED: BeamShape = 2;
export const BEAM_SEARCH: BeamShape = 3;

/**
 * A spotlight's reach carrying its beam's shape, for the lit shaders to read per light (whatever order three.js puts
 * the lights in): the reach in whole pixels and the shape in eighths, which a float holds exactly.
 */
export function beamDistance(reach: number, shape: BeamShape): number {
  return Math.round(reach) + shape / 8;
}

/**
 * Makes a lit material's point and spot lights less clean (Paul's night: lamps, fires and headlights with texture
 * in them, not perfect discs): a gobo-like pattern, grime and flicker on each light's contribution.
 */
export function grainLights(shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }): void {
  shader.uniforms.lightTime = LIGHT_TIME;
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${GRAIN_GLSL}\nvoid main() {`)
    .replace('#include <lights_fragment_begin>', LIGHTS_CHUNK);
}

/**
 * three.js's lights chunk, with each point and spot light's grain added, and each one that is off (black: a blast's
 * flash between blasts, a headlight with no vehicle) skipped whole: the blasts' four flash lights are in the scene all
 * the time, and the four headlights all night, so every lit pixel otherwise paid for eight lights, their grain and
 * the headlights' shadow maps, whether they shone or not.
 */
const LIGHTS_CHUNK = (() => {
  const on = (light: string) => `if ( ${light}.color.r + ${light}.color.g + ${light}.color.b > 0.0 ) {`;
  /** Wraps one kind of light's loop body, from its light's fetch to its RE_Direct, in a test that it is on. */
  const skipOff = (chunk: string, fetch: string, light: string): string => {
    const at = chunk.indexOf(fetch);
    const end = chunk.indexOf('RE_Direct(', at);
    const close = chunk.indexOf(';', end) + 1;
    if (at < 0 || end < 0 || close <= 0) throw new Error(`three.js's lights chunk has changed: no ${fetch}`);
    return `${chunk.slice(0, at + fetch.length)}\n\t\t${on(light)}${chunk.slice(at + fetch.length, close)}\n\t\t}${chunk.slice(close)}`;
  };
  let chunk = THREE.ShaderChunk.lights_fragment_begin;
  for (const [find, add] of [
    ['getPointLightInfo( pointLight, geometryPosition, directLight );', 'directLight.color *= lampGrain( directLight.direction, lampSeed( pointLight.position ) );'],
    ['getSpotLightInfo( spotLight, geometryPosition, directLight );', 'directLight.color *= beamGrain( directLight.direction, spotLight.direction, float( UNROLLED_LOOP_INDEX ), spotLight.coneCos, floor( fract( spotLight.distance ) * 8.0 + 0.5 ) );'],
  ] as const) {
    if (!chunk.includes(find)) throw new Error(`three.js's lights chunk has changed: no ${find}`);
    chunk = chunk.replace(find, `$&\n\t\t${add}`);
  }
  chunk = skipOff(chunk, 'pointLight = pointLights[ i ];', 'pointLight');
  return skipOff(chunk, 'spotLight = spotLights[ i ];', 'spotLight');
})();

/**
 * Teaches a lit material to show its heat when THERMAL is on: heat is how hot it runs (0 cold, 1 an engine), and
 * the glow attribute's windows and lamps run warm at night (nightGlow). It ends the shader there (it goes in once the
 * surface's colour and normal are known, ahead of the lighting it has no use for).
 */
export function heatFragment(heat: number, glow: boolean): string {
  const h = heat.toFixed(2);
  return /* glsl */ `
  if (thermal > 0.5) {
    float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    float side = 0.12 * clamp(normal.z, 0.0, 1.0) - 0.06;
    float t = 0.3 + l * 0.22 + side + ${h} * 0.42${glow ? ' + vGlow * nightGlow * 0.4' : ''};
    gl_FragColor = vec4(vec3(t), 1.0);
    return;
  }`;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D frame;
  uniform vec2 res;
  uniform float scale;
  uniform float time;
  uniform float drone;
  uniform float thermal;
  uniform vec4 rects[2];
  uniform float glitches[2];
  uniform int count;
  uniform float tilt;
  /** The bunker's security camera: 0 not it, 1 its washed-out colour by day, 2 its black and white infrared by night. */
  uniform float cctv;
  /** The thermal camera's last picture, its afterimage. */
  uniform sampler2D history;
  /** Per view: how far the ground has moved across it since the last picture (modern pixels), and 1 when that picture can be used. */
  uniform vec2 shifts[2];
  uniform float ghosts[2];
  /** How much of the afterimage is left after the time since the last picture. */
  uniform float fade;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  /** The lens rim's darkening at a point of a view, local 0-1 across it. */
  float rim(vec2 local, vec4 r) { return mix(0.55, 1.0, smoothstep(0.85, 0.2, length((local - 0.5) * vec2(1.0, r.w / r.z * 1.25)))); }

  void main() {
    // In the modern screen's own pixels whatever size the picture is drawn at, so the grain, scanlines and errors
    // keep their size.
    vec2 px = gl_FragCoord.xy / scale;
    vec4 r = vec4(0.0, 0.0, res);
    float glitch = 0.0;
    vec2 shift = vec2(0.0);
    float ghost = 0.0;
    for (int i = 0; i < 2; i++) {
      if (i >= count) break;
      vec4 q = rects[i];
      if (px.x >= q.x && px.x < q.x + q.z && px.y >= q.y && px.y < q.y + q.w) {
        r = q;
        glitch = glitches[i];
        shift = shifts[i];
        ghost = ghosts[i];
      }
    }
    vec2 local = (px - r.xy) / r.zw;
    vec2 d = local - 0.5;
    vec2 texel = 1.0 / res;
    float grain = hash(floor(px) + fract(time * 13.7) * 91.0) - 0.5;
    vec2 uv = vUv;
    // The feed's encoder errors, set off by the blast of something destroyed (glitch, 0-1, fading as it settles;
    // strongest when the player's own vehicle is hit): rows torn sideways, slices of misplaced macroblocks,
    // discoloured blocks and split colours, flickering on and off from one frame slot to the next.
    float slot = floor(time * 14.0);
    float burst = drone * step(0.001, glitch) * step(1.0 - min(1.0, glitch * 1.4), hash(vec2(slot, 7.0)));
    vec2 block = floor(px / 16.0);
    float hit = 0.0;
    if (burst > 0.5) {
      float band = floor(px.y / (6.0 + 20.0 * hash(vec2(slot, 2.0))));
      float tear = hash(vec2(band, slot));
      if (tear > 1.0 - 0.45 * glitch) uv.x += (hash(vec2(band, slot + 1.0)) - 0.5) * (30.0 + 90.0 * glitch) * texel.x;
      // A corrupt slice: from some way along a row of blocks to its end, the blocks come from the wrong place.
      float slice = hash(vec2(block.y, slot + 0.5));
      float from = hash(vec2(block.y, slot + 1.5)) * res.x / 16.0;
      if (slice > 1.0 - 0.22 * glitch && block.x >= from) {
        vec2 shift = (vec2(hash(vec2(block.y, slot + 2.5)), hash(vec2(block.y, slot + 3.5))) - 0.5) * vec2(160.0, 48.0);
        uv = (floor(px) + floor(shift) + 0.5) * texel;
        hit = step(0.8, hash(block + slot));
      } else if (hash(block + slot * 1.31) > 1.0 - 0.012 * glitch) {
        hit = 1.0;
        uv = (block * 16.0 + 8.0) * texel;
      }
    }
    vec3 col;
    if (thermal > 0.5) {
      // White-hot: heat as brightness, a little soft, with sensor noise and faint banding.
      float t = lum(texture2D(frame, uv).rgb) * 0.4;
      t += lum(texture2D(frame, uv + vec2(texel.x, 0.0)).rgb) * 0.15;
      t += lum(texture2D(frame, uv - vec2(texel.x, 0.0)).rgb) * 0.15;
      t += lum(texture2D(frame, uv + vec2(0.0, texel.y)).rgb) * 0.15;
      t += lum(texture2D(frame, uv - vec2(0.0, texel.y)).rgb) * 0.15;
      t = smoothstep(0.04, 0.92, t);
      // The afterimage: anything warmer than the ground is burnt into the sensor for a moment, so the last picture
      // stays where it was on the screen and fades: as the camera moves the warm scenery smears behind it, and
      // anything hot crossing the screen leaves a trail. Its rim and scanline are taken back out so they do not build
      // up, and the cool ground leaves none. It is soft and blurred, not a sharp copy.
      vec2 hp = px - shift;
      vec2 hl = (hp - r.xy) / r.zw;
      if (ghost > 0.5 && hl.x > 0.0 && hl.x < 1.0 && hl.y > 0.0 && hl.y < 1.0) {
        // Read a little blurred, so each frame it is held it spreads and softens as it fades.
        vec2 hu = hp / res;
        vec2 bt = 1.6 * texel;
        float h = lum(texture2D(history, hu).rgb) * 0.36;
        h += lum(texture2D(history, hu + vec2(bt.x, bt.y)).rgb) * 0.16;
        h += lum(texture2D(history, hu + vec2(-bt.x, bt.y)).rgb) * 0.16;
        h += lum(texture2D(history, hu + vec2(bt.x, -bt.y)).rgb) * 0.16;
        h += lum(texture2D(history, hu + vec2(-bt.x, -bt.y)).rgb) * 0.16;
        h *= fade / (rim(hl, r) * 0.9825);
        t = max(t, mix(t, h, smoothstep(0.3, 0.4, h)));
      }
      t += grain * 0.07 + 0.012 * sin(px.y * 0.9 + time * 40.0);
      col = vec3(t) * vec3(0.98, 1.0, 1.02);
    } else {
      // A lens: colour fringes growing to the rim.
      vec2 off = d * 2.6 * texel + vec2(burst * (2.0 + 8.0 * glitch) * texel.x, 0.0);
      col = vec3(texture2D(frame, uv + off).r, texture2D(frame, uv).g, texture2D(frame, uv - off).b);
      // Tilt-shift: a camera this close to something this small can only hold a band of it in focus, so the
      // picture goes soft toward the top and bottom (the far ground and the near), which reads as a miniature.
      float soft = tilt * smoothstep(0.14, 0.5, abs(local.y - 0.47));
      if (soft > 0.02) {
        vec3 sum = col;
        float radius = soft * 4.5;
        for (int i = 0; i < 12; i++) {
          // A golden-angle spiral of taps across the blur's disc.
          float k = float(i) + 0.5;
          float a = k * 2.39996 + hash(px) * 6.2832;
          sum += texture2D(frame, uv + vec2(cos(a), sin(a)) * sqrt(k / 12.0) * radius * texel).rgb;
        }
        col = mix(col, sum / 13.0, smoothstep(0.0, 0.35, soft));
      }
      // Highlights bloom a little on the lens: the sun's glint on plastic, fire and lamps.
      vec3 bloom = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        vec2 o = vec2(cos(a), sin(a)) * (i < 4 ? 2.5 : 5.5);
        bloom += max(texture2D(frame, uv + o * texel).rgb - 0.72, 0.0);
      }
      col += bloom * 0.09;
      // A feed's grade: a touch cool, the blacks lifted a little, enough colour left for the toys' plastic to read.
      float g = lum(col);
      col = mix(vec3(g), col, 0.85);
      col = col * vec3(0.94, 1.0, 0.98) * 0.94 + vec3(0.015, 0.02, 0.02);
      col += grain * 0.06;
      // The bunker's security camera: its colour washed out by day; by night infrared, black and white, with the
      // dark lifted and the picture flattened.
      if (cctv > 0.5) {
        float night = step(1.5, cctv);
        col = mix(col, vec3(lum(col)), mix(0.45, 1.0, night));
        col = mix(col, 1.0 - (1.0 - col) * (1.0 - vec3(0.18, 0.2, 0.19)), night);
      }
    }
    // A broken macroblock: its colours crushed to a few steps and pushed green or magenta.
    if (hit > 0.5) {
      col = floor(col * 4.0) / 4.0;
      col *= hash(block + 0.5) > 0.5 ? vec3(0.7, 1.25, 0.7) : vec3(1.25, 0.7, 1.2);
    }
    // A dropped line or two in a burst.
    if (burst > 0.5 && hash(vec2(floor(px.y), slot)) > 0.992) col *= 0.25;
    // A faint line rolls down the picture, and scanlines every other row.
    float roll = fract(time * 0.11);
    col *= 1.0 + 0.04 * smoothstep(0.03, 0.0, abs(local.y - (1.0 - roll)));
    col *= 0.965 + 0.035 * step(0.5, fract(px.y * 0.5));
    // The rim of the lens.
    col *= rim(local, r);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

export interface LookRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The pass that turns the rendered picture into the drone's feed or its thermal picture. */
export class LookPass {
  private frame: THREE.FramebufferTexture;
  /** The thermal picture as last drawn, for its afterimage, and when (seconds); null until thermal is first drawn. */
  private history: THREE.FramebufferTexture | null = null;
  private historyAt = -1;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly origin = new THREE.Vector2(0, 0);

  constructor(private readonly w: number, private readonly h: number) {
    this.frame = new THREE.FramebufferTexture(w, h);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        frame: { value: this.frame },
        res: { value: new THREE.Vector2(w, h) },
        scale: { value: 1 },
        time: { value: 0 },
        drone: { value: 1 },
        thermal: { value: 0 },
        rects: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        glitches: { value: [0, 0] },
        count: { value: 0 },
        tilt: { value: 0 },
        cctv: { value: 0 },
        history: { value: this.frame },
        shifts: { value: [new THREE.Vector2(), new THREE.Vector2()] },
        ghosts: { value: [0, 0] },
        fade: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /**
   * Copies what gl has drawn so far and draws it back through the look. rects are the map views, top-left origin,
   * so each gets its own lens. cctv makes it the bunker's security camera instead, by day or by night. On the
   * thermal camera, shifts gives each view how far its ground has moved across it since the last picture (modern
   * pixels, y up), or null where that picture is not of the same place (a cut, a new camera), for the afterimage.
   */
  apply(
    gl: THREE.WebGLRenderer, rects: readonly LookRect[], glitch: readonly number[], drone: boolean, thermal: boolean, seconds: number, tilt = false,
    cctv: 'day' | 'night' | null = null, shifts: readonly ({ x: number; y: number } | null)[] = [],
  ): void {
    gl.setViewport(0, 0, this.w, this.h);
    gl.setScissor(0, 0, this.w, this.h);
    const u = this.material.uniforms;
    // The picture's real size, which follows the quality preset and the dynamic resolution (renderer.ts).
    const pr = gl.getPixelRatio();
    const fw = Math.floor(this.w * pr);
    const fh = Math.floor(this.h * pr);
    if (this.frame.image.width !== fw || this.frame.image.height !== fh) {
      this.frame.dispose();
      this.frame = new THREE.FramebufferTexture(fw, fh);
      u.frame!.value = this.frame;
    }
    u.scale!.value = pr;
    gl.copyFramebufferToTexture(this.frame, this.origin);
    u.time!.value = seconds;
    u.thermal!.value = thermal ? 1 : 0;
    u.drone!.value = drone ? 1 : 0;
    u.tilt!.value = tilt && ART.tiltShift && tiltShiftOn() ? 1 : 0;
    u.cctv!.value = cctv === 'night' ? 2 : cctv === 'day' ? 1 : 0;
    // The afterimage: half of it gone every 750 ms, and kept only while it is still warmer than the ground, so a
    // burn that fades over about a second whatever the frame rate.
    // Not after a pause or a hitch, nor from a picture of another size.
    let ghosting = false;
    if (thermal) {
      if (!this.history || this.history.image.width !== fw || this.history.image.height !== fh) {
        this.history?.dispose();
        this.history = new THREE.FramebufferTexture(fw, fh);
        this.historyAt = -1;
      }
      const dt = seconds - this.historyAt;
      ghosting = this.historyAt >= 0 && dt > 0 && dt < 0.25;
      u.fade!.value = ghosting ? Math.pow(0.5, dt / 0.75) : 0;
      u.history!.value = this.history;
    }
    const sh = u.shifts!.value as THREE.Vector2[];
    const gh = u.ghosts!.value as number[];
    for (let i = 0; i < 2; i++) {
      const s = ghosting ? shifts[i] : null;
      gh[i] = s ? 1 : 0;
      sh[i]!.set(s?.x ?? 0, s?.y ?? 0);
    }
    const list = u.rects!.value as THREE.Vector4[];
    const n = Math.min(2, rects.length);
    for (let i = 0; i < n; i++) {
      const r = rects[i]!;
      list[i]!.set(r.x, this.h - r.y - r.h, r.w, r.h);
    }
    u.count!.value = n;
    const g = u.glitches!.value as number[];
    for (let i = 0; i < 2; i++) g[i] = glitch[i] ?? 0;
    gl.render(this.scene, this.camera);
    if (thermal && this.history) {
      gl.copyFramebufferToTexture(this.history, this.origin);
      this.historyAt = seconds;
    } else if (!cctv) this.historyAt = -1;
  }

  /** Hands its scene to compile, so its shader can be made ahead of its first use. */
  compile(compile: (scene: THREE.Scene, camera: THREE.Camera) => void): void {
    compile(this.scene, this.camera);
  }

  dispose(): void {
    this.frame.dispose();
    this.history?.dispose();
    this.material.dispose();
  }
}
