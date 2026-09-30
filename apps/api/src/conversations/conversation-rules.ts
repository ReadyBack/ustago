import type { ChatMessage, ConversationRole, MessageType } from '@ustago/types';

/**
 * Pure rules of the request/job-bound chat (Faz 7). No I/O here, so the
 * service and the unit tests share exactly the same decisions.
 */

/** How the provider sees a customer: first name and last initial ("Ayşe K."). */
export function customerDisplayName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const initial = lastName.trim().charAt(0).toLocaleUpperCase('tr-TR');
  if (!first) return initial ? `${initial}.` : 'Müşteri';
  return initial ? `${first} ${initial}.` : first;
}

export type CannotSendReason = 'BLOCKED' | 'CLOSED';

export interface SendabilityInput {
  providerId: string;
  requestStatus: string;
  /** The request's job, if one exists (at most one per request). */
  jobProviderId: string | null;
  blockedByMe: boolean;
  blockedByCounterpart: boolean;
}

const CLOSED_REQUEST_STATUSES: ReadonlySet<string> = new Set(['CANCELLED', 'EXPIRED', 'COMPLETED']);

/**
 * A conversation is read-only when either side blocked the other, when the
 * request's job went to another provider, or when the request ended
 * (cancelled/expired/closed) without a job for this provider. The history
 * stays readable in every case.
 */
export function cannotSendReason(input: SendabilityInput): CannotSendReason | null {
  if (input.blockedByMe || input.blockedByCounterpart) return 'BLOCKED';
  if (input.jobProviderId !== null) {
    return input.jobProviderId === input.providerId ? null : 'CLOSED';
  }
  return CLOSED_REQUEST_STATUSES.has(input.requestStatus) ? 'CLOSED' : null;
}

/** "SENT" is stored; "READ" means the other side's read marker passed it. */
export function deliveryState(
  createdAt: Date,
  readerLastReadAt: Date | null,
): ChatMessage['state'] {
  return readerLastReadAt !== null && readerLastReadAt.getTime() >= createdAt.getTime()
    ? 'READ'
    : 'SENT';
}

/** The read marker only moves forward. */
export function nextLastReadAt(current: Date | null, candidate: Date): Date {
  return current !== null && current.getTime() >= candidate.getTime() ? current : candidate;
}

const PREVIEW_LENGTH = 120;

/** List preview. Never used for pushes: they carry no message body. */
export function messagePreview(type: MessageType, body: string | null, deleted: boolean): string {
  if (deleted) return 'Mesaj silindi';
  if (type === 'IMAGE') return 'Fotoğraf';
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

/** Push/in-app text for a new message: the sender's name, never the body. */
export function newMessageNotice(
  senderName: string,
  type: 'TEXT' | 'IMAGE',
): { title: string; body: string } {
  return {
    title: 'Yeni mesaj',
    body:
      type === 'IMAGE'
        ? `${senderName}: fotoğraf gönderdi`
        : `${senderName}: yeni bir mesaj gönderdi`,
  };
}

export const counterpartRole = (role: ConversationRole): ConversationRole =>
  role === 'CUSTOMER' ? 'PROVIDER' : 'CUSTOMER';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Conversation list keyset: `<ISO activity time>_<conversation id>`. */
export function encodeConversationCursor(at: Date, id: string): string {
  return `${at.toISOString()}_${id}`;
}

export function decodeConversationCursor(cursor: string): { at: Date; id: string } | null {
  const sep = cursor.lastIndexOf('_');
  if (sep <= 0) return null;
  const at = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !UUID.test(id)) return null;
  return { at, id };
}
