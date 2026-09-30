import { describe, expect, it } from 'vitest';

import {
  istanbulDayStart,
  jobFiltersToApiQuery,
  jobFiltersToQuery,
  parseJobFilters,
} from './job-filters';

const UUID = '0190a000-0000-7000-8000-00000000000a';

describe('job filters', () => {
  it('keeps valid values and drops the rest', () => {
    expect(
      parseJobFilters({
        status: 'DISPUTED',
        provinceId: '1',
        categoryId: 'nope',
        providerId: UUID,
        from: '2026-09-01',
        to: '31.09.2026',
        cursor: ['a', 'b'],
      }),
    ).toEqual({
      status: 'DISPUTED',
      provinceId: 1,
      categoryId: undefined,
      providerId: UUID,
      customerId: undefined,
      from: '2026-09-01',
      to: undefined,
      cursor: undefined,
    });
    expect(parseJobFilters({ status: 'PAID' }).status).toBeUndefined();
  });

  it('turns Istanbul days into instants, with "to" covering the whole day', () => {
    expect(istanbulDayStart('2026-09-30')).toBe('2026-09-29T21:00:00.000Z');
    const api = new URLSearchParams(
      jobFiltersToApiQuery({
        status: 'COMPLETED',
        from: '2026-09-01',
        to: '2026-09-30',
        cursor: UUID,
      }),
    );
    expect(api.get('from')).toBe('2026-08-31T21:00:00.000Z');
    expect(api.get('to')).toBe('2026-09-30T21:00:00.000Z');
    expect(api.get('cursor')).toBe(UUID);
    expect(api.get('limit')).toBe('25');
    expect(jobFiltersToQuery({ from: '2026-09-01', provinceId: 1 })).toBe(
      'from=2026-09-01&provinceId=1',
    );
  });
});
