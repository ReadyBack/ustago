import { type INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import type { ApiEnv } from './config/env.js';

/** Shared by main.ts and tests so both run the same HTTP pipeline. */
export function setupApp(app: INestApplication, env: ApiEnv): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(helmet());
  app.enableCors({ origin: env.API_CORS_ORIGINS, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  if (env.API_SWAGGER_ENABLED) {
    const config = new DocumentBuilder().setTitle('UstaGO API').setVersion(env.APP_VERSION).build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
  }
}
