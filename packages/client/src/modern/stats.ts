// A frame-stats overlay for tuning the modern view on real devices: add ?stats=1 to the game's address.
//
// It shows the frame rate and frame time (average and the worst 1%), the WebGL draw calls and triangles, how much
// texture and buffer data went up to the graphics card, and the graphics card's own time for each part of the frame
// where the browser can measure it (EXT_disjoint_timer_query_webgl2). The panel is a page element over the game, so
// it never changes the picture it measures. "Copy" puts a one-line report on the clipboard to paste in a message.

import type * as THREE from 'three';

const WANTED = new URLSearchParams(globalThis.location?.search ?? '').get('stats') === '1';

/** The parts of a frame timed on the graphics card, in the order they are drawn. */
export type GpuPart = 'scene' | 'feed' | 'screens';
/** The parts of a frame timed on the CPU (present: the copies of the finished picture onto the page). */
export type CpuPart = 'sim' | 'draw' | 'hud' | 'present';

const GPU_PARTS: GpuPart[] = ['scene', 'feed', 'screens'];
const CPU_PARTS: CpuPart[] = ['sim', 'draw', 'hud', 'present'];
/** Frames kept for the averages and the worst 1%: about five seconds at 60 fps. */
const WINDOW = 300;

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** Bytes of a texture upload, from texImage2D's or texSubImage2D's arguments (an estimate: 4 bytes a texel). */
function uploadBytes(args: unknown[]): number {
  // (target, level, internalformat, width, height, border, format, type, pixels)
  // (target, level, xoffset, yoffset, width, height, format, type, pixels)
  // (target, level, internalformat, format, type, source) and (target, level, x, y, format, type, source)
  // No pixels: the texture's memory set aside (a render target, say), nothing sent.
  if (args[args.length - 1] === null || args[args.length - 1] === undefined) return 0;
  const src = args[args.length - 1] as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; byteLength?: number } | null;
  if (src && typeof src === 'object') {
    if (typeof src.byteLength === 'number') return src.byteLength;
    const w = src.videoWidth ?? src.width ?? 0;
    const h = src.videoHeight ?? src.height ?? 0;
    if (w && h) return w * h * 4;
  }
  const nums = args.filter((a) => typeof a === 'number') as number[];
  if (nums.length >= 6) {
    // The width and height are the 4th and 5th numbers for texImage2D, the 5th and 6th for texSubImage2D.
    const [w, h] = nums.length >= 8 ? [nums[3]!, nums[4]!] : [nums[4]!, nums[5]!];
    return w * h * 4;
  }
  return 0;
}

export class FrameStats {
  static readonly on = WANTED;

  private gl: WebGL2RenderingContext | null = null;
  private three: THREE.WebGLRenderer | null = null;
  private timer: TimerExt | null = null;
  private readonly frames: number[] = [];
  private last = 0;
  private uploads = 0;
  private uploadsShown = 0;
  private uploadPeak = 0;
  private calls = 0;
  private triangles = 0;
  private readonly cpu = new Map<CpuPart, number[]>(CPU_PARTS.map((p) => [p, []]));
  private readonly cpuNow = new Map<CpuPart, number>();
  private readonly gpu = new Map<GpuPart, number[]>(GPU_PARTS.map((p) => [p, []]));
  /** Queries begun and not yet read, oldest first. */
  private readonly pending: { part: GpuPart; q: WebGLQuery }[] = [];
  private open: { part: GpuPart; q: WebGLQuery } | null = null;
  private readonly panel: HTMLElement;
  private readonly text: HTMLElement;
  private shownAt = 0;
  private report = '';
  private size = '';
  private extra = '';

