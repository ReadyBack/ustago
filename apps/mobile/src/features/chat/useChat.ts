import type { ChatMessage, ConversationDetail } from '@ustago/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { chatApi } from '../../api/chat';
import { errorMessage } from '../../api/client';
import { newIdempotencyKey } from '../../lib/id';
import { type PickedImage, uploadImage } from '../../lib/image-upload';

/** How often new messages are fetched while the chat is on screen. */
export const CHAT_POLL_MS = 5_000;
/** The conversation header (block state, read marker) is refreshed every Nth poll. */
const DETAIL_EVERY = 3;

/** A message the server has not confirmed yet ("gönderiliyor") or that failed. */
export interface PendingMessage {
  clientMessageId: string;
  type: 'TEXT' | 'IMAGE';
  body: string | null;
  image: PickedImage | null;
  /** Kept after a successful upload so a retry only resends the message. */
  uploadId: string | null;
  status: 'sending' | 'failed';
  error: string | null;
  createdAt: string;
}

/** Oldest first, one entry per id. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? -1 : 1,
  );
}

export interface ChatState {
  detail: ConversationDetail | null;
  messages: ChatMessage[];
  pending: PendingMessage[];
  hasMoreBefore: boolean;
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  reload: () => Promise<void>;
  loadOlder: () => Promise<void>;
  sendText: (body: string) => Promise<void>;
  sendImage: (image: PickedImage) => Promise<void>;
  retry: (clientMessageId: string) => Promise<void>;
  discard: (clientMessageId: string) => void;
  setDetail: (d: ConversationDetail) => void;
}

/**
 * Conversation state: first page, older pages (`before`), polling for new
 * messages (`after`) only while `active`, optimistic sending with a
 * client-generated id that a retry reuses (the server answers a repeated
 * id with the stored message, so a retry never duplicates), and marking
 * the conversation read while it is on screen.
 */
