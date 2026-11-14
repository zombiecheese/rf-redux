import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

// Converted original assets live outside the repo's tracked files (see docs/assets.md). The dev server serves
// them from assets/; a production build leaves them out, and the game server serves them from ASSETS_DIR.
// Each page is its own entry: the game (index.html), the level editor (editor.html) and the admin panel (admin.html).
// In development the API and the game WebSocket go to the game server on port 8080 (npm start in another terminal).
/** The game's version, shown in About and System Info. */
const version = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string }).version;

export default defineConfig(({ command }) => ({
  define: { __APP_VERSION__: JSON.stringify(version) },
  publicDir: command === 'serve' ? '../../assets' : false,
  plugins: [generatedMaps(), artPack()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    // The modern view's code with three.js is one lazily loaded chunk of about 600 kB (160 kB gzipped).
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
}));

/**
 * The art pack (assets/art/pack, this project's own sprites; `npm run art` builds it) goes into the built client
 * under /art/pack/, where the dev server already serves it from assets/.
 */
function artPack(): Plugin {
  const dir = resolve(import.meta.dirname, '../../assets/art/pack');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  return {
    name: 'rfw-art-pack',
    apply: 'build',
    generateBundle() {
      if (!existsSync(dir)) return;
      for (const file of walk(dir)) this.emitFile({ type: 'asset', fileName: `art/pack/${relative(dir, file).replaceAll('\\', '/')}`, source: readFileSync(file) });
    },
  };
}

/**
 * The built-in 3- and 4-base maps are made from the converted originals and kept in memory, never written out (see
 * packages/server/src/maps.ts, which does the same for the game server). In development this serves them, and the
 * map list with them added, under /generated/maps/ as the game server does.
 */
function generatedMaps(): Plugin {
  const dir = resolve(import.meta.dirname, '../../assets/generated');
  const art = resolve(import.meta.dirname, '../../assets/art/pack');
  let made: Promise<{ index: unknown[]; maps: Map<string, unknown> }> | null = null;
  const make = async (server: ViteDevServer) => {
    type Sim = typeof import('@rfw/sim');
    const sim = (await server.ssrLoadModule('@rfw/sim')) as Sim;
    // The art pack's file when it has one, else the converted assets', as the game server picks them.
    const read = (p: string) => {
      const file = [resolve(art, p), resolve(dir, p)].find((f) => existsSync(f));
      return file ? new Uint8Array(readFileSync(file)) : null;
    };
    const json = (p: string) => JSON.parse(new TextDecoder().decode(read(p)!));
    if (!read('buildings.json') || !read('maps/index.json')) return { index: [], maps: new Map() };
    const effects = read('effects.json') ? json('effects.json').defs : undefined;
    const defs = sim.buildingDefs(json('buildings.json'), effects);
    const list = sim.builtInMaps(read, (d) => new Uint8Array(inflateSync(d)), defs);
    const index: { id: string }[] = json('maps/index.json');
    const maps = new Map<string, unknown>(list.map((g) => [g.id, g.map]));
    for (const e of index) if (read(`maps/${e.id}.json`)) maps.set(e.id, json(`maps/${e.id}.json`));
    return { index: [...index, ...sim.generatedIndex(list)], maps };
  };
  return {
    name: 'rfw-generated-maps',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        // What the optional extras folder holds, as the game server lists it.
        if (path === '/generated/extras.json') {
          const list = (sub: string) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)) : []);
          const files = [...list('music').filter((f) => f === 'soundfont.sf2' || f.endsWith('.mid')).map((f) => `music/${f}`), ...list('sprites').filter((f) => f === 'frames.json').map((f) => `sprites/${f}`)].sort();
          res.setHeader('content-type', 'application/json');
          return void res.end(JSON.stringify({ files }));
        }
        if (!path.startsWith('/generated/maps/')) return next();
        made ??= make(server);
        made.then(({ index, maps }) => {
          const id = /^\/generated\/maps\/([A-Za-z0-9_-]+)\.json$/.exec(path)?.[1];
          const body = path === '/generated/maps/index.json' ? (index.length ? index : null) : id ? maps.get(id) : null;
          if (!body) return next();
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        }, next);
      });
    },
  };
}
