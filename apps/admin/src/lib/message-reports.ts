import { accessReportedConversationSchema } from '@ustago/validation';

export const ACCESS_REASON_MIN = 10;
export const ACCESS_REASON_MAX = 500;

/**
 * Opening a reported conversation needs a written reason (audited):
 * 10–500 characters after trimming, as `accessReportedConversationSchema`
 * requires. Null when fine.
 */
export function accessReasonError(reason: string): string | null {
  if (accessReportedConversationSchema.safeParse({ reason }).success) return null;
  return reason.trim().length < ACCESS_REASON_MIN
    ? `Gerekçe en az ${ACCESS_REASON_MIN} karakter olmalı.`
    : `Gerekçe en fazla ${ACCESS_REASON_MAX} karakter olabilir.`;
}
