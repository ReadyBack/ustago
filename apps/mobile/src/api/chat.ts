import type {
  BadgeCounts,
  ChatMessage,
  ConversationDetail,
  ConversationListItem,
  MessagePage,
  MessageReportReason,
  Paginated,
  SignedUrl,
  UploadIntentResponse,
} from '@ustago/types';
import type { SendMessage } from '@ustago/validation';

import { api } from './session';

/**
 * Faz 7 request/job-bound messaging (docs/faz7/API-CONTRACT.md "Mesajlaşma").
 * There is no socket: screens poll while they are on screen.
 */

const qs = (params: Record<string, string | number | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
};

export const chatApi = {
  /** Open (or get) the conversation of a quote or a job. */
  open: (body: { quoteId: string } | { jobId: string }) =>
    api.post<ConversationDetail>('/conversations', body),
  list: (cursor?: string) =>
    api.get<Paginated<ConversationListItem>>(`/conversations${qs({ limit: 20, cursor })}`),
  get: (id: string) => api.get<ConversationDetail>(`/conversations/${id}`),
  messages: (id: string, query: { before?: string; after?: string; limit?: number } = {}) =>
    api.get<MessagePage>(
      `/conversations/${id}/messages${qs({ limit: query.limit ?? 30, before: query.before, after: query.after })}`,
    ),
  /** Same clientMessageId → the server returns the stored message (idempotent retry). */
  send: (id: string, body: SendMessage) =>
    api.post<ChatMessage>(`/conversations/${id}/messages`, body),
  markRead: async (id: string, messageId: string): Promise<void> => {
    await api.post<unknown>(`/conversations/${id}/read`, { messageId });
  },
  imageUploadIntent: (id: string, mimeType: 'image/jpeg' | 'image/png', sizeBytes: number) =>
    api.post<UploadIntentResponse>(`/conversations/${id}/images/upload-intent`, {
      mimeType,
      sizeBytes,
    }),
  imageUrl: (messageId: string) => api.get<SignedUrl>(`/messages/${messageId}/image-url`),
  report: async (
    messageId: string,
    body: { reason: MessageReportReason; note?: string },
  ): Promise<void> => {
    await api.post<unknown>(`/messages/${messageId}/report`, body);
  },
  block: (id: string) => api.put<ConversationDetail>(`/conversations/${id}/block`),
  unblock: (id: string) => api.delete<ConversationDetail>(`/conversations/${id}/block`),
  badges: () => api.get<BadgeCounts>('/me/badges'),
};
