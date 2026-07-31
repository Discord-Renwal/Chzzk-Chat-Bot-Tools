import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'auth',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
