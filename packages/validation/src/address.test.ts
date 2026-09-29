import { describe, expect, it } from 'vitest';

import { createAddressRequestSchema, updateAddressRequestSchema } from './address.js';

const valid = {
  provinceId: 34,
  districtId: '0199f4a0-0000-7000-8000-000000000001',
  addressLine: 'Caferağa Mah. Moda Cad. No: 10',
};

describe('createAddressRequestSchema', () => {
  it('accepts a minimal address', () => {
    expect(createAddressRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts coordinates as a pair within range', () => {
    expect(
      createAddressRequestSchema.safeParse({ ...valid, latitude: 40.98, longitude: 29.03 }).success,
    ).toBe(true);
  });

  it.each([
    ['latitude only', { latitude: 40.98 }],
    ['longitude only', { longitude: 29.03 }],
    ['latitude above 90', { latitude: 90.1, longitude: 29 }],
    ['latitude below -90', { latitude: -91, longitude: 29 }],
    ['longitude above 180', { latitude: 40, longitude: 180.5 }],
    ['longitude below -180', { latitude: 40, longitude: -181 }],
    ['bad postal code', { postalCode: '34A10' }],
    ['province out of range', { provinceId: 82 }],
    ['unknown field', { userId: '0199f4a0-0000-7000-8000-000000000002' }],
  ])('rejects %s', (_label, patch) => {
    expect(createAddressRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('updateAddressRequestSchema', () => {
  it('needs province and district together', () => {
    expect(updateAddressRequestSchema.safeParse({ provinceId: 6 }).success).toBe(false);
    expect(
      updateAddressRequestSchema.safeParse({ provinceId: 6, districtId: valid.districtId }).success,
    ).toBe(true);
  });

  it('clears coordinates only as a pair', () => {
    expect(updateAddressRequestSchema.safeParse({ latitude: null, longitude: null }).success).toBe(
      true,
    );
    expect(updateAddressRequestSchema.safeParse({ latitude: null }).success).toBe(false);
  });

  it('rejects an empty patch', () => {
    expect(updateAddressRequestSchema.safeParse({}).success).toBe(false);
  });
});
