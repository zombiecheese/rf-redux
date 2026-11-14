// What the model files share. A model is a list of flat faces; the game wants them as a list of corners and, for
// each face, its sprite, its flags and which four corners it joins.

/**
 * One face: its sprite (cel), the renderer's flags and four corners [x, y, z], in the sprite's order: top left, top
 * right, bottom right, bottom left. `more` holds anything else the face carries (cull corners, a pair).
 */
export const q = (cel, flags, a, b, c, d, more = {}) => {
  const corners = [a, b, c, d];
  if (corners.some((p) => !Array.isArray(p) || p.length !== 3)) throw new Error(`cel ${cel}: a face has four [x, y, z] corners`);
  return { cel, flags, corners, more };
};

/**
 * A model. `lift` raises the point it is sorted from; `scale` sizes x and y; `sectors` is the order to draw the faces
 * in for each eighth of a turn, back to front, one character a face (0-9 then a-z), eight words; a face left out
 * of a word is not drawn from there.
 */
export function model({ lift = 0, scale = 1, sectors } = {}, faces) {
  const verts = [];
  const add = ([x, y, z]) => verts.push([x * scale, y * scale, z]) - 1;
  const out = faces.map((f) => {
    const v = f.corners.map(add);
    // A face may name two points to be culled by: it is skipped when the first lands past the second on screen.
    const { cull, ...more } = f.more;
    return { cel: f.cel, flags: f.flags, cull: cull ? cull.map(add) : [0, 0], v, ...more };
  });
  const m = { lift, verts, faces: out };
  if (sectors) {
    m.sectors = sectors.split(' ').map((word) => [...word].map((ch) => parseInt(ch, 36)));
    const sound = (s) => new Set(s).size === s.length && s.every((i) => i < faces.length);
    if (m.sectors.length !== 8 || !m.sectors.every(sound)) throw new Error('sectors: eight orders, each naming a face at most once');
  }
  return m;
}

/** Pixels to the game's 16.16 fixed point. */
export const fixed = (n) => Math.round(n * 65536);

/**
 * A collision box: the shape's flag bytes, its height range, where its middle sits in the tile and its bounds
 * around that middle, all in pixels.
 */
export const box = (flags, z, offset, bounds) => ({ type: 2, flags, z: z.map(fixed), offset: offset.map(fixed), bounds: bounds.map(fixed) });

/** A collision outline with corners (the fuel tank's octagon): a box's numbers, then the corners and their order. */
export const ring = (flags, z, offset, bounds, verts, edges) => ({ ...box(flags, z, offset, bounds), type: 3, verts: verts.map((v) => v.map(fixed)), edges });

/** The faces of a building's parts that fly off when it blows up: those whose flags give a kind (bits 8-9). */
function debris(parts) {
  const out = [];
  for (const { model: m, offset } of parts) {
    if (!m) continue;
    for (const i of m.sectors ? m.sectors[0] : m.faces.keys()) {
      const f = m.faces[i];
      const kind = (f.flags >> 8) & 3;
      if (kind) out.push({ cel: f.cel, add: Boolean(f.flags & 8), kind, offset: offset.map(fixed), v: f.v.map((k) => m.verts[k].map(fixed)) });
    }
  }
  return out;
}

/**
 * One entry of the building table. `flags`, `terrain` (written under it when placed; 255 keeps the map's), `hp`
 * (0 cannot be destroyed), `becomes` and `becomesTerrain` (what a destroyed one turns into) are what the game
 * reads from the record; they are packed into the words it expects (packages/sim/src/buildings.ts).
 * `parts` are its models, each alone or as [model, [x, y, z]] when it stands off the tile's middle. `flying` caps
 * how many of its faces fly off as debris (the fallen watchtowers throw only their first).
 */
export function building(name, { flags = 0, terrain, hp = 0, becomes = 0, becomesTerrain = 0, explosion = null, crushExplosion, parts = [], shapes = [], stubs, flying } = {}) {
  const list = parts.map((p) => (Array.isArray(p) ? { model: p[0], offset: p[1] } : { model: p, offset: [0, 0, 0] }));
  const raw = [0, flags, (hp << 8) | terrain, 0, 0, 0, 0, 0, 0, 0, (becomes << 8) | becomesTerrain, 0, 0];
  return { name, model: list[0]?.model ?? null, raw, parts: list, shapes, explosion, ...(crushExplosion ? { crushExplosion } : {}), debris: debris(list).slice(0, flying), ...(stubs ? { stubs } : {}) };
}
