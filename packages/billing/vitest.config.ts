import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'billing',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
