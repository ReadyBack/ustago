import {
  computeOnboarding,
  isProfileComplete,
  missingApprovals,
  missingSubmissions,
  type OnboardingSnapshot,
} from './onboarding.js';

const complete: OnboardingSnapshot = {
  status: 'DRAFT',
  statusReason: null,
  phoneVerified: true,
  displayName: 'Ahmet Usta',
  bio: '15 yıldır klima montaj ve bakım yapıyorum.',
  yearsOfExperience: 15,
  activeServiceCount: 2,
  activeAreaCount: 3,
  verifications: [{ type: 'IDENTITY', status: 'PENDING' }],
};

describe('computeOnboarding', () => {
  it('lets a complete draft submit', () => {
    const result = computeOnboarding(complete);
    expect(result.missingSteps).toEqual([]);
    expect(result.completedSteps).toBe(5);
    expect(result.totalSteps).toBe(5);
    expect(result.canSubmit).toBe(true);
  });

  it('lists every missing step', () => {
    const result = computeOnboarding({
      ...complete,
      phoneVerified: false,
      bio: null,
      activeServiceCount: 0,
      activeAreaCount: 0,
      verifications: [],
    });
    expect(result.missingSteps).toEqual([
      'PHONE_VERIFIED',
      'PROFILE',
      'SERVICES',
      'SERVICE_AREAS',
      'REQUIRED_VERIFICATIONS',
    ]);
    expect(result.completedSteps).toBe(0);
    expect(result.canSubmit).toBe(false);
  });

  it('does not count a rejected identity document', () => {
    const result = computeOnboarding({
      ...complete,
      verifications: [{ type: 'IDENTITY', status: 'REJECTED' }],
    });
    expect(result.requiredVerificationsComplete).toBe(false);
    expect(result.missingSteps).toEqual(['REQUIRED_VERIFICATIONS']);
  });

  it('only allows submitting from DRAFT', () => {
    for (const status of ['PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED'] as const) {
      expect(computeOnboarding({ ...complete, status }).canSubmit).toBe(false);
    }
  });

  it('shows the reason only while rejected or suspended', () => {
    expect(
      computeOnboarding({ ...complete, status: 'REJECTED', statusReason: 'Belge okunmuyor' })
        .statusReason,
    ).toBe('Belge okunmuyor');
    expect(computeOnboarding({ ...complete, statusReason: 'eski' }).statusReason).toBeNull();
  });
});

describe('isProfileComplete', () => {
  it('needs a name, a short bio and years of experience', () => {
    expect(isProfileComplete(complete)).toBe(true);
    expect(isProfileComplete({ ...complete, bio: 'kısa' })).toBe(false);
    expect(isProfileComplete({ ...complete, yearsOfExperience: null })).toBe(false);
    expect(isProfileComplete({ ...complete, yearsOfExperience: 0 })).toBe(true);
  });
});

describe('verification requirements', () => {
  it('distinguishes submitted from approved', () => {
    const pending = [{ type: 'IDENTITY', status: 'PENDING' }] as const;
    expect(missingSubmissions(pending)).toEqual([]);
    expect(missingApprovals(pending)).toEqual(['IDENTITY']);
    expect(missingApprovals([{ type: 'IDENTITY', status: 'APPROVED' }])).toEqual([]);
  });

  it('ignores optional document types', () => {
    expect(missingSubmissions([{ type: 'PROFESSIONAL_CERTIFICATE', status: 'APPROVED' }])).toEqual([
      'IDENTITY',
    ]);
  });
});
