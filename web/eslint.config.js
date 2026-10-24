import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Browser globals used by the SPA. Inline rather than the `globals` package
 * to keep the frontend toolchain small.
 */
const browserGlobals = {
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Blob: 'readonly',
  CSS: 'readonly',
  CustomEvent: 'readonly',
  DOMParser: 'readonly',
  Event: 'readonly',
  EventSource: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  HTMLElement: 'readonly',
  Image: 'readonly',
  IntersectionObserver: 'readonly',
  MutationObserver: 'readonly',
  Node: 'readonly',
  Request: 'readonly',
  ResizeObserver: 'readonly',
  Response: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  WebSocket: 'readonly',
  XMLSerializer: 'readonly',
  alert: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  cancelAnimationFrame: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  confirm: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  getComputedStyle: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  matchMedia: 'readonly',
  navigator: 'readonly',
  performance: 'readonly',
  prompt: 'readonly',
  queueMicrotask: 'readonly',
  requestAnimationFrame: 'readonly',
  sessionStorage: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
  window: 'readonly',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      // 2025 is needed for import attributes (`import ... with { type: 'json' }`).
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: browserGlobals,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Keep the first pass focused on real problems, not legacy style noise.
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-async-promise-executor': 'warn',
      'require-atomic-updates': 'warn',
      'no-prototype-builtins': 'warn',
      'no-case-declarations': 'warn',
      'no-fallthrough': 'warn',
      'no-redeclare': 'warn',

      // React 17+ automatic JSX runtime: React does not need to be in scope.
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      // Mark identifiers referenced from JSX so no-unused-vars is accurate.
      'react/jsx-uses-vars': 'error',

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
