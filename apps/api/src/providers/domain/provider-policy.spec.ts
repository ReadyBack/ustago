import { PAYOUT_NOT_VERIFIED_MESSAGE, payoutRefusal, providerPolicy } from './provider-policy.js';

describe('central provider policy (docs/adr/0023)', () => {
  const base = {
    applicationStatus: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    accountStatus: 'ACTIVE',
  } as const;

  it('a verified, active provider can do everything', () => {
    expect(providerPolicy(base)).toMatchObject({
      listed: true,
      canQuote: true,
      canTakeNowJobs: true,
      canRequestPayout: true,
      showVerifiedBadge: true,
      restrictions: [],
    });
  });

  it('unverified: listed and quoting, but no NOW, no payout, no badge', () => {
    const p = providerPolicy({ ...base, verificationStatus: 'SUBMITTED' });
    expect(p).toMatchObject({
      listed: true,
      canQuote: true,
      canTakeNowJobs: false,
      canRequestPayout: false,
      showVerifiedBadge: false,
    });
    expect(p.restrictions.join(' ')).toContain('doğrulaması');
  });

  it('suspended or banned: nothing, whatever the verification says', () => {
    for (const accountStatus of ['SUSPENDED', 'BANNED'] as const) {
      const p = providerPolicy({ ...base, accountStatus });
      expect(p).toMatchObject({
        listed: false,
        canQuote: false,
        canTakeNowJobs: false,
        canRequestPayout: false,
        showVerifiedBadge: false,
      });
    }
  });

  it('LIMITED keeps quoting but not NOW', () => {
    const p = providerPolicy({ ...base, accountStatus: 'LIMITED' });
    expect(p.canQuote).toBe(true);
    expect(p.canTakeNowJobs).toBe(false);
  });

  it('refuses payouts in the documented order', () => {
    expect(
      payoutRefusal({ ...base, accountStatus: 'SUSPENDED', destinationVerified: true })?.code,
    ).toBe('PROVIDER_SUSPENDED');
    expect(
      payoutRefusal({ ...base, verificationStatus: 'IN_PROGRESS', destinationVerified: true }),
    ).toEqual({ code: 'PROVIDER_NOT_VERIFIED', message: PAYOUT_NOT_VERIFIED_MESSAGE });
    expect(PAYOUT_NOT_VERIFIED_MESSAGE).toBe('Hesap doğrulamanız tamamlanmadan para çekemezsiniz.');
    expect(payoutRefusal({ ...base, destinationVerified: false })?.code).toBe(
      'PAYOUT_DESTINATION_NOT_VERIFIED',
    );
    expect(payoutRefusal({ ...base, destinationVerified: true })).toBeNull();
  });
});
