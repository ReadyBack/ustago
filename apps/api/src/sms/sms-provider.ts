/**
 * Port for sending SMS (docs/adr/0009). The auth domain only knows this
 * interface; a Netgsm / İleti Merkezi / Twilio adapter implements it later
 * without touching OTP logic.
 */
export interface SmsProvider {
  /** Adapter name for logs and metrics ("console", "fake", "netgsm"...). */
  readonly name: string;
  /** Sends a one-time code. Throws SmsDeliveryError when it cannot. */
  sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export class SmsDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SmsDeliveryError';
  }
}

/** Turkish SMS body. Kept short: one SMS segment, no links. */
export function otpMessage(code: string, ttlSeconds: number): string {
  const minutes = Math.max(1, Math.round(ttlSeconds / 60));
  return `UstaGO doğrulama kodunuz: ${code}. Kod ${minutes} dakika geçerlidir. Kodu kimseyle paylaşmayın.`;
}
