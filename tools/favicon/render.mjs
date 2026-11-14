// `node --experimental-transform-types tools/favicon/render.mjs` (Node 22.7 or later, to run TypeScript): writes packages/client/favicon.svg
// from the pixel art favicon() in packages/client/src/logo.ts draws, one rect per run of same-coloured pixels so it
// stays crisp at any size.
import { register } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The client's imports name its .ts files as .js, as the TypeScript build expects.
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (spec.startsWith('.') && spec.endsWith('.js')) return next(spec.slice(0, -3) + '.ts', ctx);
    throw e;
  }
}`)}`);
const { favicon } = await import('../../packages/client/src/logo.ts');
const out = fileURLToPath(new URL('../../packages/client/favicon.svg', import.meta.url));

const px = favicon();
const colour = (c) => `#${[c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const rects = [];
for (let y = 0; y < px.h; y++) {
  for (let x = 0; x < px.w;) {
    const c = px.get(x, y);
    let n = 1;
    while (x + n < px.w && px.get(x + n, y) === c) n++;
    if (c >>> 24) rects.push(`<rect x="${x}" y="${y}" width="${n}" height="1" fill="${colour(c)}"/>`);
    x += n;
  }
}
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px.w} ${px.h}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`);
console.log(`wrote ${out} (${rects.length} runs)`);
