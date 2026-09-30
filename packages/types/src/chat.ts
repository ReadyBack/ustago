import type { CategoryRef } from './marketplace.js';

/** Faz 7 request/job-bound messaging (docs/adr/0030). */

export type MessageType = 'TEXT' | 'IMAGE' | 'SYSTEM';
export type ConversationRole = 'CUSTOMER' | 'PROVIDER';

/** SENT is stored; READ is derived from the other side's read marker. */
export type MessageDeliveryState = 'SENT' | 'READ';

export interface ChatMessage {
  id: string;
  conversationId: string;
  type: MessageType;
  /** Null for SYSTEM messages. */
  senderRole: ConversationRole | null;
  mine: boolean;
  body: string | null;
  /** IMAGE: fetch a short-lived URL from the image-url endpoint. */
  hasImage: boolean;
  clientMessageId: string | null;
  /** Looks like a phone number or e-mail: the app shows a gentle reminder. */
  containsContactInfo: boolean;
  state: MessageDeliveryState;
  createdAt: string;
  deletedAt: string | null;
}

export interface ConversationCounterpart {
  role: ConversationRole;
  /** Provider display name, or the customer's first name and last initial. */
  name: string;
  providerId: string | null;
}

export interface ConversationListItem {
  id: string;
  serviceRequestId: string;
  jobId: string | null;
  title: string;
  category: CategoryRef;
  counterpart: ConversationCounterpart;
  lastMessage: { type: MessageType; preview: string; createdAt: string; mine: boolean } | null;
  unreadCount: number;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationListItem {
  myRole: ConversationRole;
  /** False when either side blocked the other or the request closed without a job. */
  canSend: boolean;
  cannotSendReason: 'BLOCKED' | 'CLOSED' | null;
  blockedByMe: boolean;
  /** Messages the counterpart has read up to (for "Okundu"). */
  counterpartLastReadAt: string | null;
}

export interface MessagePage {
  /** Oldest first. */
  items: ChatMessage[];
  /** More older messages exist (pass `before` = first item's id). */
  hasMoreBefore: boolean;
}

export type MessageReportReason =
  'SPAM' | 'HARASSMENT' | 'FRAUD' | 'CONTACT_INFO' | 'INAPPROPRIATE' | 'OTHER';
export type MessageReportStatus = 'OPEN' | 'REVIEWED' | 'DISMISSED';

/** Admin list row: no message body until support opens it with a reason. */
export interface AdminMessageReport {
  id: string;
  messageId: string;
  conversationId: string;
  reason: MessageReportReason;
  note: string | null;
  status: MessageReportStatus;
  reporterRole: ConversationRole;
  createdAt: string;
  reviewedAt: string | null;
}

/** Returned once support opened the conversation (audited). */
export interface AdminReportedConversation {
  report: AdminMessageReport;
  messages: (ChatMessage & { senderName: string | null })[];
}

/** GET /me/badges */
export interface BadgeCounts {
  notifications: number;
  messages: number;
}