export function useChat(conversationId: string, active: boolean): ChatState {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingRef = useRef<PendingMessage[]>([]);
  const polling = useRef(false);
  const pollCount = useRef(0);
  const lastMarked = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyMessages = useCallback((incoming: ChatMessage[], replace = false) => {
    const next = replace
      ? mergeMessages([], incoming)
      : mergeMessages(messagesRef.current, incoming);
    messagesRef.current = next;
    setMessages(next);
    // A confirmed message replaces its optimistic copy.
    const confirmed = new Set(incoming.map((m) => m.clientMessageId).filter(Boolean));
    if (confirmed.size > 0 && pendingRef.current.some((p) => confirmed.has(p.clientMessageId))) {
      pendingRef.current = pendingRef.current.filter((p) => !confirmed.has(p.clientMessageId));
      setPending(pendingRef.current);
    }
  }, []);

  const updatePending = useCallback(
    (clientMessageId: string, patch: Partial<PendingMessage> | null) => {
      pendingRef.current =
        patch === null
          ? pendingRef.current.filter((p) => p.clientMessageId !== clientMessageId)
          : pendingRef.current.map((p) =>
              p.clientMessageId === clientMessageId ? { ...p, ...patch } : p,
            );
      if (mounted.current) setPending(pendingRef.current);
    },
    [],
  );

  const reload = useCallback(
    (): Promise<void> =>
      Promise.all([chatApi.get(conversationId), chatApi.messages(conversationId)]).then(
        ([d, page]) => {
          if (!mounted.current) return;
          setDetail(d);
          applyMessages(page.items, true);
          setHasMoreBefore(page.hasMoreBefore);
          setError(null);
          setLoading(false);
        },
        (e: unknown) => {
          if (!mounted.current) return;
          setError(errorMessage(e));
          setLoading(false);
        },
      ),
    [conversationId, applyMessages],
  );

  useEffect(() => {
    messagesRef.current = [];
    lastMarked.current = null;
    void reload();
  }, [reload]);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const last = messagesRef.current[messagesRef.current.length - 1];
      const withDetail = pollCount.current++ % DETAIL_EVERY === 0;
      const [page, d] = await Promise.all([
        chatApi.messages(conversationId, last ? { after: last.id } : {}),
        withDetail ? chatApi.get(conversationId) : Promise.resolve(null),
      ]);
      if (!mounted.current) return;
      applyMessages(page.items);
      if (!last) setHasMoreBefore(page.hasMoreBefore);
      if (d) setDetail(d);
    } catch {
      // Quiet: the next poll tries again; the last good messages stay on screen.
    } finally {
      polling.current = false;
    }
  }, [conversationId, applyMessages]);

  // Poll only while the chat is focused and the app is in the foreground.
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => void poll(), CHAT_POLL_MS);
    return () => clearInterval(timer);
  }, [active, poll]);

  // Mark read up to the newest message while the chat is on screen.
  const newest = messages[messages.length - 1];
  useEffect(() => {
    if (!active || !newest || lastMarked.current === newest.id) return;
    const hasIncoming = messages.some((m) => !m.mine && m.type !== 'SYSTEM');
    if (!hasIncoming) return;
    lastMarked.current = newest.id;
    chatApi.markRead(conversationId, newest.id).catch(() => {
      lastMarked.current = null;
    });
  }, [active, newest, messages, conversationId]);

  const loadOlder = useCallback(async () => {
    const first = messagesRef.current[0];
    if (!first || loadingOlder || !hasMoreBefore) return;
    setLoadingOlder(true);
    try {
      const page = await chatApi.messages(conversationId, { before: first.id });
      if (!mounted.current) return;
      applyMessages(page.items);
      setHasMoreBefore(page.hasMoreBefore);
    } catch {
      // The list keeps what it has; scrolling up again retries.
    } finally {
      if (mounted.current) setLoadingOlder(false);
    }
  }, [conversationId, applyMessages, loadingOlder, hasMoreBefore]);

  const deliver = useCallback(
    async (p: PendingMessage) => {
      updatePending(p.clientMessageId, { status: 'sending', error: null });
      try {
        let message: ChatMessage;
        if (p.type === 'TEXT') {
          message = await chatApi.send(conversationId, {
            type: 'TEXT',
            clientMessageId: p.clientMessageId,
            body: p.body ?? '',
          });
        } else {
          let uploadId = p.uploadId;
          if (!uploadId) {
            if (!p.image) throw new Error('missing image');
            uploadId = await uploadImage(p.image, (mime, size) =>
              chatApi.imageUploadIntent(conversationId, mime, size),
            );
            updatePending(p.clientMessageId, { uploadId });
          }
          message = await chatApi.send(conversationId, {
            type: 'IMAGE',
            clientMessageId: p.clientMessageId,
            uploadId,
          });
        }
        if (!mounted.current) return;
        applyMessages([message]);
        updatePending(p.clientMessageId, null);
      } catch (e) {
        updatePending(p.clientMessageId, { status: 'failed', error: errorMessage(e) });
      }
    },
    [conversationId, applyMessages, updatePending],
  );

  const enqueue = useCallback(
    (p: Omit<PendingMessage, 'clientMessageId' | 'status' | 'error' | 'createdAt'>) => {
      const item: PendingMessage = {
        ...p,
        clientMessageId: newIdempotencyKey(),
        status: 'sending',
        error: null,
        createdAt: new Date().toISOString(),
      };
      pendingRef.current = [...pendingRef.current, item];
      setPending(pendingRef.current);
      return deliver(item);
    },
    [deliver],
  );

  const sendText = useCallback(
    (body: string) => enqueue({ type: 'TEXT', body, image: null, uploadId: null }),
    [enqueue],
  );
  const sendImage = useCallback(
    (image: PickedImage) => enqueue({ type: 'IMAGE', body: null, image, uploadId: null }),
    [enqueue],
  );

  const retry = useCallback(
    async (clientMessageId: string) => {
      const p = pendingRef.current.find((x) => x.clientMessageId === clientMessageId);
      if (p && p.status === 'failed') await deliver(p);
    },
    [deliver],
  );
  const discard = useCallback(
    (clientMessageId: string) => updatePending(clientMessageId, null),
    [updatePending],
  );

  return {
    detail,
    messages,
    pending,
    hasMoreBefore,
    loading,
    loadingOlder,
    error,
    reload,
    loadOlder,
    sendText,
    sendImage,
    retry,
    discard,
    setDetail,
  };
}
