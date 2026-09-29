import { effectiveProvinceCategory, isNowOpen } from './now-availability.js';

const open = {
  provinceActive: true,
  categoryActive: true,
  categorySupportsNow: true,
  override: null,
};

describe('isNowOpen', () => {
  it('follows the category when the province has no override', () => {
    expect(isNowOpen(open)).toBe(true);
    expect(isNowOpen({ ...open, categorySupportsNow: false })).toBe(false);
  });

  it('is closed in a province that is not open yet', () => {
    expect(isNowOpen({ ...open, provinceActive: false })).toBe(false);
  });

  it('is closed for an inactive category', () => {
    expect(isNowOpen({ ...open, categoryActive: false })).toBe(false);
  });

  it('honours the province override', () => {
    expect(isNowOpen({ ...open, override: { isActive: true, nowEnabled: false } })).toBe(false);
    expect(isNowOpen({ ...open, override: { isActive: false, nowEnabled: true } })).toBe(false);
    expect(isNowOpen({ ...open, override: { isActive: true, nowEnabled: true } })).toBe(true);
  });

  it('cannot open NOW for a category that does not support it', () => {
    expect(
      isNowOpen({
        ...open,
        categorySupportsNow: false,
        override: { isActive: true, nowEnabled: true },
      }),
    ).toBe(false);
  });
});

describe('effectiveProvinceCategory', () => {
  it('reports defaults and overrides', () => {
    expect(effectiveProvinceCategory({ isActive: true, supportsNow: true }, null)).toEqual({
      isActive: true,
      nowEnabled: true,
      source: 'DEFAULT',
    });
    expect(
      effectiveProvinceCategory(
        { isActive: true, supportsNow: false },
        { isActive: true, nowEnabled: true },
      ),
    ).toEqual({ isActive: true, nowEnabled: false, source: 'OVERRIDE' });
  });
});
