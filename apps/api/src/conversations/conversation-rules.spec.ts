import { looksLikeContactInfo } from '@ustago/validation';

import {
  cannotSendReason,
  customerDisplayName,
  decodeConversationCursor,
  deliveryState,
  encodeConversationCursor,
  messagePreview,
  newMessageNotice,
  nextLastReadAt,
} from './conversation-rules.js';

const PROVIDER = '0191d6a0-0000-7000-8000-000000000001';
const OTHER = '0191d6a0-0000-7000-8000-000000000002';

describe('conversation rules', () => {
  it('shows the customer as first name and last initial', () => {
    expect(customerDisplayName('Ayşe', 'Kaya')).toBe('Ayşe K.');
    expect(customerDisplayName('  Ali ', 'ışık')).toBe('Ali I.');
    expect(customerDisplayName('Ali', '')).toBe('Ali');
    expect(customerDisplayName('', 'Kaya')).toBe('K.');
  });

  it('decides whether a participant may send', () => {
    const base = {
      providerId: PROVIDER,
      requestStatus: 'QUOTED',
      jobProviderId: null,
      blockedByMe: false,
      blockedByCounterpart: false,
    };
    expect(cannotSendReason(base)).toBeNull();
    expect(cannotSendReason({ ...base, blockedByMe: true })).toBe('BLOCKED');
    expect(cannotSendReason({ ...base, blockedByCounterpart: true })).toBe('BLOCKED');
    for (const status of ['CANCELLED', 'EXPIRED', 'COMPLETED']) {
      expect(cannotSendReason({ ...base, requestStatus: status })).toBe('CLOSED');
    }
    // The job went to another provider.
    expect(cannotSendReason({ ...base, requestStatus: 'MATCHED', jobProviderId: OTHER })).toBe(
      'CLOSED',
    );
    // This provider's job keeps the chat open, even once the request is completed.
    expect(
      cannotSendReason({ ...base, requestStatus: 'COMPLETED', jobProviderId: PROVIDER }),
    ).toBeNull();
    // A block wins over everything.
    expect(cannotSendReason({ ...base, jobProviderId: PROVIDER, blockedByCounterpart: true })).toBe(
      'BLOCKED',
    );
  });

  it('derives READ from the reader marker and never moves the marker back', () => {
    const t = new Date('2026-10-01T10:00:00.000Z');
    const later = new Date('2026-10-01T10:05:00.000Z');
    expect(deliveryState(t, null)).toBe('SENT');
    expect(deliveryState(t, t)).toBe('READ');
    expect(deliveryState(later, t)).toBe('SENT');
    expect(nextLastReadAt(null, t)).toBe(t);
    expect(nextLastReadAt(later, t)).toBe(later);
    expect(nextLastReadAt(t, later)).toBe(later);
  });

  it('previews messages without leaking into pushes', () => {
    expect(messagePreview('IMAGE', null, false)).toBe('Fotoğraf');
    expect(messagePreview('TEXT', 'merhaba\n  usta', false)).toBe('merhaba usta');
    expect(messagePreview('TEXT', 'x'.repeat(300), false)).toHaveLength(120);
    expect(messagePreview('TEXT', 'gizli', true)).toBe('Mesaj silindi');
    const notice = newMessageNotice('Ayşe K.', 'TEXT');
    expect(notice).toEqual({ title: 'Yeni mesaj', body: 'Ayşe K.: yeni bir mesaj gönderdi' });
    expect(newMessageNotice('Usta', 'IMAGE').body).toBe('Usta: fotoğraf gönderdi');
  });

  it('round-trips the conversation cursor and refuses garbage', () => {
    const at = new Date('2026-10-01T10:00:00.123Z');
    const cursor = encodeConversationCursor(at, PROVIDER);
    expect(decodeConversationCursor(cursor)).toEqual({ at, id: PROVIDER });
    expect(decodeConversationCursor('nonsense')).toBeNull();
    expect(decodeConversationCursor(`2026-13-45_${PROVIDER}`)).toBeNull();
    expect(decodeConversationCursor(`${at.toISOString()}_not-a-uuid`)).toBeNull();
  });

  it('flags contact info without changing the text', () => {
    expect(looksLikeContactInfo('Beni 0532 123 45 67 den ara')).toBe(true);
    expect(looksLikeContactInfo('mail: ayse@example.com')).toBe(true);
    expect(looksLikeContactInfo('Yarın 14:00 uygun mu?')).toBe(false);
  });
});
