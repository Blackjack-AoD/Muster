import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __APP_VERSION__: '"test"', __BUILD_TIME__: '"test"' },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/**/*.test.*', 'src/test/**'] },
  },
});
