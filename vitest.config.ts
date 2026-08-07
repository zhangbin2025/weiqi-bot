import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['**/components/**/*.test.tsx', 'jsdom'],
      ['**/pages/**/*.test.ts', 'jsdom'],
      ['**/presentation/adapters/web/**/*.test.ts', 'jsdom'],
    ],
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx', '**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'dist', 'app/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        '**/__tests__/**',
        '**/*.test.ts',
        '**/index.ts',
      ],
    },
    typecheck: {
      enabled: true,
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      '@infrastructure': resolve(__dirname, 'infrastructure'),
      '@ui': resolve(__dirname, 'clients/web/shared/ui'),
      '@services': resolve(__dirname, 'services'),
      '@application': resolve(__dirname, 'application'),
      '@domain': resolve(__dirname, 'domain'),
      '@presentation': resolve(__dirname, 'presentation'),
      // Mock @weiqi/worker for tests
      '@weiqi/worker': resolve(__dirname, '__mocks__/@weiqi/worker.ts'),
    },
  },
});