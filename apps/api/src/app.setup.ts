import { type INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { isStrictEnv } from '@ustago/config';
import helmet from 'helmet';

import { secretFor } from './common/crypto/secrets.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { ipHashMiddleware } from './common/http/client-context.js';
import { requestIdMiddleware } from './common/http/request-id.js';
import type { ApiEnv } from './config/env.js';
import { accessLogMiddleware } from './observability/access-log.js';
import {
  ConsoleErrorReporter,
  NoopErrorReporter,
  setErrorReporter,
} from './observability/error-reporter.js';

/** Shared by main.ts and tests so both run the same HTTP pipeline. */
export function setupApp(app: INestApplication, env: ApiEnv): void {
  const strict = isStrictEnv(env.APP_ENV);
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(requestIdMiddleware);
  app.use(ipHashMiddleware(secretFor(env, 'ip-hash', env.IP_HASH_SECRET)));
  app.use(accessLogMiddleware);
  // The API only serves JSON: nothing may be framed, scripted or sniffed.
  // HSTS is sent where TLS is guaranteed (staging/production), docs/adr/0024.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: strict
          ? { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] }
          : {
              // Local Swagger UI needs its own scripts and styles.
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              frameAncestors: ["'none'"],
            },
      },
      strictTransportSecurity: strict
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: false }
        : false,
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  // Origins come from API_CORS_ORIGINS; "*" is refused at boot in
  // staging/production (packages/config production-safety.ts).
  app.enableCors({
    origin: env.API_CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  setErrorReporter(
    env.ERROR_REPORTER === 'none' ? new NoopErrorReporter() : new ConsoleErrorReporter(),
  );

  if (env.API_SWAGGER_ENABLED) {
    const config = new DocumentBuilder()
      .setTitle('UstaGO API')
      .setDescription('Hata gövdesi ve kimlik doğrulama: docs/api/README.md')
      .setVersion(env.APP_VERSION)
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
  }
}
