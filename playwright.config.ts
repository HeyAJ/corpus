import { defineConfig } from '@playwright/test';

/**
 * BROWSER TESTS OF THE BUILT APP.
 *
 * Everything a visitor sees used to be checked only by hand-run scripts, so a blank page, a
 * console error on boot or a control painted over by a panel could reach the live site with
 * lint, types, the build and the simulation tests all green. These specs open the PRODUCTION
 * build (`vite preview` of `dist/`), the way a visitor does, and CI runs them.
 *
 * TWO RUNNERS, ONE REPOSITORY. Playwright collects only `tests/e2e/*.spec.ts`; Vitest collects
 * only `tests/**\/*.test.ts`. The suffixes differ on purpose so neither runner ever picks up
 * the other's files (a Playwright spec imported by Vitest dies on `test.describe`, and the
 * reverse is just as confusing).
 *
 * SOFTWARE WEBGL. A CI runner has no GPU, and headless Chromium then refuses WebGL 2 unless it
 * is told to use the SwiftShader software rasteriser. The same flags are used by the shared
 * screenshot tools. Software GL is slow, hence the generous timeouts below.
 *
 * CROSS-ORIGIN ISOLATION. The preview server sends the COOP/COEP headers from `vite.config.ts`;
 * without them there is no SharedArrayBuffer and the waveform channel degrades. boot.spec.ts
 * asserts `crossOriginIsolated`, so a lost header fails here instead of on the live site.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  // A software-GL boot plus the sim worker warm-up takes tens of seconds on a slow runner.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // One retry in CI only, so a flake on a shared runner does not hide a real failure locally.
  retries: process.env.CI ? 1 : 0,
  // Software WebGL makes every browser heavy: one worker locally so a shared machine is not
  // overloaded (a timeout under load is not a test failure), two on a CI runner.
  workers: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Serves the existing `dist/` build; CI builds first. Locally an already running server
    // on the port is reused, so a developer can point at their own.
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
    {
      name: 'phone',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
});
