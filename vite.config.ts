import { defineConfig } from 'vitest/config';

export default defineConfig({
  // relative asset paths: works at / (dev) and under /bio_fleet_final/ (GitHub Pages)
  base: './',
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
