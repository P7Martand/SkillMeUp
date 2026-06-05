import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'crawler/**/*.test.ts'],
    environment: 'node'
  }
});
