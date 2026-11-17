import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['.aws-sam/**', 'dist/**', 'node_modules/**'],
  },
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      // Structured JSON via console.log/console.error IS this service's logging
      // transport (CloudWatch), unlike apps/web where console output is a defect.
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The DOM lib is only in tsconfig so tsc can traverse @nixus/shared's UI
      // re-exports. This list catches the DOM globals most likely to be reached
      // for by accident in a Lambda; it is not an exhaustive browser-API ban.
      'no-restricted-globals': [
        'error',
        'document',
        'window',
        'navigator',
        'localStorage',
        'sessionStorage',
      ],
    },
  },
);
