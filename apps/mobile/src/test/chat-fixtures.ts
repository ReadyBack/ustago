import type { ChatMessage, ConversationDetail, MessagePage, Opportunity } from '@ustago/types';

export function conversationFixture(
  overrides: Partial<ConversationDetail> = {},
): ConversationDetail {
  return {
    id: 'conv-1',
    serviceRequestId: 'req-1',
    jobId: null,
    title: 'Klima gaz dolumu',
    category: { id: 'cat-1', slug: 'klima', name: 'Klima', icon: null },
    counterpart: { role: 'PROVIDER', name: 'Demo Klima Ustası', providerId: 'prov-1' },
    lastMessage: null,
    unreadCount: 0,
    updatedAt: '2026-09-30T08:00:00.000Z',
    myRole: 'CUSTOMER',
    canSend: true,
    cannotSendReason: null,
    blockedByMe: false,
    counterpartLastReadAt: null,
    ...overrides,
  };
}

export function messageFixture(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    type: 'TEXT',
    senderRole: 'PROVIDER',
    mine: false,
    body: 'Merhaba, yarın gelebilirim.',
    hasImage: false,
    clientMessageId: null,
    containsContactInfo: false,
    state: 'SENT',
    createdAt: '2026-09-30T08:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

export const page = (items: ChatMessage[], hasMoreBefore = false): MessagePage => ({
  items,
  hasMoreBefore,
});

export function opportunityFixture(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'req-1',
    type: 'QUOTE',
    status: 'PUBLISHED',
    title: 'Klima gaz dolumu',
    description: 'Salondaki klima soğutmuyor.',
    category: { id: 'cat-1', slug: 'klima', name: 'Klima', icon: null },
    location: {
      province: { id: 1, name: 'Adana' },
      district: { id: 'd-seyhan', name: 'Seyhan' },
    },
    budget: { amountMinor: 150000, currency: 'TRY' },
    preferredStartAt: null,
    preferredEndAt: null,
    publishedAt: '2026-09-30T08:00:00.000Z',
    expiresAt: null,
    photos: [],
    myQuoteId: null,
    budgetMax: { amountMinor: 200000, currency: 'TRY' },
    scheduleOption: 'TOMORROW',
    answers: [],
    photoCount: 2,
    distance: { km: 12.4, approximate: true },
    dispatch: { wave: 1, dispatchedAt: '2026-09-30T08:01:00.000Z', viewedAt: null },
    isPreferredForMe: true,
    ...overrides,
  };
}
