import {
  blocksNow,
  isInForce,
  MAX_PENALTY_POINTS,
  penaltyPoints,
  type PenaltyWindow,
  severityOf,
} from './penalty-policy.js';

const NOW = new Date('2026-10-01T12:00:00Z');
const p = (over: Partial<PenaltyWindow> = {}): PenaltyWindow => ({
  type: 'WARNING',
  status: 'ACTIVE',
  startsAt: new Date('2026-09-01T00:00:00Z'),
  endsAt: null,
  ...over,
});

describe('penalty policy', () => {
  it('maps types to severities', () => {
    expect(severityOf('WARNING')).toBe('WARNING');
    expect(severityOf('VISIBILITY_REDUCTION')).toBe('MINOR');
    expect(severityOf('NOW_SUSPENSION')).toBe('MAJOR');
    expect(severityOf('JOB_RESTRICTION')).toBe('MAJOR');
    expect(severityOf('PERMANENT_BAN')).toBe('CRITICAL');
  });

  it('applies a sanction only inside its window and while active or under appeal', () => {
    expect(isInForce(p(), NOW)).toBe(true);
    expect(isInForce(p({ status: 'UNDER_APPEAL' }), NOW)).toBe(true);
    expect(isInForce(p({ status: 'REVOKED' }), NOW)).toBe(false);
    expect(isInForce(p({ status: 'EXPIRED' }), NOW)).toBe(false);
    expect(isInForce(p({ endsAt: new Date('2026-09-30T00:00:00Z') }), NOW)).toBe(false);
    expect(isInForce(p({ startsAt: new Date('2026-10-02T00:00:00Z') }), NOW)).toBe(false);
  });

  it('caps the points so stacked sanctions cannot zero a score on their own', () => {
    expect(penaltyPoints([p()], NOW)).toBe(2);
    const many = Array.from({ length: 5 }, () => p({ type: 'JOB_RESTRICTION' }));
    expect(penaltyPoints(many, NOW)).toBe(MAX_PENALTY_POINTS);
  });

  it('withholds NOW jobs only under an active NOW suspension', () => {
    expect(blocksNow([p({ type: 'NOW_SUSPENSION' })], NOW)).toBe(true);
    expect(blocksNow([p({ type: 'NOW_SUSPENSION', status: 'REVOKED' })], NOW)).toBe(false);
    expect(blocksNow([p({ type: 'VISIBILITY_REDUCTION' })], NOW)).toBe(false);
  });
});
