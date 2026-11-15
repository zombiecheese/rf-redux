// The modern view's heavier art features, each with its own switch, so the quality presets can turn them off one by
// one on a slower device. Every switch defaults to on.

export const ART = {
  /** The drone feed's tilt-shift focus: the top and bottom of the picture soft, as a lens close to something small. */
  tiltShift: true,
  /** The garden's ground from photo scans (photoground.ts); off, the ground is painted in flat colours. */
  photoGround: true,
  /** The photo scans' size in texels a side: 1024, or 512 to save memory and bandwidth. */
  groundDetail: 1024 as 1024 | 512,
};
