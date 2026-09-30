import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { securitySummary } from '@ustago/config';

import { AppModule } from './app.module.js';
import { setupApp } from './app.setup.js';
import { API_ENV, type ApiEnv } from './config/env.js';
import { JsonLogger } from './observability/json-logger.js';

// Local development reads the single .env at the repository root. In
// deployed environments variables come from the platform instead.
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;

async function bootstrap(): Promise<void> {
  const jsonLogs =
    process.env['LOG_FORMAT'] === 'json' ||
    (process.env['LOG_FORMAT'] === undefined && process.env['NODE_ENV'] === 'production');
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    ...(jsonLogs ? { logger: new JsonLogger() } : {}),
  });
  const env = app.get<ApiEnv>(API_ENV);
  app.useLogger(
    env.LOG_FORMAT === 'json'
      ? new JsonLogger(env.LOG_LEVEL)
      : LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(env.LOG_LEVEL) + 1),
  );
  setupApp(app, env);
  // A secret-free summary of what this process will do (docs/adr/0022).
  for (const line of securitySummary(env)) Logger.log(line, 'Config');
  await app.listen(env.API_PORT);
  Logger.log(`UstaGO API listening on port ${env.API_PORT} (/api/v1)`, 'Bootstrap');
}

await bootstrap();
