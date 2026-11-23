import { defineConfig } from 'vite';

/**
 * Where the site is served from: the link preview's tags in index.html (og:url, og:image) must be
 * absolute, and this is the one place that says where. If the hosting moves, change it here or
 * build with SITE_URL set (it ends in '/').
 */
const SITE_URL = process.env.SITE_URL ?? 'https://dippy34.github.io/starfarer/';

export default defineConfig({
  plugins: [{ name: 'site-url', transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL) }],
  // Relative asset/data URLs so the build works from any path (e.g. GitHub Pages /<repo>/).
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
});
