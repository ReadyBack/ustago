import { Logger } from '@nestjs/common';
import { maskPhone } from '@ustago/validation';

import { otpMessage, type SmsProvider } from './sms-provider.js';

/**
 * Development only: writes the message to the API log instead of sending
 * it. The env schema refuses this adapter when NODE_ENV=production, and the
 * constructor double-checks.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  private readonly logger = new Logger('ConsoleSms');

  constructor(nodeEnv: string) {
    if (nodeEnv === 'production') {
      throw new Error('ConsoleSmsProvider must not be used in production.');
    }
  }

  sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void> {
    // The bare code comes first so it is easy to spot in a busy terminal.
    this.logger.warn(
      `[DEV SMS → ${maskPhone(phone)}] OTP KODU: ${code}  (${otpMessage(code, ttlSeconds)})`,
    );
    return Promise.resolve();
  }
}