  constructor() {
    const panel = (this.panel = document.createElement('div'));
    panel.style.cssText = 'position:fixed;left:6px;top:6px;z-index:9999;background:rgba(4,10,8,.82);color:#9ff0c4;'
      + 'font:11px/1.35 ui-monospace,Consolas,monospace;padding:6px 8px;border:1px solid #2c6;border-radius:4px;'
      + 'pointer-events:auto;white-space:pre;max-width:60vw';
    this.text = document.createElement('div');
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.style.cssText = 'margin-top:4px;font:inherit;background:#143;color:#9ff0c4;border:1px solid #2c6;cursor:pointer';
    copy.addEventListener('click', (e) => {
      e.stopPropagation();
      void navigator.clipboard?.writeText(this.report).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200); });
    });
    panel.append(this.text, copy);
    document.body.append(panel);
  }

  /** Watches a renderer's context: its uploads, draw calls and (when the browser allows) the GPU's time. */
  attach(renderer: THREE.WebGLRenderer): void {
    if (this.three === renderer) return;
    this.three = renderer;
    renderer.info.autoReset = false;
    const gl = (this.gl = renderer.getContext() as WebGL2RenderingContext);
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    const count = (name: 'texImage2D' | 'texSubImage2D' | 'texImage3D' | 'texSubImage3D' | 'compressedTexImage2D' | 'bufferData' | 'bufferSubData') => {
      const own = gl[name] as (...a: unknown[]) => void;
      if (typeof own !== 'function') return;
      (gl as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => {
        if (name === 'bufferData' || name === 'bufferSubData') {
          const d = a[name === 'bufferData' ? 1 : 2] as { byteLength?: number } | number;
          this.uploads += typeof d === 'number' ? d : d?.byteLength ?? 0;
        } else this.uploads += uploadBytes(a);
        return own.apply(gl, a);
      };
    };
    for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'bufferData', 'bufferSubData'] as const) count(n);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    this.extra = gpuName.replace(/^ANGLE \((.*)\)$/, '$1');
  }

  /** The 3D picture's size this frame, and anything else worth showing (the preset, say). */
  describe(size: string): void {
    this.size = size;
  }

  /** The start of a frame on screen. */
  frame(now: number): void {
    if (this.last) {
      this.frames.push(now - this.last);
      if (this.frames.length > WINDOW) this.frames.shift();
    }
    this.last = now;
    const info = this.three?.info;
    if (info) {
      this.calls = info.render.calls;
      this.triangles = info.render.triangles;
      info.reset();
    }
    this.uploadPeak = Math.max(this.uploadPeak, this.uploads);
    this.uploadsShown = this.uploads;
    this.uploads = 0;
    for (const p of CPU_PARTS) {
      const list = this.cpu.get(p)!;
      list.push(this.cpuNow.get(p) ?? 0);
      if (list.length > WINDOW) list.shift();
      this.cpuNow.set(p, 0);
    }
    this.collect();
    if (now - this.shownAt > 250) {
      this.shownAt = now;
      this.show();
    }
  }

  /** Times a part of the frame on the CPU (several calls in one frame add up). */
  time<T>(part: CpuPart, f: () => T): T {
    const t = performance.now();
    try {
      return f();
    } finally {
      this.cpuNow.set(part, (this.cpuNow.get(part) ?? 0) + performance.now() - t);
    }
  }

  /** Adds time spent on a part of the frame on the CPU, measured by the caller (ms). */
  add(part: CpuPart, ms: number): void {
    this.cpuNow.set(part, (this.cpuNow.get(part) ?? 0) + ms);
  }

  /** The GPU work from here on is this part's, until the next begin or end. */
  begin(part: GpuPart): void {
    const gl = this.gl;
    if (!gl || !this.timer) return;
    this.end();
    // Too many in flight means the results are not coming (the tab is hidden, say): start again.
    if (this.pending.length > 64) {
      for (const p of this.pending) gl.deleteQuery(p.q);
      this.pending.length = 0;
    }
    const q = gl.createQuery();
    if (!q) return;
    gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q);
    this.open = { part, q };
  }

  end(): void {
    const gl = this.gl;
    if (!gl || !this.timer || !this.open) return;
    gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.pending.push(this.open);
    this.open = null;
  }

  private collect(): void {
    const gl = this.gl;
    if (!gl || !this.timer) return;
    const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT) as boolean;
    const sums = new Map<GpuPart, number>();
    while (this.pending.length) {
      const p = this.pending[0]!;
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(p.q);
      this.pending.shift();
      if (!disjoint) sums.set(p.part, (sums.get(p.part) ?? 0) + ns / 1e6);
    }
    for (const [part, ms] of sums) {
      const list = this.gpu.get(part)!;
      list.push(ms);
      if (list.length > WINDOW / 2) list.shift();
    }
  }

  private show(): void {
    const f = this.frames;
    if (!f.length) return;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    const sorted = [...f].sort((a, b) => b - a);
    const worst = sorted.slice(0, Math.max(1, Math.round(f.length / 100)));
    const low = worst.reduce((a, b) => a + b, 0) / worst.length;
    const mean = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);
    const ms = (n: number) => n.toFixed(1);
    const mb = (n: number) => (n / 1048576).toFixed(n >= 1048576 * 10 ? 0 : 1);
    const gpu = this.timer
      ? GPU_PARTS.map((p) => `${p} ${ms(mean(this.gpu.get(p)!))}`).join('  ')
      : 'not available in this browser';
    const gpuTotal = this.timer ? GPU_PARTS.reduce((a, p) => a + mean(this.gpu.get(p)!), 0) : 0;
    const cpu = CPU_PARTS.map((p) => `${p} ${ms(mean(this.cpu.get(p)!))}`).join('  ');
    const lines = [
      `${(1000 / avg).toFixed(0)} fps   ${ms(avg)} ms   1% low ${(1000 / low).toFixed(0)} fps (${ms(low)} ms)`,
      `draws ${this.calls}   tris ${(this.triangles / 1000).toFixed(0)}k   upload ${mb(this.uploadsShown)} MB (peak ${mb(this.uploadPeak)})`,
      `GPU ms  ${gpu}${this.timer ? `   = ${ms(gpuTotal)}` : ''}`,
      `CPU ms  ${cpu}`,
      `${this.size}   ${innerWidth}x${innerHeight} @${devicePixelRatio}`,
      this.extra,
    ];
    this.text.textContent = lines.join('\n');
    this.report = lines.slice(0, 5).join(' | ') + ` | ${navigator.userAgent} | ${this.extra}`;
  }
}

/** The overlay, when the address asks for it. */
export const stats: FrameStats | null = FrameStats.on && typeof document !== 'undefined' ? new FrameStats() : null;
