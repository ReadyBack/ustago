import {
  jobStatusSchema,
  otpPurposeSchema,
  providerStatusSchema,
  providerTypeSchema,
  quoteRevisionKindSchema,
  quoteStatusSchema,
  roleSchema,
  serviceRequestStatusSchema,
  serviceRequestTypeSchema,
  userStatusSchema,
  verificationStatusSchema,
  verificationTypeSchema,
} from '@ustago/validation';

import {
  JobStatus,
  OtpPurpose,
  ProviderStatus,
  ProviderType,
  QuoteRevisionKind,
  QuoteStatus,
  Role,
  ServiceRequestStatus,
  ServiceRequestType,
  UserStatus,
  VerificationStatus,
  VerificationType,
} from '../generated/prisma/client.js';

/** Shared client schemas must stay in sync with the database enums. */
describe('enum parity between Prisma and @ustago/validation', () => {
  it.each([
    ['Role', Role, roleSchema.options],
    ['UserStatus', UserStatus, userStatusSchema.options],
    ['ProviderStatus', ProviderStatus, providerStatusSchema.options],
    ['ProviderType', ProviderType, providerTypeSchema.options],
    ['OtpPurpose', OtpPurpose, otpPurposeSchema.options],
    ['VerificationType', VerificationType, verificationTypeSchema.options],
    ['VerificationStatus', VerificationStatus, verificationStatusSchema.options],
    ['ServiceRequestType', ServiceRequestType, serviceRequestTypeSchema.options],
    ['ServiceRequestStatus', ServiceRequestStatus, serviceRequestStatusSchema.options],
    ['QuoteStatus', QuoteStatus, quoteStatusSchema.options],
    ['QuoteRevisionKind', QuoteRevisionKind, quoteRevisionKindSchema.options],
    ['JobStatus', JobStatus, jobStatusSchema.options],
  ])('%s', (_name, prismaEnum, shared) => {
    expect([...shared].sort()).toEqual(Object.values(prismaEnum).sort());
  });
});
