import js from '@eslint/js';

/**
 * Minimal Node globals. Kept inline instead of pulling in the `globals`
 * package so the lint toolchain stays dependency-light.
 */
const nodeGlobals = {
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Blob: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  clearImmediate: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  fetch: 'readonly',
  global: 'readonly',
  performance: 'readonly',
  process: 'readonly',
  queueMicrotask: 'readonly',
  setImmediate: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
};

export default [
  {
    // The frontend has its own flat config in web/eslint.config.js.
    ignores: ['node_modules/**', 'web/**', 'data/**', 'deps/**', 'web/dist/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      // The existing codebase predates linting; keep the first pass
      // actionable instead of drowning in style noise.
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unused-private-class-members': 'warn',
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-async-promise-executor': 'warn',
      // Disabled: the flagged sites are intentional concurrency guards (e.g.
      // "read module-level cache/in-flight promise before await, write back in
      // finally"). Rewriting them into locks would add complexity and risk.
      // Reviewed case by case; none is a correctness race.
      'require-atomic-updates': 'off',
      'no-prototype-builtins': 'warn',
      'no-case-declarations': 'warn',
      'no-fallthrough': 'warn',
      'no-redeclare': 'warn',
    },
  },
];
