// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', '.expo-shared/*'],
  },
  {
    // The Expo template's web hydration hook (use-color-scheme.web.ts) legitimately
    // calls setState in an effect to mark hydration — the rule's general guidance
    // doesn't apply to that one-off pattern. Downgrade to warn rather than edit
    // template code that resets on `pnpm reset-project`.
    files: ['src/hooks/use-color-scheme.web.ts'],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
