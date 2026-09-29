import { node } from '@ustago/eslint-config/node';
import { defineConfig } from 'eslint/config';

export default defineConfig({ ignores: ['src/generated/**', 'dist/**'] }, ...node, {
  rules: {
    // Nest's DI reads constructor parameter types at runtime through
    // emitDecoratorMetadata, so injected classes must stay value imports.
    '@typescript-eslint/consistent-type-imports': 'off',
    '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
  },
});
