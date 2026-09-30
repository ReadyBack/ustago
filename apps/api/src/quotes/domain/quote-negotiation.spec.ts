import { describe, expect, it } from 'vitest';

import type { QuoteStatus } from '../../generated/prisma/client.js';
import {
  ACTION_PARTY,
  allowedActions,
  authorOf,
  quoteSourceStatuses,
  quoteTransition,
  type QuoteAction,
  turnOf,
} from './quote-negotiation.js';

const ALL: QuoteStatus[] = [
  'PENDING_CUSTOMER',
  'PENDING_PROVIDER',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
];

describe('quote negotiation', () => {
  it('plays the 2.500 → 2.000 → 2.200 → accept scenario', () => {
    let status: QuoteStatus = 'PENDING_CUSTOMER'; // provider offered 2.500
    status = quoteTransition(status, 'CUSTOMER_COUNTER') ?? status; // customer 2.000
    expect(status).toBe('PENDING_PROVIDER');
    status = quoteTransition(status, 'PROVIDER_COUNTER') ?? status; // provider 2.200
    expect(status).toBe('PENDING_CUSTOMER');
    expect(quoteTransition(status, 'CUSTOMER_ACCEPT')).toBe('ACCEPTED');
  });

  it('never lets the same side move twice in a row', () => {
    expect(quoteTransition('PENDING_CUSTOMER', 'PROVIDER_COUNTER')).toBeNull();
    expect(quoteTransition('PENDING_PROVIDER', 'CUSTOMER_COUNTER')).toBeNull();
    // Nor accept its own price.
    expect(quoteTransition('PENDING_CUSTOMER', 'PROVIDER_ACCEPT')).toBeNull();
    expect(quoteTransition('PENDING_PROVIDER', 'CUSTOMER_ACCEPT')).toBeNull();
  });

  it('closed threads accept no action', () => {
    const actions = Object.keys(ACTION_PARTY) as QuoteAction[];
    for (const status of ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] as const) {
      for (const action of actions) expect(quoteTransition(status, action)).toBeNull();
    }
  });

  it('keeps source statuses consistent with transitions', () => {
    for (const action of Object.keys(ACTION_PARTY) as QuoteAction[]) {
      for (const status of ALL) {
        expect(quoteSourceStatuses(action).includes(status)).toBe(
          quoteTransition(status, action) !== null,
        );
      }
    }
  });

  it('knows whose turn it is and who wrote a revision', () => {
    expect(turnOf('PENDING_CUSTOMER')).toBe('CUSTOMER');
    expect(turnOf('PENDING_PROVIDER')).toBe('PROVIDER');
    expect(turnOf('ACCEPTED')).toBeNull();
    expect(authorOf('OFFER')).toBe('PROVIDER');
    expect(authorOf('PROVIDER_COUNTER')).toBe('PROVIDER');
    expect(authorOf('CUSTOMER_COUNTER')).toBe('CUSTOMER');
  });
});

describe('allowed actions', () => {
  it('customer can counter, accept and reject on their turn', () => {
    expect(allowedActions('PENDING_CUSTOMER', 'CUSTOMER', 'QUOTE', true, 1, 10)).toEqual({
      counter: true,
      accept: true,
      reject: true,
      withdraw: false,
    });
  });

  it('provider waits while it is the customer turn but may withdraw', () => {
    expect(allowedActions('PENDING_CUSTOMER', 'PROVIDER', 'QUOTE', true, 1, 10)).toEqual({
      counter: false,
      accept: false,
      reject: false,
      withdraw: true,
    });
  });

  it('NOW quotes have no counter offers', () => {
    expect(allowedActions('PENDING_CUSTOMER', 'CUSTOMER', 'NOW', true, 1, 10).counter).toBe(false);
    expect(allowedActions('PENDING_CUSTOMER', 'CUSTOMER', 'NOW', true, 1, 10).accept).toBe(true);
  });

  it('stops counters at the revision limit and everything on closed requests', () => {
    expect(allowedActions('PENDING_CUSTOMER', 'CUSTOMER', 'QUOTE', true, 10, 10).counter).toBe(
      false,
    );
    expect(allowedActions('PENDING_CUSTOMER', 'CUSTOMER', 'QUOTE', false, 1, 10)).toEqual({
      counter: false,
      accept: false,
      reject: false,
      withdraw: false,
    });
  });
});
