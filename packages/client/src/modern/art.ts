// The modern view's heavier art features, each with its own switch, so the quality presets can turn them off one by
// one on a slower device. Every switch defaults to on.

export const ART = {
  /** The drone feed's tilt-shift focus: the top and bottom of the picture soft, as a lens close to something small. */
  tiltShift: true,
  /** The garden's ground from photo scans (photoground.ts); off, the ground is painted in flat colours. */
  photoGround: true,
  /** The photo scans' size in texels a side: 1024, or 512 to save memory and bandwidth. */
  groundDetail: 1024 as 1024 | 512,
  /** Rocks from a photo scan of real stone (photorock.ts); off, they are flat grey. */
  photoRocks: true,
  /** The toys' reflections of a photographed garden (and a park at night); off, of a sky drawn in code. */
  photoSky: true,
  /** The garden's small things scattered on the ground (scatter.ts): pebbles, grass, fallen leaves, twigs. */
  scatter: true,
  /** How many of them, from 0.25 to 1 (a slower device can take fewer). */
  scatterDensity: 1,
  /**
   * Ambient occlusion: the ground darkens where it meets a building's foot, and every model darkens toward its own
   * base, so things sit on the ground instead of floating over it. Both are worked out ahead (no cost a frame); the
   * ground's needs ART.photoGround.
   */
  ao: true,
};
