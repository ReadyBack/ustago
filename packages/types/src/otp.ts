import type { AuthTokens, CurrentUser } from './auth.js';

/** Why a one-time code is sent (docs/adr/0009). */
export type OtpPurpose = 'REGISTER_OR_LOGIN' | 'VERIFY_PHONE';

/** Returned by POST /auth/otp/request. Never contains the code. */
export interface OtpRequestResponse {
  /** E.164 number the code was sent to. */
  phone: string;
  purpose: OtpPurpose;
  codeLength: number;
  expiresAt: string;
  /** Earliest time a new code can be requested for this number. */
  resendAvailableAt: string;
}

/**
 * Returned by POST /auth/otp/verify. REGISTER_OR_LOGIN signs in and carries
 * tokens; VERIFY_PHONE only updates the signed-in user and `tokens` is null.
 */
export interface OtpVerifyResponse {
  user: CurrentUser;
  tokens: AuthTokens | null;
  /** True when this verification created the account. */
  isNewUser: boolean;
}
