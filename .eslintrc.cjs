/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { browser: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules', '.cache', '*.cjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    'no-restricted-globals': 'off',
  },
  overrides: [
    {
      // LAYER A ISOLATION (spec 3, 13). The sim core is pure TypeScript: no rendering,
      // no DOM, no React. Enforced from day one, never retrofitted.
      files: ['src/sim/**/*.ts'],
      env: { browser: false, worker: true },
      rules: {
        'no-restricted-imports': ['error', {
          paths: [
            { name: 'three', message: 'LAYER A VIOLATION: src/sim must not import three.' },
            { name: 'react', message: 'LAYER A VIOLATION: src/sim must not import react.' },
            { name: 'react-dom', message: 'LAYER A VIOLATION: src/sim must not import react-dom.' },
            { name: 'zustand', message: 'LAYER A VIOLATION: src/sim must not import zustand.' },
          ],
          patterns: [
            { group: ['three/*', 'three'], message: 'LAYER A VIOLATION: src/sim must not import three.' },
            { group: ['@render/*', '@ui/*'], message: 'LAYER A VIOLATION: src/sim must not import render or ui layers.' },
            { group: ['*.css', '*.module.css'], message: 'LAYER A VIOLATION: src/sim must not import stylesheets.' },
          ],
        }],
        'no-restricted-globals': ['error',
          { name: 'window', message: 'LAYER A VIOLATION: no DOM in src/sim.' },
          { name: 'document', message: 'LAYER A VIOLATION: no DOM in src/sim.' },
          { name: 'localStorage', message: 'LAYER A VIOLATION: no DOM in src/sim.' },
        ],
        // Determinism (spec 4.1): one seeded PRNG owned by the core.
        'no-restricted-properties': ['error',
          { object: 'Math', property: 'random', message: 'DETERMINISM VIOLATION: use the seeded PRNG in sim/core/rng.ts.' },
          { object: 'Date', property: 'now', message: 'DETERMINISM VIOLATION: the sim clock is simTime, not wall-clock.' },
        ],
      },
    },
    {
      // LAYER B ISOLATION. The renderer reads snapshots; it never writes sim state.
      files: ['src/render/**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['react', 'react-dom', '@ui/*'], message: 'LAYER B VIOLATION: render must not import React or the UI layer.' },
            { group: ['@sim/worker', '@sim/systems/*', '@sim/core/integrator*'], message: 'LAYER B VIOLATION: render may read bridge types only, never the sim internals.' },
          ],
        }],
      },
    },
    {
      files: ['tools/**/*.ts', 'vite.config.ts'],
      env: { node: true, browser: false },
      rules: { 'no-restricted-imports': 'off', '@typescript-eslint/no-explicit-any': 'off' },
    },
    {
      files: ['tests/**/*.ts'],
      env: { node: true },
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
};
