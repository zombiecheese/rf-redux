// PNG reading and writing for the art tools, with nothing but node's zlib. Images are { w, h, px }, px a Uint32Array
// of RGBA pixels as the browser's ImageData holds them (little-endian: 0xAABBGGRR); alpha 0 is transparent.

import { deflateSync, inflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const rgb = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

export function image(w, h, fill = 0) {
  return { w, h, px: new Uint32Array(w * h).fill(fill) };
}

/** An 8-bit RGBA PNG of an image. */
export function encodePng(img) {
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  const bytes = Buffer.from(img.px.buffer, img.px.byteOffset, img.px.byteLength);
  for (let y = 0; y < img.h; y++) bytes.copy(raw, y * (img.w * 4 + 1) + 1, y * img.w * 4, (y + 1) * img.w * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(img.w, 0);
  head.writeUInt32BE(img.h, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Reads a PNG as drawing programs save pixel art: 8 bits a channel, not interlaced; RGBA, RGB, grey, grey with alpha
 * or a palette (with its tRNS transparency). Anything else throws, naming what it found.
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file');
  let at = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  let palette = null;
  let trns = null;
  const data = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const name = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (name === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      type = body[9];
      if (body[8] !== 8 || body[12] !== 0) throw new Error(`PNG must be 8 bits a channel and not interlaced (found depth ${body[8]}, interlace ${body[12]})`);
    } else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') data.push(body);
    else if (name === 'IEND') break;
    at += len + 12;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`PNG colour type ${type} is not supported`);
  const raw = inflateSync(Buffer.concat(data));
  const stride = w * channels;
  const out = image(w, h);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) {
      const i = x * channels;
      let px;
      if (type === 6) px = rgb(line[i], line[i + 1], line[i + 2], line[i + 3]);
      else if (type === 2) px = rgb(line[i], line[i + 1], line[i + 2]);
      else if (type === 0) px = rgb(line[i], line[i], line[i]);
      else if (type === 4) px = rgb(line[i], line[i], line[i], line[i + 1]);
      else {
        const k = line[i] * 3;
        px = rgb(palette[k], palette[k + 1], palette[k + 2], trns && line[i] < trns.length ? trns[line[i]] : 255);
      }
      // The game's cels have one transparent colour, so a see-through pixel is fully clear.
      out.px[y * w + x] = px >>> 24 < 128 ? 0 : (px | 0xff000000) >>> 0;
    }
    prev = line;
  }
  return out;
}
