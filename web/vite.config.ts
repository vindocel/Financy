import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/auth': {
        target: process.env.API_BASE_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
      '/families': {
        target: process.env.API_BASE_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
      '/purchases': {
        target: process.env.API_BASE_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
      '/join-requests': {
        target: process.env.API_BASE_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
      '/notifications': {
        target: process.env.API_BASE_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  define: {
    __DEV__: mode !== 'production',
  },
}));

