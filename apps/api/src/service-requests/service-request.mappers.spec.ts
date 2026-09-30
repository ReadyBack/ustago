import { opportunitySchema } from '@ustago/validation';
import { describe, expect, it } from 'vitest';

import { toOpportunity, toServiceRequest } from './service-request.mappers.js';

const now = new Date('2026-09-30T10:00:00Z');
const base = {
  id: '0192f4c1-0000-7000-8000-000000000001',
  customerId: '0192f4c1-0000-7000-8000-000000000002',
  categoryId: '0192f4c1-0000-7000-8000-000000000003',
  addressId: '0192f4c1-0000-7000-8000-000000000004',
  provinceId: 1,
  districtId: '0192f4c1-0000-7000-8000-000000000005',
  type: 'QUOTE' as const,
  status: 'PUBLISHED' as const,
  title: 'Klima montajı',
  description: 'Salon için split klima montajı.',
  budgetMinor: 150000n,
  budgetMaxMinor: null,
  scheduleOption: null,
  answers: null,
  approxLatitude: null,
  approxLongitude: null,
  preferredProviderId: null,
  preferredOnly: false,
  rehireOfJobId: null,
  dispatchWave: 0,
  lastDispatchedAt: null,
  nextDispatchAt: null,
  noOfferAlertedAt: null,
  currency: 'TRY' as const,
  preferredStartAt: null,
  preferredEndAt: null,
  publishedAt: now,
  expiresAt: new Date('2026-10-14T10:00:00Z'),
  cancelledAt: null,
  cancelReason: null,
  idempotencyKey: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
  category: {
    id: '0192f4c1-0000-7000-8000-000000000003',
    slug: 'klima',
    name: 'Klima',
    icon: null,
  },
  province: { id: 1, name: 'Adana' },
  district: { id: '0192f4c1-0000-7000-8000-000000000005', name: 'Seyhan' },
  photos: [],
};

const privateAddress = {
  id: base.addressId,
  userId: 'user',
  label: 'Ev',
  provinceId: 1,
  districtId: base.districtId,
  neighborhood: 'Reşatbey Mah.',
  addressLine: 'Atatürk Cd. No: 12',
  buildingNo: '12',
  apartmentNo: '7',
  postalCode: '01120',
  instructions: 'Kapı kodu 4321',
  latitude: null,
  longitude: null,
  isDefault: true,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  province: { id: 1, name: 'Adana' },
  district: { id: base.districtId, name: 'Seyhan' },
};

describe('request privacy mappers', () => {
  it('shows providers only district and province, never the street, door or directions', () => {
    // Even when the row happens to carry address and customer data, the
    // opportunity view is built from an allow-list.
    const row = {
      ...base,
      address: privateAddress,
      customer: { userId: 'u', phone: '+905321234567' },
    };
    const view = toOpportunity(row, null);
    const json = JSON.stringify(view);
    for (const secret of ['Atatürk', 'Kapı kodu', '01120', 'Reşatbey', '+90532', '"7"']) {
      expect(json).not.toContain(secret);
    }
    expect(view.location).toEqual({
      province: { id: 1, name: 'Adana' },
      district: { id: base.districtId, name: 'Seyhan' },
    });
    expect(Object.keys(view).sort()).toEqual(Object.keys(opportunitySchema.shape).sort());
  });

  it('keeps the customer budget as money, not a ceiling', () => {
    expect(toOpportunity({ ...base }, null).budget).toEqual({
      amountMinor: 150000,
      currency: 'TRY',
    });
    expect(toOpportunity({ ...base, budgetMinor: null }, null).budget).toBeNull();
  });

  it('gives the customer the full address and correct actions', () => {
    const view = toServiceRequest({
      ...base,
      address: privateAddress,
      job: null,
      quotes: [{ status: 'PENDING_CUSTOMER' }],
    });
    expect(view.address.apartmentNo).toBe('7');
    expect(view.openQuoteCount).toBe(1);
    expect(view.actions).toEqual({
      edit: true,
      editCriticalFields: false,
      publish: false,
      cancel: true,
    });
  });
});
