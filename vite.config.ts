import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@core': r('./src/core'),
      '@engine': r('./src/engine'),
      '@game': r('./src/game'),
      '@config': r('./src/config'),
      '@ui': r('./src/ui'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep the renderer out of the entry chunk so the boot bundle stays small
        // and the loading screen can paint before Three.js is parsed.
        manualChunks: {
          three: ['three'],
          bvh: ['three-mesh-bvh'],
        },
      },
    },
  },
  server: { host: true, port: 5173 },
});
