// The modern view's camera look: a surveillance drone's feed over the toy-soldier world, and its thermal camera.
//
// The drone feed is a pass over the finished picture: a slightly washed, cool grade, a soft lens (colour fringes and
// a darker rim), film grain and a faint rolling line, as a feed from high up looks. Thermal is drawn by the models
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
  uniform int count;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 px = gl_FragCoord.xy;
    vec4 r = vec4(0.0, 0.0, res);
    for (int i = 0; i < 2; i++) {
      if (i >= count) break;
      vec4 q = rects[i];
      if (px.x >= q.x && px.x < q.x + q.z && px.y >= q.y && px.y < q.y + q.w) r = q;
    }
    vec2 local = (px - r.xy) / r.zw;
    vec2 d = local - 0.5;
    vec2 texel = 1.0 / res;
    float grain = hash(floor(px) + fract(time * 13.7) * 91.0) - 0.5;
    vec3 col;
    if (thermal > 0.5) {
      // White-hot: heat as brightness, a little soft, with sensor noise and faint banding.
      float t = lum(texture2D(frame, vUv).rgb) * 0.4;
      t += lum(texture2D(frame, vUv + vec2(texel.x, 0.0)).rgb) * 0.15;
      t += lum(texture2D(frame, vUv - vec2(texel.x, 0.0)).rgb) * 0.15;
      t += lum(texture2D(frame, vUv + vec2(0.0, texel.y)).rgb) * 0.15;
      t += lum(texture2D(frame, vUv - vec2(0.0, texel.y)).rgb) * 0.15;
      t = smoothstep(0.04, 0.92, t);
      t += grain * 0.07 + 0.012 * sin(px.y * 0.9 + time * 40.0);
      col = vec3(t) * vec3(0.98, 1.0, 1.02);
    } else {
      // A lens: colour fringes growing to the rim.
      vec2 off = d * 2.6 * texel;
      col = vec3(texture2D(frame, vUv + off).r, texture2D(frame, vUv).g, texture2D(frame, vUv - off).b);
      // A feed's grade: a little washed out and cool, the blacks lifted a touch.
      float g = lum(col);
      col = mix(vec3(g), col, 0.72);
      col = col * vec3(0.94, 1.0, 0.98) * 0.94 + vec3(0.015, 0.02, 0.02);
      col += grain * 0.06;
    }
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
  apply(gl: THREE.WebGLRenderer, rects: readonly LookRect[], thermal: boolean, seconds: number): void {
    gl.setViewport(0, 0, this.w, this.h);
    gl.setScissor(0, 0, this.w, this.h);
    gl.copyFramebufferToTexture(this.frame, this.origin);
    const u = this.material.uniforms;
    u.time!.value = seconds;
    u.thermal!.value = thermal ? 1 : 0;
    const list = u.rects!.value as THREE.Vector4[];
    const n = Math.min(2, rects.length);
    for (let i = 0; i < n; i++) {
      const r = rects[i]!;
      list[i]!.set(r.x, this.h - r.y - r.h, r.w, r.h);
    }
    u.count!.value = n;
    gl.render(this.scene, this.camera);
  }

  dispose(): void {
    this.frame.dispose();
    this.material.dispose();
  }
}
