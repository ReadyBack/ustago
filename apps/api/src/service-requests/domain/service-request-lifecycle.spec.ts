import { describe, expect, it } from 'vitest';

import type { ServiceRequestStatus } from '../../generated/prisma/client.js';
import {
  editableFields,
  forbiddenEdits,
  isOpen,
  type ServiceRequestEvent,
  sourceStatuses,
  transitionFor,
} from './service-request-lifecycle.js';

const ALL: ServiceRequestStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'MATCHING',
  'QUOTED',
  'MATCHED',
  'CANCELLED',
  'EXPIRED',
  'COMPLETED',
];

describe('service request lifecycle', () => {
  it('publishes a QUOTE request as PUBLISHED and a NOW request as MATCHING', () => {
    expect(transitionFor('DRAFT', 'PUBLISH', 'QUOTE')).toBe('PUBLISHED');
    expect(transitionFor('DRAFT', 'PUBLISH', 'NOW')).toBe('MATCHING');
  });

  it('never publishes twice', () => {
    for (const status of ALL.filter((s) => s !== 'DRAFT')) {
      expect(transitionFor(status, 'PUBLISH', 'QUOTE')).toBeNull();
    }
  });

  it('moves to QUOTED on the first quote and stays there on later ones', () => {
    expect(transitionFor('PUBLISHED', 'QUOTE_RECEIVED', 'QUOTE')).toBe('QUOTED');
    expect(transitionFor('MATCHING', 'QUOTE_RECEIVED', 'NOW')).toBe('QUOTED');
    expect(transitionFor('QUOTED', 'QUOTE_RECEIVED', 'QUOTE')).toBe('QUOTED');
    expect(transitionFor('DRAFT', 'QUOTE_RECEIVED', 'QUOTE')).toBeNull();
    expect(transitionFor('MATCHED', 'QUOTE_RECEIVED', 'QUOTE')).toBeNull();
  });

  it('goes back to waiting when the last open quote closes', () => {
    expect(transitionFor('QUOTED', 'LAST_QUOTE_CLOSED', 'QUOTE')).toBe('PUBLISHED');
    expect(transitionFor('QUOTED', 'LAST_QUOTE_CLOSED', 'NOW')).toBe('MATCHING');
  });

  it('only accepts on open requests', () => {
    for (const status of ALL) {
      expect(transitionFor(status, 'QUOTE_ACCEPTED', 'QUOTE')).toBe(
        isOpen(status) ? 'MATCHED' : null,
      );
    }
  });

  it('cannot cancel after agreement or twice', () => {
    expect(transitionFor('QUOTED', 'CANCEL', 'QUOTE')).toBe('CANCELLED');
    expect(transitionFor('DRAFT', 'CANCEL', 'QUOTE')).toBe('CANCELLED');
    for (const status of ['MATCHED', 'CANCELLED', 'EXPIRED', 'COMPLETED'] as const) {
      expect(transitionFor(status, 'CANCEL', 'QUOTE')).toBeNull();
    }
  });

  it('exposes source statuses for conditional updates', () => {
    const events: ServiceRequestEvent[] = ['PUBLISH', 'QUOTE_ACCEPTED', 'CANCEL', 'EXPIRE'];
    for (const event of events) {
      for (const status of ALL) {
        expect(sourceStatuses(event).includes(status)).toBe(
          transitionFor(status, event, 'QUOTE') !== null,
        );
      }
    }
  });
});

describe('editable fields', () => {
  it('allows everything in DRAFT', () => {
    expect(editableFields('DRAFT', false)).toContain('categoryId');
    expect(editableFields('DRAFT', false)).toContain('addressId');
  });

  it('freezes category and address once a quote exists', () => {
    expect(forbiddenEdits('PUBLISHED', false, ['categoryId'])).toEqual([]);
    expect(forbiddenEdits('QUOTED', true, ['categoryId', 'addressId', 'title'])).toEqual([
      'categoryId',
      'addressId',
    ]);
    expect(forbiddenEdits('QUOTED', true, ['description', 'budgetMinor'])).toEqual([]);
  });

  it('allows nothing after agreement or cancellation', () => {
    for (const status of ['MATCHED', 'CANCELLED', 'EXPIRED', 'COMPLETED'] as const) {
      expect(editableFields(status, false)).toEqual([]);
    }
  });
});
