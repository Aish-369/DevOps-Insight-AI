import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Ignore generated build output.
  globalIgnores(['dist']),

  {
    // Apply rules to TypeScript and React files.
    files: ['**/*.{ts,tsx}'],

    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],

    languageOptions: {
      parserOptions: {
        // Resolve TypeScript configuration from apps/web.
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
  },
])
