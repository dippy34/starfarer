import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { makeOfflineManifest, type OfflineFile } from './src/offline/manifest.ts';

/**
 * Where the site is served from: the link preview's tags in index.html (og:url, og:image) must be
 * absolute, and this is the one place that says where. If the hosting moves, change it here or
 * build with SITE_URL set (it ends in '/').
 */
const SITE_URL = process.env.SITE_URL ?? 'https://dippy34.github.io/starfarer/';
const MANIFEST = 'offline-manifest.json';

/** Every deployable file, with its real byte count and SHA-256. The manifest alone cannot list itself. */
function offlineManifest(): Plugin {
  let root = '', outDir = '';
  const walk = async (dir: string): Promise<OfflineFile[]> => {
    const out: OfflineFile[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await walk(full));
      else if (entry.isFile()) {
        const name = path.relative(root, full).split(path.sep).join('/');
        if (name === MANIFEST) continue;
        const bytes = await readFile(full);
        out.push({ path: name, size: bytes.byteLength, hash: createHash('sha256').update(bytes).digest('hex') });
      }
    }
    return out;
  };
  return {
    name: 'offline-file-manifest',
    apply: 'build',
    configResolved: (config) => { root = path.resolve(config.root, config.build.outDir); outDir = config.build.outDir; },
    closeBundle: async () => {
      const files = await walk(root);
      const version = createHash('sha256').update(files.map((f) => `${f.path}\0${f.size}\0${f.hash}`).sort().join('\n')).digest('hex').slice(0, 20);
      await writeFile(path.join(root, MANIFEST), JSON.stringify(makeOfflineManifest(files, version)));
      console.log(`offline manifest: ${files.length} files, ${(files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1)} MB (${outDir}/${MANIFEST})`);
    },
  };
}

export default defineConfig({
  plugins: [{ name: 'site-url', transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL) }, offlineManifest()],
  // Relative asset/data URLs so the build works from any path (e.g. GitHub Pages /<repo>/).
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
});
