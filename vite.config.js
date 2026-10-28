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
    proxy: {
      '/api': 'http://127.0.0.1:3070',
      // Keep browser Host/Origin as 5173 so douyin CSRF origin check matches.
      '/douyin': {
        target: 'http://127.0.0.1:7863',
        rewrite: (path) => {
          const next = path.replace(/^\/douyin/, '') || '/';
          return next;
        },
        changeOrigin: false,
      },
      '/files': {
        target: 'http://127.0.0.1:7864',
        changeOrigin: false,
      },
    },
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
