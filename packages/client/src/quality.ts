// The modern view's quality presets (Options > View > Quality): Low, Medium, High and Ultra change what a frame
// costs, never the look's identity (the drone feed is on in every one), and Auto picks one for the device. Each
// player picks their own, even online, since it is about their device, not the match. Kept per device in this
// browser (never synced to the profile), and apart from the renderer so the menus can show it without three.js.
//
// Dynamic resolution then holds the frame rate: the 3D picture is drawn at a little less than the preset's size
// while the device falls behind, and back up when it catches up. The HUD is drawn at the screen's own resolution
// whatever the 3D picture's size.

export type Preset = 'low' | 'medium' | 'high' | 'ultra';
export type QualityChoice = 'auto' | Preset;

export const PRESET_ORDER: readonly Preset[] = ['low', 'medium', 'high', 'ultra'];
export const PRESET_NAMES: Record<QualityChoice, string> = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

export interface PresetSpec {
  /** The 3D picture's width in device pixels, for a picture shown this many device pixels wide. */
  width: (shown: number) => number;
  /** The sun's shadow map, texels a side. */
  sunShadow: number;
  /** Which vehicles' headlights throw shadows at night: none, the players' at this screen, or all. */
  headlightShadows: 'none' | 'own' | 'all';
  /** The feed's tilt-shift focus. */
  tiltShift: boolean;
  /** The garden ground from photo scans, and their size (from the next match). */
  photoGround: boolean;
  groundDetail: 1024 | 512;
  /** The garden's scatter of pebbles, grass, leaves and twigs, and how dense (from the next match). */
  scatter: boolean;
  scatterDensity: number;
}

/** The modern screen's own width (layout.ts), kept here so this file needs nothing from the renderer. */
const BASE_W = 1280;

export const PRESETS: Record<Preset, PresetSpec> = {
  low: {
    width: () => BASE_W * 0.6, sunShadow: 1024, headlightShadows: 'none', tiltShift: false,
    photoGround: true, groundDetail: 512, scatter: false, scatterDensity: 0,
  },
  medium: {
    width: () => BASE_W, sunShadow: 2048, headlightShadows: 'own', tiltShift: true,
    photoGround: true, groundDetail: 512, scatter: true, scatterDensity: 0.5,
  },
  high: {
    width: (shown) => Math.min(Math.max(BASE_W, shown), 2560), sunShadow: 2048, headlightShadows: 'all', tiltShift: true,
    photoGround: true, groundDetail: 1024, scatter: true, scatterDensity: 1,
  },
  ultra: {
    width: (shown) => Math.min(Math.max(BASE_W, shown), 3840), sunShadow: 4096, headlightShadows: 'all', tiltShift: true,
    photoGround: true, groundDetail: 1024, scatter: true, scatterDensity: 1,
  },
};

const CHOICE_KEY = 'rf.quality';
const AUTO_KEY = 'rf.quality.auto';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the choice lasts this visit only.
  }
}

const isPreset = (v: string | null): v is Preset => !!v && (PRESET_ORDER as readonly string[]).includes(v);

let choice: QualityChoice = (() => {
  const q = new URLSearchParams(globalThis.location?.search ?? '').get('quality');
  if (q === 'auto' || isPreset(q)) return q;
  const v = read(CHOICE_KEY);
  return v === 'auto' || isPreset(v) ? v : 'auto';
})();
let autoFound: Preset | null = (() => {
  const v = read(AUTO_KEY);
  return isPreset(v) ? v : null;
})();

export function qualityChoice(): QualityChoice {
  return choice;
}

export function setQualityChoice(q: QualityChoice): void {
  choice = q;
  write(CHOICE_KEY, q);
}

/** Phones and tablets aim for 30 frames a second, everything else for 60. */
export function frameTarget(handheld: boolean): number {
  return handheld ? 1000 / 30 : 1000 / 60;
}

/** The preset in use: the player's pick, or Auto's (what it found on this device, else its first guess). */
export function activePreset(handheld: boolean): Preset {
  if (choice !== 'auto') return choice;
  return autoFound ?? (handheld ? 'medium' : 'high');
}

/** What Auto settled on for this device, or null before it has run. */
export function autoPreset(): Preset | null {
  return autoFound;
}

function settleAuto(p: Preset): void {
  autoFound = p;
  write(AUTO_KEY, p);
}

/** How the frame time is judged: every half second, from the frames shown in it. */
const WINDOW_MS = 500;
const SCALE_MIN = 0.6;

/**
 * Holds the frame rate: watches how long frames take on screen and scales the 3D picture between 60% and 100% of
 * the preset's size. Under Auto, a device that stays at the smallest picture for a few seconds steps down a preset,
 * and the preset it settles on is kept for next time.
 */
export class Pacer {
  /** The 3D picture's size as a share of the preset's (0.6-1). */
  scale = 1;
  private last = 0;
  private sum = 0;
  private frames = 0;
  private windowStart = 0;
  private calm = 0;
  private starved = 0;
  /** The first moments of a match are loading and building: not judged. */
  private settleUntil = 0;

  constructor(private readonly handheld: boolean) {}

  /** A frame shown at now (ms). Returns true when the preset changed (Auto stepped down). */
  frame(now: number): boolean {
    if (!this.last || now - this.last > 1000) {
      // The first frame, or after a pause or a hidden tab: start the count again.
      this.last = now;
      this.windowStart = now;
      this.sum = 0;
      this.frames = 0;
      if (!this.settleUntil) this.settleUntil = now + 1500;
      return false;
    }
    this.sum += now - this.last;
    this.frames++;
    this.last = now;
    if (now - this.windowStart < WINDOW_MS) return false;
    const avg = this.sum / this.frames;
    this.windowStart = now;
    this.sum = 0;
    this.frames = 0;
    if (now < this.settleUntil) return false;
    const target = frameTarget(this.handheld);
    if (avg > target * 1.12) {
      this.scale = Math.max(SCALE_MIN, Math.round((this.scale - 0.1) * 20) / 20);
      this.calm = 0;
    } else if (avg < target * 1.05) {
      if (++this.calm >= 3) {
        this.scale = Math.min(1, Math.round((this.scale + 0.05) * 20) / 20);
        this.calm = 0;
      }
    } else this.calm = 0;
    // Under Auto, held at the smallest picture and still behind for a few seconds: one preset lower.
    if (choice === 'auto' && this.scale <= SCALE_MIN && avg > target * 1.12) {
      if (++this.starved >= 6) {
        this.starved = 0;
        const i = PRESET_ORDER.indexOf(activePreset(this.handheld));
        if (i > 0) {
          settleAuto(PRESET_ORDER[i - 1]!);
          this.scale = 1;
          this.settleUntil = this.last + 1500;
          return true;
        }
      }
    } else {
      this.starved = 0;
      // Holding up under Auto: what it is on now is what this device keeps.
      if (choice === 'auto' && !autoFound && this.scale >= 1) settleAuto(activePreset(this.handheld));
    }
    return false;
  }
}
