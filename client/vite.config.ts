import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/healthz': { target: 'http://localhost:3000' },
    },
  },
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    // 兼顾老人手里较旧的手机浏览器 / 微信内置浏览器
    target: ['es2019', 'safari13', 'chrome79'],
    cssTarget: ['safari13', 'chrome79'],
  },
});
