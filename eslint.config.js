// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/core/**/*.ts', 'src/engine/**/*.ts'],
    rules: {
      // Architecture boundary: the lower layers must never depend on the
      // upper ones. See docs/05-folder-structure.md.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@game/*', '@ui/*', '**/game/**', '**/ui/**'],
              message: 'core/ and engine/ must not depend on game/ or ui/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'three', message: 'core/ must stay renderer-agnostic.' }],
          patterns: [
            {
              group: ['@game/*', '@engine/*', '**/game/**', '**/engine/**', '**/ui/**'],
              message: 'core/ sits at the bottom of the stack and depends on nothing.',
            },
          ],
        },
      ],
    },
  },
  {
    // The e2e runner is a Node script whose `page.evaluate` bodies are
    // serialised and run in the browser, so it legitimately references both
    // environments' globals.
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
