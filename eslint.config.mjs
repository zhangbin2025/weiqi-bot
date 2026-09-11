import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist*/**',
      'clients/web/dist/**',
      'clients/web/public/**',
      'clients/desktop/**',
      'clients/app/android/**',
      '**/__tests__/**',
      '**/*.test.ts',
      '**/*.js',
      '**/*.mjs',
      'vitest.setup.ts',
      'vitest.config.ts',
      'vite.config.ts',
      '__mocks__/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
