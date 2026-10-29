import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import 'dotenv/config';
const basePath=(process.env.BASE_PATH||'').replace(/^\/+|\/+$/g,'');
export default defineConfig({
  base: basePath ? '/' + basePath + '/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Everything goes through the Express API (3070), which reverse-proxies
    // /files and /douyin to the tool services. changeOrigin:false keeps the
    // browser Host so same-origin checks match the 5173 Origin.
    proxy: Object.fromEntries(['api', 'files', 'douyin'].map((name) => [
      (basePath ? '/' + basePath : '') + '/' + name,
      { target: 'http://127.0.0.1:' + (process.env.PORT || 3070), changeOrigin: false },
    ])),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/leaflet/')) return 'map';
          if (id.includes('node_modules/marked/') || id.includes('node_modules/dompurify/')) return 'markdown';
        },
      },
    },
  },
});
