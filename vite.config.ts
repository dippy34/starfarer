import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Plugin, defineConfig } from 'vite';

/**
 * Emits dist/sw.js: a small service worker that pre-caches the app shell
 * (HTML, JS, CSS, icons — not the data tiles, which the app caches itself in
 * IndexedDB as they stream in) so Starfarer starts offline.
 */
function serviceWorker(): Plugin {
  return {
    name: 'starfarer-service-worker',
    apply: 'build',
    closeBundle() {
      const dist = join(process.cwd(), 'dist');
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const rel = relative(dist, full).split('\\').join('/');
          if (statSync(full).isDirectory()) {
            if (rel !== 'data') walk(full);
          } else if (rel !== 'sw.js') files.push(rel);
        }
      };
      walk(dist);
      const hash = createHash('sha1');
      for (const f of files.sort()) hash.update(f).update(readFileSync(join(dist, f)));
      const version = hash.digest('hex').slice(0, 12);
      const template = readFileSync(join(process.cwd(), 'src', 'platform', 'web', 'sw.template.js'), 'utf8');
      writeFileSync(join(dist, 'sw.js'), template.replace('__VERSION__', version).replace('"__FILES__"', JSON.stringify(['./', ...files.map((f) => `./${f}`)])));
    },
  };
}

export default defineConfig({
  // Relative base: the build works from any sub-folder and from Capacitor's local web server.
  base: './',
  resolve: { alias: { '@': '/src' } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  worker: { format: 'es' },
  server: { host: true },
  plugins: [serviceWorker()],
});
