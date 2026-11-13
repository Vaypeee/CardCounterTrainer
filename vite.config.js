import { defineConfig } from 'vite';
import site from './plugins/site.js';

export default defineConfig({
  // Absolute URLs: the site is meant to be served from the root of its domain
  // (Netlify / Cloudflare Pages), which canonical URLs and the sitemap assume.
  base: '/',
  plugins: [site()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
