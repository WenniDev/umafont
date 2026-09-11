import { defineConfig } from 'vite';

export default defineConfig({
  base: '/umafont/',
  build: { outDir: 'dist' },
  server: {
    host: '127.0.0.1',
  },
});
