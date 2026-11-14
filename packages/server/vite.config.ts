import { defineConfig } from 'vite';

// Bundles the server with the shared sim and protocol packages into one file, dist/main.js, so the image needs no
// node_modules. Node built-ins stay imports.
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'main.js' } },
  },
  ssr: { noExternal: true },
});
