import type { ProviderStatus } from '../../generated/prisma/client.js';
import {
  canBeAvailableNow,
  canEdit,
  type ProviderEvent,
  transitionFor,
} from './provider-lifecycle.js';

const ALL: ProviderStatus[] = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED'];

describe('transitionFor', () => {
  it.each([
    ['DRAFT', 'SUBMIT', 'PENDING_REVIEW'],
    ['PENDING_REVIEW', 'APPROVE', 'ACTIVE'],
    ['PENDING_REVIEW', 'REJECT', 'REJECTED'],
    ['REJECTED', 'REAPPLY', 'DRAFT'],
    ['ACTIVE', 'SUSPEND', 'SUSPENDED'],
    ['SUSPENDED', 'REINSTATE', 'ACTIVE'],
  ] as const)('%s --%s--> %s', (from, event, to) => {
    expect(transitionFor(from, event)).toBe(to);
  });

  it('allows exactly the six documented transitions', () => {
    const events: ProviderEvent[] = [
      'SUBMIT',
      'APPROVE',
      'REJECT',
      'REAPPLY',
      'SUSPEND',
      'REINSTATE',
    ];
    const allowed = ALL.flatMap((from) =>
      events.filter((e) => transitionFor(from, e) !== null).map((e) => `${from}:${e}`),
    );
    expect(allowed.sort()).toEqual(
      [
        'ACTIVE:SUSPEND',
        'DRAFT:SUBMIT',
        'PENDING_REVIEW:APPROVE',
        'PENDING_REVIEW:REJECT',
        'REJECTED:REAPPLY',
        'SUSPENDED:REINSTATE',
      ].sort(),
    );
  });

  it.each([
    ['DRAFT', 'APPROVE'],
    ['REJECTED', 'APPROVE'],
    ['ACTIVE', 'SUBMIT'],
    ['PENDING_REVIEW', 'SUBMIT'],
    ['ACTIVE', 'REJECT'],
    ['DRAFT', 'REAPPLY'],
  ] as const)('refuses %s --%s-->', (from, event) => {
    expect(transitionFor(from, event)).toBeNull();
  });
});

describe('canEdit', () => {
  it('freezes the application while it is reviewed', () => {
    expect(canEdit('PENDING_REVIEW', 'PROFILE')).toBe(false);
    expect(canEdit('PENDING_REVIEW', 'SERVICES')).toBe(false);
    expect(canEdit('PENDING_REVIEW', 'VERIFICATIONS')).toBe(false);
  });

  it('lets draft, rejected and active providers edit', () => {
    for (const status of ['DRAFT', 'REJECTED', 'ACTIVE'] as const) {
      expect(canEdit(status, 'SERVICE_AREAS')).toBe(true);
    }
  });

  it('locks a suspended provider', () => {
    expect(canEdit('SUSPENDED', 'NOW_PREFERENCE')).toBe(false);
  });
});

describe('canBeAvailableNow', () => {
  it('is true only for ACTIVE providers', () => {
    expect(ALL.filter(canBeAvailableNow)).toEqual(['ACTIVE']);
  });
});
