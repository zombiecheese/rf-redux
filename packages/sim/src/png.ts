// Reads the PNG files tools/convert_assets.py writes (the sprite atlases), so the server can look at tile pictures
// without a browser: 8-bit greyscale, RGB, palette or RGBA, not interlaced. inflate is zlib's (node:zlib's
// inflateSync on the server), passed in so the sim needs nothing from Node.

export interface PngImage {
  w: number;
  h: number;
  /** RGBA packed little-endian (red in the low byte), as canvas ImageData gives them; transparent pixels are 0. */
  px: Uint32Array;
}

export function decodePng(file: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): PngImage {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (sig.some((b, i) => file[i] !== b)) throw new Error('Not a PNG file');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = 0;
  let palette: Uint8Array | null = null;
  let alpha: Uint8Array | null = null;
  const parts: Uint8Array[] = [];
  for (let o = 8; o + 8 <= file.length;) {
    const len = view.getUint32(o);
    const tag = String.fromCharCode(...file.subarray(o + 4, o + 8));
    const body = file.subarray(o + 8, o + 8 + len);
    if (tag === 'IHDR') {
      w = view.getUint32(o + 8);
      h = view.getUint32(o + 12);
      depth = body[8]!;
      type = body[9]!;
      if (body[12] !== 0) throw new Error('Interlaced PNGs are not supported');
    } else if (tag === 'PLTE') palette = body;
    else if (tag === 'tRNS') alpha = body;
    else if (tag === 'IDAT') parts.push(body);
    else if (tag === 'IEND') break;
    o += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 6: 4 } as Record<number, number>)[type];
  if (depth !== 8 || !channels) throw new Error(`PNG colour type ${type} at ${depth} bits is not supported`);
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  const raw = inflate(joined);
  const stride = w * channels;
  const rows = new Uint8Array(h * stride);
  // Undo each row's filter (PNG spec section 9).
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[dst + x - channels]! : 0;
      const up = y ? rows[dst - stride + x]! : 0;
      const corner = y && x >= channels ? rows[dst - stride + x - channels]! : 0;
      let v = raw[src + x]!;
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      rows[dst + x] = v & 255;
    }
  }
  const px = new Uint32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let r: number;
    let g: number;
    let b: number;
    let a = 255;
    if (type === 3) {
      const k = rows[i]!;
      r = palette?.[k * 3] ?? 0;
      g = palette?.[k * 3 + 1] ?? 0;
      b = palette?.[k * 3 + 2] ?? 0;
      a = alpha && k < alpha.length ? alpha[k]! : 255;
    } else if (type === 0) {
      r = g = b = rows[i]!;
    } else {
      r = rows[i * channels]!;
      g = rows[i * channels + 1]!;
      b = rows[i * channels + 2]!;
      if (type === 6) a = rows[i * 4 + 3]!;
    }
    px[i] = a ? (((a << 24) | (b << 16) | (g << 8) | r) >>> 0) : 0;
  }
  return { w, h, px };
}
