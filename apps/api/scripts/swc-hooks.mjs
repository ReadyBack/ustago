import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { transform } from '@swc/core';

const isLocal = (url) => url.startsWith('file:') && !url.includes('/node_modules/');

/** `./x.js` imports point at `./x.ts` sources (NodeNext style). */
export async function resolve(specifier, context, next) {
  if (context.parentURL && isLocal(context.parentURL) && /^\.{1,2}\//.test(specifier)) {
    const url = new URL(specifier, context.parentURL);
    if (url.pathname.endsWith('.js') && !existsSync(fileURLToPath(url))) {
      const ts = new URL(url.href.replace(/\.js$/, '.ts'));
      if (existsSync(fileURLToPath(ts))) return { url: ts.href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (isLocal(url) && url.endsWith('.ts')) {
    const filename = fileURLToPath(url);
    const { code } = await transform(await readFile(filename, 'utf8'), {
      filename,
      sourceMaps: 'inline',
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        target: 'es2023',
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
      module: { type: 'es6' },
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return next(url, context);
}
