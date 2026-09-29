import { Global, Module } from '@nestjs/common';

import { API_ENV, type ApiEnv } from '../config/env.js';
import { ConsoleSmsProvider } from './console-sms.provider.js';
import { DisabledSmsProvider } from './disabled-sms.provider.js';
import { FakeSmsProvider } from './fake-sms.provider.js';
import { SMS_PROVIDER, type SmsProvider } from './sms-provider.js';

export function createSmsProvider(env: ApiEnv): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case 'console':
      return new ConsoleSmsProvider(env.NODE_ENV);
    case 'fake':
      return new FakeSmsProvider(env.NODE_ENV);
    case 'disabled':
      return new DisabledSmsProvider();
  }
}

@Global()
@Module({
  providers: [{ provide: SMS_PROVIDER, inject: [API_ENV], useFactory: createSmsProvider }],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
