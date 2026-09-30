import type { ProviderVerificationStatus } from '../../generated/prisma/client.js';
import {
  canEditDocuments,
  type VerificationEvent,
  verificationSources,
  verificationTransition,
} from './verification-case.js';

const ALL: ProviderVerificationStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_REVISION',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
];

describe('verification case state machine (docs/adr/0023)', () => {
  it.each<[ProviderVerificationStatus, VerificationEvent, ProviderVerificationStatus]>([
    ['NOT_STARTED', 'UPLOAD', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'SUBMIT', 'SUBMITTED'],
    ['NEEDS_REVISION', 'SUBMIT', 'SUBMITTED'],
    ['SUBMITTED', 'START_REVIEW', 'UNDER_REVIEW'],
    ['UNDER_REVIEW', 'APPROVE', 'VERIFIED'],
    ['UNDER_REVIEW', 'REQUEST_REVISION', 'NEEDS_REVISION'],
    ['UNDER_REVIEW', 'REJECT', 'REJECTED'],
    ['REJECTED', 'RESTART', 'IN_PROGRESS'],
    ['VERIFIED', 'SUSPEND', 'SUSPENDED'],
    ['SUSPENDED', 'REINSTATE', 'VERIFIED'],
  ])('%s --%s--> %s', (from, event, to) => {
    expect(verificationTransition(from, event)).toBe(to);
  });

  it('never approves, rejects or revises without a review in progress', () => {
    for (const event of ['APPROVE', 'REJECT', 'REQUEST_REVISION'] as const) {
      for (const from of ALL.filter((s) => s !== 'UNDER_REVIEW')) {
        expect(verificationTransition(from, event)).toBeNull();
      }
      expect(verificationSources(event)).toEqual(['UNDER_REVIEW']);
    }
  });

  it('cannot jump from NOT_STARTED straight to VERIFIED by any single event', () => {
    const events: VerificationEvent[] = [
      'UPLOAD',
      'SUBMIT',
      'START_REVIEW',
      'APPROVE',
      'REQUEST_REVISION',
      'REJECT',
      'RESTART',
      'SUSPEND',
      'REINSTATE',
    ];
    for (const e of events) expect(verificationTransition('NOT_STARTED', e)).not.toBe('VERIFIED');
  });

  it('locks documents while the case is submitted, under review or suspended', () => {
    expect(canEditDocuments('SUBMITTED')).toBe(false);
    expect(canEditDocuments('UNDER_REVIEW')).toBe(false);
    expect(canEditDocuments('SUSPENDED')).toBe(false);
    expect(canEditDocuments('NEEDS_REVISION')).toBe(true);
    expect(canEditDocuments('NOT_STARTED')).toBe(true);
  });
});
