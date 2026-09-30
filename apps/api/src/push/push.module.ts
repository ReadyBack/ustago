import { Global, Module } from '@nestjs/common';

import { API_ENV, type ApiEnv } from '../config/env.js';
import { ConsolePushProvider } from './console-push.provider.js';
import { DisabledPushProvider } from './disabled-push.provider.js';
import { ExpoPushProvider } from './expo-push.provider.js';
import { PUSH_PROVIDER, type PushProvider } from './push-provider.js';
import { PushWorkerService } from './push-worker.service.js';

export function createPushProvider(env: ApiEnv): PushProvider {
  switch (env.PUSH_PROVIDER) {
    case 'console':
      return new ConsolePushProvider(env.APP_ENV);
    case 'expo':
      return new ExpoPushProvider(env.EXPO_ACCESS_TOKEN);
    case 'disabled':
      return new DisabledPushProvider();
  }
}

@Global()
@Module({
  providers: [
    { provide: PUSH_PROVIDER, inject: [API_ENV], useFactory: createPushProvider },
    PushWorkerService,
  ],
  exports: [PUSH_PROVIDER, PushWorkerService],
})
export class PushModule {}
