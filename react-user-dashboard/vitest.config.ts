import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
    globals: true, // Enables global 'describe', 'it', 'expect' without explicit imports
    include: ['src/**/*.{test,spec}.{js,ts,tsx,mjs}'],
  },
});
