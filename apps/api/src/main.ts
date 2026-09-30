import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { setupApp } from './app.setup.js';
import { API_ENV, type ApiEnv } from './config/env.js';

// Local development reads the single .env at the repository root. In
// deployed environments variables come from the platform instead.
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const env = app.get<ApiEnv>(API_ENV);
  app.useLogger(LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(env.LOG_LEVEL) + 1));
  setupApp(app, env);
  await app.listen(env.API_PORT);
  Logger.log(`UstaGO API listening on http://localhost:${env.API_PORT}/api/v1`, 'Bootstrap');
}

await bootstrap();
