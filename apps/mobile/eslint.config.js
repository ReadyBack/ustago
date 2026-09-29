const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = (async () => {
  const { base } = await import('@ustago/eslint-config/base');
  return defineConfig([
    expoConfig,
    ...base,
    {
      files: ['*.config.js', 'eslint.config.js'],
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    { ignores: ['dist/**', '.expo/**', 'web-build/**'] },
  ]);
})();
