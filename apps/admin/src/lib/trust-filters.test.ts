import { describe, expect, it } from 'vitest';

import {
  auditFiltersToApiQuery,
  auditFiltersToQuery,
  filterQuery,
  isOpenCase,
  istanbulLocalToIso,
  parseAlertFilters,
  parseAuditFilters,
  parsePercentToBps,
  parsePreviewBps,
  parseProvider360Tab,
  parseRiskFilters,
  parseVerificationCaseQuery,
  verificationCaseQueryString,
} from './trust-filters';

const UUID = '0190a000-0000-7000-8000-00000000000a';

describe('verification case query', () => {
  it('defaults to the SUBMITTED queue and drops unknown values', () => {
    expect(parseVerificationCaseQuery({})).toEqual({ status: 'SUBMITTED', cursor: undefined });
    expect(parseVerificationCaseQuery({ status: 'NOT_STARTED', cursor: 'x' })).toEqual({
      status: 'SUBMITTED',
      cursor: undefined,
    });
    expect(parseVerificationCaseQuery({ status: 'UNDER_REVIEW', cursor: UUID })).toEqual({
      status: 'UNDER_REVIEW',
      cursor: UUID,
    });
  });

  it('builds page and API query strings', () => {
    const q = { status: 'REJECTED' as const, cursor: UUID };
    expect(verificationCaseQueryString(q)).toBe(`status=REJECTED&cursor=${UUID}`);
    expect(verificationCaseQueryString(q, { cursor: null, api: true })).toBe(
      'status=REJECTED&limit=25',
    );
  });

  it('knows which cases still wait for a decision', () => {
    expect(isOpenCase('SUBMITTED')).toBe(true);
    expect(isOpenCase('UNDER_REVIEW')).toBe(true);
    expect(isOpenCase('VERIFIED')).toBe(false);
  });
});

describe('provider 360 tab', () => {
  it('reads a known tab and falls back to Genel', () => {
    expect(parseProvider360Tab({ tab: 'sanctions' })).toBe('sanctions');
    expect(parseProvider360Tab({ tab: 'nope' })).toBe('overview');
    expect(parseProvider360Tab({ tab: ['jobs', 'audit'] })).toBe('overview');
    expect(parseProvider360Tab({})).toBe('overview');
  });
});

describe('audit filters', () => {
  it('keeps valid values and drops the rest', () => {
    expect(
      parseAuditFilters({
        entityType: 'provider_profile',
        entityId: UUID,
        actorId: 'not-a-uuid',
        action: 'fee_policy.',
        from: '2026-09-01',
        to: '31.09.2026',
        cursor: UUID,
      }),
    ).toEqual({
      entityType: 'provider_profile',
      entityId: UUID,
      actorId: undefined,
      action: 'fee_policy.',
      from: '2026-09-01',
      to: undefined,
      cursor: UUID,
    });
    expect(parseAuditFilters({ action: 'DROP TABLE' }).action).toBeUndefined();
    expect(parseAuditFilters({ entityId: '../x' }).entityId).toBeUndefined();
  });

  it('drops a reversed date range instead of sending it', () => {
    const f = parseAuditFilters({ from: '2026-09-30', to: '2026-09-01' });
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
  });

  it('sends Istanbul day bounds to the API, with "to" covering the whole day', () => {
    const api = new URLSearchParams(
      auditFiltersToApiQuery({ action: 'provider.', from: '2026-09-01', to: '2026-09-30' }),
    );
    expect(api.get('from')).toBe('2026-08-31T21:00:00.000Z');
    expect(api.get('to')).toBe('2026-09-30T20:59:59.999Z');
    expect(api.get('action')).toBe('provider.');
    expect(api.get('limit')).toBe('50');
    expect(auditFiltersToQuery({ from: '2026-09-01', cursor: UUID })).toBe('from=2026-09-01');
    expect(auditFiltersToQuery({ entityId: 'a' }, { cursor: UUID })).toBe(
      `entityId=a&cursor=${UUID}`,
    );
  });
});

describe('alert and risk filters', () => {
  it('default to the active / open lists', () => {
    expect(parseAlertFilters({})).toEqual({
      status: 'ACTIVE',
      severity: undefined,
      cursor: undefined,
    });
    expect(parseAlertFilters({ status: 'RESOLVED', severity: 'CRITICAL' })).toMatchObject({
      status: 'RESOLVED',
      severity: 'CRITICAL',
    });
    expect(parseAlertFilters({ status: 'DELETED' }).status).toBe('ACTIVE');
    expect(parseRiskFilters({ status: 'DISMISSED', type: 'OTP_ABUSE' })).toMatchObject({
      status: 'DISMISSED',
      type: 'OTP_ABUSE',
    });
    expect(parseRiskFilters({ type: 'HACKER' })).toMatchObject({ status: 'OPEN', type: undefined });
  });

  it('builds list query strings', () => {
    expect(filterQuery({ status: 'OPEN', type: undefined, cursor: UUID })).toBe(
      `status=OPEN&cursor=${UUID}`,
    );
    expect(filterQuery({ status: 'OPEN', cursor: UUID }, { cursor: null, api: true })).toBe(
      'status=OPEN&limit=25',
    );
  });
});

describe('fee policy inputs', () => {
  it('reads a percentage as basis points', () => {
    expect(parsePercentToBps('10')).toBe(1000);
    expect(parsePercentToBps('12,5')).toBe(1250);
    expect(parsePercentToBps('%7.25')).toBe(725);
    expect(parsePercentToBps('0')).toBe(0);
    expect(parsePercentToBps('50')).toBe(5000);
  });

  it('refuses malformed or too high rates', () => {
    for (const bad of ['', 'abc', '-5', '50,01', '99', '1,234', '10%%']) {
      expect(parsePercentToBps(bad)).toBeNull();
    }
  });

  it('reads the preview rate from ?bps= or ?rate=', () => {
    expect(parsePreviewBps({ bps: '1250' })).toBe(1250);
    expect(parsePreviewBps({ rate: '12,5' })).toBe(1250);
    expect(parsePreviewBps({ bps: '9000' })).toBeNull();
    expect(parsePreviewBps({})).toBeNull();
  });

  it('reads a datetime-local value as Istanbul time', () => {
    expect(istanbulLocalToIso('2026-10-01T00:00')).toBe('2026-09-30T21:00:00.000Z');
    expect(istanbulLocalToIso('2026-10-01T14:30')).toBe('2026-10-01T11:30:00.000Z');
    expect(istanbulLocalToIso('2026-02-31T10:00')).toBeNull();
    expect(istanbulLocalToIso('2026-10-01T24:00')).toBeNull();
    expect(istanbulLocalToIso('01.10.2026 10:00')).toBeNull();
    expect(istanbulLocalToIso('')).toBeNull();
  });
});
