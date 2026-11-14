// The modern view's camera look: a surveillance drone's feed over the toy-soldier world, and its thermal camera.
//
// The drone feed is a pass over the finished picture: a slightly washed, cool grade, a soft lens (colour fringes and
// a darker rim), film grain, a faint rolling line, and the stream's encoder errors (torn rows, broken macroblocks)
// when something is destroyed nearby, worst when the player's own vehicle is hit. Thermal is drawn by the models
// themselves: every material shows its heat instead of its lit colour (vehicles, soldiers and drones hot, wrecks
// warm, buildings and ground cool, the sea cold, lit windows warm at night), so darkness hides nothing; the pass then
// shows it white-hot, grainy and a touch soft, as an infrared camera does.

import * as THREE from 'three';

/** 1 while the thermal camera is on: shared by every material that draws its heat. */
export const THERMAL = { value: 0 };

/**
 * Teaches a lit material to show its heat when THERMAL is on: heat is how hot it runs (0 cold, 1 an engine), and
 * the glow attribute's windows and lamps run warm at night (nightGlow).
 */
export function heatFragment(heat: number, glow: boolean): string {
  const h = heat.toFixed(2);
  return /* glsl */ `
  if (thermal > 0.5) {
    float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    float side = 0.12 * clamp(normal.z, 0.0, 1.0) - 0.06;
    float t = 0.3 + l * 0.22 + side + ${h} * 0.42${glow ? ' + vGlow * nightGlow * 0.4' : ''};
    gl_FragColor = vec4(vec3(t), 1.0);
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
  uniform float time;
  uniform float drone;
  uniform float thermal;
  uniform vec4 rects[2];
  uniform float glitches[2];
  uniform int count;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 px = gl_FragCoord.xy;
    vec4 r = vec4(0.0, 0.0, res);
    float glitch = 0.0;
    for (int i = 0; i < 2; i++) {
      if (i >= count) break;
      vec4 q = rects[i];
      if (px.x >= q.x && px.x < q.x + q.z && px.y >= q.y && px.y < q.y + q.w) {
        r = q;
        glitch = glitches[i];
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
      t += grain * 0.07 + 0.012 * sin(px.y * 0.9 + time * 40.0);
      col = vec3(t) * vec3(0.98, 1.0, 1.02);
    } else {
      // A lens: colour fringes growing to the rim.
      vec2 off = d * 2.6 * texel + vec2(burst * (2.0 + 8.0 * glitch) * texel.x, 0.0);
      col = vec3(texture2D(frame, uv + off).r, texture2D(frame, uv).g, texture2D(frame, uv - off).b);
      // A feed's grade: a little washed out and cool, the blacks lifted a touch.
      float g = lum(col);
      col = mix(vec3(g), col, 0.72);
      col = col * vec3(0.94, 1.0, 0.98) * 0.94 + vec3(0.015, 0.02, 0.02);
      col += grain * 0.06;
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
    float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, r.w / r.z * 1.25)));
    col *= mix(0.55, 1.0, v);
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
  private readonly frame: THREE.FramebufferTexture;
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
        time: { value: 0 },
        drone: { value: 1 },
        thermal: { value: 0 },
        rects: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        glitches: { value: [0, 0] },
        count: { value: 0 },
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
   * so each gets its own lens.
   */
  apply(gl: THREE.WebGLRenderer, rects: readonly LookRect[], glitch: readonly number[], drone: boolean, thermal: boolean, seconds: number): void {
    gl.setViewport(0, 0, this.w, this.h);
    gl.setScissor(0, 0, this.w, this.h);
    gl.copyFramebufferToTexture(this.frame, this.origin);
    const u = this.material.uniforms;
    u.time!.value = seconds;
    u.thermal!.value = thermal ? 1 : 0;
    u.drone!.value = drone ? 1 : 0;
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
  }

  dispose(): void {
    this.frame.dispose();
    this.material.dispose();
  }
}
