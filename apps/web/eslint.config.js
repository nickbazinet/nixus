import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.output/**',
      '.nitro/**',
      '.tanstack/**',
      'node_modules/**',
      'src/routeTree.gen.ts',
      'src/lib/release.gen.ts',
    ],
  },
  tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      'no-console': 'error',
    },
  },
);
