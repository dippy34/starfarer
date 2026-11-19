// Flat ESLint config: typescript-eslint recommended rules for app, tests and build scripts.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public', 'scripts/build-catalogs/.raw', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'vite.config.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Architecture guard: platform services (storage, share, haptics, audio…) are only
    // reachable through src/platform so they can be swapped for Capacitor plugins later.
    files: ['src/**/*.ts'],
    ignores: ['src/platform/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Use platform.storage (src/platform).' },
        { name: 'sessionStorage', message: 'Use platform.storage (src/platform).' },
        { name: 'indexedDB', message: 'Use platform.blobs (src/platform).' },
        { name: 'AudioContext', message: 'Use platform.audio (src/platform).' },
        { name: 'history', message: 'Use platform.links (src/platform).' },
        { name: 'location', message: 'Use platform.links (src/platform).' },
        { name: 'caches', message: 'Use platform (src/platform).' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'share', message: 'Use platform.share.' },
        { object: 'navigator', property: 'vibrate', message: 'Use platform.haptics.' },
        { object: 'navigator', property: 'clipboard', message: 'Use platform.share.' },
        { object: 'window', property: 'localStorage', message: 'Use platform.storage.' },
        { object: 'window', property: 'indexedDB', message: 'Use platform.blobs.' },
        { object: 'window', property: 'location', message: 'Use platform.links.' },
      ],
    },
  },
);
