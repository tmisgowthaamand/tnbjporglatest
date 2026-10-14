import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The legal pages are static HTML in public/<name>/index.html. nginx serves
// /terms/ from that folder; Vite's dev/preview servers would otherwise fall
// back to the SPA's index.html, so map the folder URLs to the files here too.
const LEGAL_PAGES = /^\/(terms|privacy|contact)\/?(\?.*)?$/;
const legalPageRewrite = () => {
  const rewrite = (req, _res, next) => {
    const m = req.url && req.url.match(LEGAL_PAGES);
    if (m) req.url = `/${m[1]}/index.html${m[2] || ''}`;
    next();
  };
  return {
    name: 'legal-page-rewrite',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
};

export default defineConfig({
  plugins: [legalPageRewrite(), react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-v2.js`,
        chunkFileNames: `assets/[name]-[hash]-v2.js`,
        assetFileNames: `assets/[name]-[hash]-v2.[ext]`
      }
    }
  }
});
