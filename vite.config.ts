import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * COOP/COEP are required for SharedArrayBuffer, which carries the 250 Hz waveform
 * channel (spec 3). Without them the bridge degrades to transferred Float32Array
 * chunks every 50 ms — see docs/MODEL_LIMITATIONS.md.
 */
const crossOriginIsolation: Plugin = {
  name: 'cross-origin-isolation',
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), crossOriginIsolation],
  resolve: {
    alias: {
      '@sim': r('./src/sim'),
      '@render': r('./src/render'),
      '@ui': r('./src/ui'),
      '@data': r('./src/data'),
      '@bridge': r('./src/bridge'),
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
});
