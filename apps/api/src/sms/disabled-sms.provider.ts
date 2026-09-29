import { SmsDeliveryError, type SmsProvider } from './sms-provider.js';

/** SMS turned off (production until a real adapter is configured). */
export class DisabledSmsProvider implements SmsProvider {
  readonly name = 'disabled';

  sendOtp(): Promise<void> {
    return Promise.reject(new SmsDeliveryError('SMS sending is disabled.', false));
  }
}
