import { otpMessage, type SmsProvider } from './sms-provider.js';

export interface FakeSmsMessage {
  phone: string;
  code: string;
  body: string;
  sentAt: Date;
}

/**
 * Test double that keeps messages in memory. Tests reach it through the
 * Nest container (`app.get(SMS_PROVIDER)`), never over HTTP, so there is no
 * endpoint that could leak a code. Refused in production like the console
 * adapter.
 */
export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  private readonly outbox: FakeSmsMessage[] = [];
  /** When set, the next sends fail (to test delivery errors). */
  failNext = 0;

  constructor(nodeEnv: string) {
    if (nodeEnv === 'production') {
      throw new Error('FakeSmsProvider must not be used in production.');
    }
  }

  sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new Error('Simulated SMS failure'));
    }
    this.outbox.push({ phone, code, body: otpMessage(code, ttlSeconds), sentAt: new Date() });
    return Promise.resolve();
  }

  /** Latest code sent to a number, for tests. */
  lastCodeFor(phone: string): string | undefined {
    return this.outbox.findLast((m) => m.phone === phone)?.code;
  }

  messagesFor(phone: string): readonly FakeSmsMessage[] {
    return this.outbox.filter((m) => m.phone === phone);
  }
}
