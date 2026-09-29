import { base } from '@ustago/eslint-config/base';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...base,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
