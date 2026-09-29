import { Global, Module } from '@nestjs/common';

import { API_ENV, loadApiEnv } from './env.js';

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: () => loadApiEnv() }],
  exports: [API_ENV],
})
export class ConfigModule {}
