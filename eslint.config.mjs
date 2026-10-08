// Code checker (ESLint) for the server, the client and the MCP server — 2026-10-08.
// Focus: real bugs, security, slow patterns and over-complex code — not cosmetic style.
// Problems that existed on 2026-10-08 are listed in eslint-suppressions.json; anything NEW fails
// (`npm run lint`). The list may only shrink: after fixing, `npm run lint -- --prune-suppressions`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

const TESTS = ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', 'dist/**', 'src/client/dist/**', 'mcp-server/dist/**',
      'coverage/**', 'src/client/dist-deploy/**', 'e2e/**', 'playwright-report/**', 'test-results/**', '**/*.d.ts',
      'scripts/**', '*.config.{js,ts,mjs,cjs}', 'src/client/*.config.{js,ts,mjs,cjs}', 'mcp-server/server.ts',
    ],
  },
  {
    files: ['src/server/**/*.ts', 'src/client/src/**/*.{ts,tsx}', 'mcp-server/src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { security, sonarjs },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // --- bugs ---
      '@typescript-eslint/no-floating-promises': 'error',   // a save "succeeds" before it happened
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      eqeqeq: ['error', 'smart'],
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-promise-executor-return': 'error',
      'no-return-assign': 'error',
      'array-callback-return': 'error',
      'sonarjs/no-identical-conditions': 'error',
      'sonarjs/no-all-duplicated-branches': 'error',
      'sonarjs/no-element-overwrite': 'error',
      'sonarjs/no-collection-size-mischeck': 'error',
      'sonarjs/no-ignored-return': 'error',
      // --- security ---
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      // --- efficiency ---
      'no-await-in-loop': 'error',                           // one database call per item → ask once for all
      'no-restricted-syntax': ['error',
        {
          // 2,000 tasks × search 2,000 people = 4 million steps; a Map built once = 4,000
          selector: ":matches(ForStatement, ForOfStatement, ForInStatement, WhileStatement, DoWhileStatement, CallExpression[callee.property.name=/^(map|forEach|flatMap|reduce|filter|some|every|find|findIndex)$/] > :function) CallExpression[callee.property.name=/^(find|findIndex|findLast|findLastIndex|filter)$/]",
          message: 'Searching a list inside a loop (slow on big lists). Build a Map/Set once before the loop. If both lists are always small, disable with a reason: // eslint-disable-next-line no-restricted-syntax -- small: <why>',
        },
        {
          selector: ":matches(ForStatement, ForOfStatement, ForInStatement, WhileStatement, DoWhileStatement, CallExpression[callee.property.name=/^(map|forEach|flatMap|reduce)$/] > :function) :matches(CallExpression[callee.property.name='sort'], NewExpression[callee.name='RegExp'])",
          message: 'Sorting or building a RegExp inside a loop — do it once before the loop.',
        },
      ],
      // --- complexity / duplication ---
      'sonarjs/cognitive-complexity': ['error', 25],
      'sonarjs/no-identical-functions': 'error',
      'max-depth': ['error', 5],
      // --- quieter than the defaults (style, not correctness) ---
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/client/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',              // stale data or endless reloads
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    // tests: not in the build's TypeScript project, and loops of awaits are fine there
    files: TESTS,
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'no-await-in-loop': 'off',
      'no-restricted-syntax': 'off',
      'security/detect-unsafe-regex': 'off', // tests read our own code, never user input
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-identical-functions': 'off',
      'max-depth': 'off',
    },
  },
);
