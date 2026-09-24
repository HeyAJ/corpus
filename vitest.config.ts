import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Test config is separate from vite.config.ts so the app build does not carry a
 * Vitest type dependency. Tests run in Node: the sim core is pure TypeScript with
 * no DOM, and the render tests rasterise on the CPU rather than needing a GL
 * context (see tests/render/order-independence.test.ts).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@sim': r('./src/sim'),
      '@render': r('./src/render'),
      '@ui': r('./src/ui'),
      '@data': r('./src/data'),
      '@bridge': r('./src/bridge'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    coverage: { provider: 'v8', include: ['src/sim/**', 'src/render/materials/**', 'tools/ingest/normalise.ts'] },
  },
});
