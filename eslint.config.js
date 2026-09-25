import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public/tesseract', 'src/vendor']),
  {
    files: ['vite.config.js', '**/*.test.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/sw.js', 'src/lib/peyaWorkbookWorker.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        __WB_MANIFEST: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
