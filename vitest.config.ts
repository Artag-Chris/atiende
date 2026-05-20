import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Vitest config — usa esbuild (incluido en vitest) para transpilar TypeScript.
 * Esto permite tests rápidos sin dependencias adicionales.
 *
 * Nota: NestJS decorators + DI necesitan reflect-metadata cargado en el setup.
 * Por eso `setupFiles: ['reflect-metadata']`.
 */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.spec.ts',
        '**/*.dto.ts',
        'src/main.ts',
        'prisma/**',
      ],
    },
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@modules': resolve(__dirname, 'src/modules'),
      '@config': resolve(__dirname, 'src/config'),
    },
  },
});
