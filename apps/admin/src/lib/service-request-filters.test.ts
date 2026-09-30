import { describe, expect, it } from 'vitest';

import { filtersToQuery, parseServiceRequestFilters } from './service-request-filters';

const categoryId = '01a0f151-c874-71ba-a7e4-d7de11846f5b';

describe('service request filters', () => {
  it('keeps valid filters', () => {
    const filters = parseServiceRequestFilters({
      status: 'QUOTED',
      type: 'NOW',
      provinceId: '1',
      categoryId,
    });
    expect(filters).toEqual({ status: 'QUOTED', type: 'NOW', provinceId: 1, categoryId });
    expect(filtersToQuery(filters, { limit: '25' })).toBe(
      `status=QUOTED&type=NOW&provinceId=1&categoryId=${categoryId}&limit=25`,
    );
  });

  it('drops invalid or empty values instead of failing', () => {
    expect(
      parseServiceRequestFilters({
        status: 'BOGUS',
        type: '',
        provinceId: '82',
        categoryId: 'not-a-uuid',
        cursor: ['a', 'b'],
      }),
    ).toEqual({});
    expect(filtersToQuery({})).toBe('');
  });
});
