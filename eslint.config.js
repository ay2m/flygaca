import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `server/` is a separate package with its own toolchain and eslint config
  // (linted by its own CI job); the root lint must not reach into it or its
  // compiled output — doing so flags TS rules the root config lacks.
  {
    ignores: [
      'dist',
      'dev-dist',
      'coverage',
      'ios',
      'android',
      'public',
      // `server/` is its own npm package with its own eslint config and CI job.
      'server',
      'supabase',
      'archive',
      'src/dataconnect-generated',
    ],
  },
  {
    // react-hooks v6+ ships flat presets that register the plugin themselves;
    // `recommended-latest` also enables the compiler-derived rules added in v6/v7.
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // The v6/v7 compiler-derived rules flag long-established intentional
      // patterns here (state snapshots in mount effects, roving-focus ref
      // reads, hand-tuned memoization). Kept visible as warnings for
      // incremental review — mirrors the jsx-a11y triage below — so they
      // never mask a new error-level violation.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // Guards against half-applied merges leaving a second import of the same
      // module — tsc only catches these when the *bindings* collide.
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
    },
  },
  {
    // Static accessibility checks on JSX — catches missing alt text, bad ARIA,
    // invalid roles, etc. at lint time, complementing the runtime axe audits in
    // e2e/a11y.spec.ts. The correctness rules (alt-text, aria-*, role validity)
    // run as errors. A few interaction/focus rules are set to `warn` because
    // they trip established, intentional patterns already in the app — modal
    // backdrops that close on outside-click (keyboard close lives on the dialog),
    // roving arrow-key navigation on list/grid containers, and focus-on-open
    // inline inputs. They stay visible in CI output for incremental review
    // rather than blocking, and never mask a *new* error-level violation.
    ...jsxA11y.flatConfigs.recommended,
    files: ['**/*.tsx'],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      'jsx-a11y/no-autofocus': 'off',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/no-interactive-element-to-noninteractive-role': 'warn',
    },
  },
  {
    // Node-side files: Playwright E2E and config files run under Node, not the
    // browser, so expose Node globals (process, etc.).
    files: ['e2e/**/*.ts', 'config/**/*.ts', 'capacitor.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // The Cloudflare Worker runs in a service-worker-like runtime (no DOM/window),
    // so expose worker globals (self, fetch, Response, caches, etc.) instead of
    // the browser set.
    files: ['worker/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
);
