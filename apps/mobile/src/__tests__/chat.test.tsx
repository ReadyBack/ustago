import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';

import { chatApi } from '../api/chat';
import { ApiError } from '../api/client';
import { CHAT_POLL_MS } from '../features/chat/useChat';
import { ChatScreen } from '../features/chat/ChatScreen';
import { ConversationList } from '../features/chat/ConversationList';
import { conversationFixture, messageFixture, page } from '../test/chat-fixtures';

/** Blur is simulated by running the focus effects' cleanups. */
const mockFocus: { cleanups: (() => void)[] } = { cleanups: [] };

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    mockUseEffect(() => {
      const cleanup = effect();
      if (cleanup) mockFocus.cleanups.push(cleanup);
      return cleanup;
    }, [effect]);
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../lib/image-upload', () => ({ pickImage: jest.fn(), uploadImage: jest.fn() }));
jest.mock('../api/chat', () => ({
  chatApi: {
    list: jest.fn(),
    get: jest.fn(),
    messages: jest.fn(),
    send: jest.fn(),
    markRead: jest.fn(() => Promise.resolve()),
    imageUrl: jest.fn(),
    imageUploadIntent: jest.fn(),
    report: jest.fn(),
    block: jest.fn(),
    unblock: jest.fn(),
  },
}));

const chat = jest.mocked(chatApi);

async function show(detail = conversationFixture(), items = [messageFixture()]) {
  chat.get.mockResolvedValue(detail);
  chat.messages.mockResolvedValue(page(items));
  await render(<ChatScreen conversationId="conv-1" />);
  await waitFor(() => expect(screen.getByText(detail.title)).toBeTruthy());
}

describe('Sohbet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocus.cleanups = [];
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows a message as "gönderiliyor" at once and retries with the same clientMessageId', async () => {
    await show();
    let failFirst: (e: unknown) => void = () => undefined;
    chat.send.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failFirst = reject;
        }),
    );
    await fireEvent.changeText(screen.getByTestId('chat-input'), 'Yarın 10:00 uygun mu?');
    await fireEvent.press(screen.getByTestId('chat-send'));

    // Optimistic: on screen before the server answered.
    expect(screen.getByText('Yarın 10:00 uygun mu?')).toBeTruthy();
    expect(screen.getByText('gönderiliyor…')).toBeTruthy();

    await act(async () => {
      failFirst(new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamadı.'));
    });
    expect(screen.getByText(/Gönderilemedi/)).toBeTruthy();

    const first = chat.send.mock.calls[0]?.[1];
    expect(first).toMatchObject({ type: 'TEXT', body: 'Yarın 10:00 uygun mu?' });
    const clientMessageId = first && 'clientMessageId' in first ? first.clientMessageId : '';
    expect(clientMessageId).toMatch(/^[0-9a-f-]{36}$/);

    chat.send.mockResolvedValueOnce(
      messageFixture({
        id: 'msg-2',
        mine: true,
        senderRole: 'CUSTOMER',
        body: 'Yarın 10:00 uygun mu?',
        clientMessageId,
        createdAt: '2026-09-30T09:00:00.000Z',
      }),
    );
    await fireEvent.press(screen.getByTestId('retry-message'));

    await waitFor(() => expect(screen.getByTestId('message-msg-2')).toBeTruthy());
    expect(chat.send).toHaveBeenCalledTimes(2);
    expect(chat.send.mock.calls[1]?.[1]).toEqual({
      type: 'TEXT',
      clientMessageId,
      body: 'Yarın 10:00 uygun mu?',
    });
    expect(screen.queryByText('gönderiliyor…')).toBeNull();
    expect(screen.queryByTestId('retry-message')).toBeNull();
    expect(screen.getByTestId('message-status').props.children).toBe('Gönderildi');
  });

  it('polls with `after` while focused and stops polling once the screen loses focus', async () => {
    jest.useFakeTimers();
    await show();
    const baseline = chat.messages.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(CHAT_POLL_MS);
    });
    expect(chat.messages.mock.calls.length).toBe(baseline + 1);
    expect(chat.messages).toHaveBeenLastCalledWith('conv-1', { after: 'msg-1' });

    await act(async () => {
      mockFocus.cleanups.forEach((cleanup) => cleanup());
    });
    const afterBlur = chat.messages.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(CHAT_POLL_MS * 6);
    });
    expect(chat.messages.mock.calls.length).toBe(afterBlur);
  });

  it('marks the conversation read up to the newest message', async () => {
    await show();
    await waitFor(() => expect(chat.markRead).toHaveBeenCalledWith('conv-1', 'msg-1'));
  });

  it('shows the contact reminder for a phone number but never changes or blocks the text', async () => {
    await show(conversationFixture(), [
      messageFixture({ id: 'msg-9', body: 'Numaram 0532 111 22 33', containsContactInfo: true }),
    ]);
    expect(screen.getByTestId('contact-note-msg-9')).toBeTruthy();
    expect(screen.getByText('Numaram 0532 111 22 33')).toBeTruthy();
    expect(screen.queryByTestId('contact-reminder')).toBeNull();

    const text = 'Beni ara: 0532 123 45 67';
    await fireEvent.changeText(screen.getByTestId('chat-input'), text);
    expect(screen.getByTestId('contact-reminder')).toBeTruthy();
    // Under the received message and above the composer.
    expect(
      screen.getAllByText('Güvenliğin için ödeme ve iletişimi UstaGO içinde tut.'),
    ).toHaveLength(2);
    expect(screen.getByTestId('chat-input').props.value).toBe(text);

    chat.send.mockResolvedValueOnce(messageFixture({ id: 'msg-10', mine: true, body: text }));
    await fireEvent.press(screen.getByTestId('chat-send'));
    expect(chat.send.mock.calls[0]?.[1]).toMatchObject({ type: 'TEXT', body: text });
  });

  it('explains why a closed conversation cannot be written to', async () => {
    await show(conversationFixture({ canSend: false, cannotSendReason: 'CLOSED' }));
    expect(screen.getByTestId('cannot-send')).toBeTruthy();
    expect(screen.getByText(/sohbet kapandı/)).toBeTruthy();
    expect(screen.queryByTestId('chat-input')).toBeNull();
  });

  it('tells the blocker how to unblock', async () => {
    await show(
      conversationFixture({ canSend: false, cannotSendReason: 'BLOCKED', blockedByMe: true }),
    );
    expect(screen.getByText(/engeli kaldırabilirsin/)).toBeTruthy();
    expect(screen.queryByTestId('chat-send')).toBeNull();
  });

  it('shows system messages and "Okundu" on my last read message', async () => {
    await show(conversationFixture({ counterpartLastReadAt: '2026-09-30T08:10:00.000Z' }), [
      messageFixture({
        id: 'sys-1',
        type: 'SYSTEM',
        senderRole: null,
        body: 'Teklif geldi: ₺1.500',
        createdAt: '2026-09-30T07:00:00.000Z',
      }),
      messageFixture({
        id: 'msg-3',
        mine: true,
        senderRole: 'CUSTOMER',
        body: 'Tamamdır',
        createdAt: '2026-09-30T08:05:00.000Z',
      }),
    ]);
    expect(screen.getByText('Teklif geldi: ₺1.500')).toBeTruthy();
    expect(screen.getByTestId('message-status').props.children).toBe('Okundu');
  });
});

describe('Mesajlar listesi', () => {
  it('shows the counterpart, request, last message and unread count', async () => {
    chat.list.mockResolvedValue({
      items: [
        {
          ...conversationFixture(),
          lastMessage: {
            type: 'IMAGE',
            preview: '',
            createdAt: '2026-09-30T08:00:00.000Z',
            mine: false,
          },
          unreadCount: 3,
        },
      ],
      nextCursor: null,
    });
    await render(<ConversationList role="CUSTOMER" />);
    await waitFor(() => expect(screen.getByTestId('conversation-conv-1')).toBeTruthy());
    expect(screen.getByText('Demo Klima Ustası')).toBeTruthy();
    expect(screen.getByText('📷 Fotoğraf')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByLabelText(/3 okunmamış mesaj/)).toBeTruthy();
  });

  it('shows an honest empty state', async () => {
    chat.list.mockResolvedValue({ items: [], nextCursor: null });
    await render(<ConversationList role="PROVIDER" />);
    await waitFor(() => expect(screen.getByText('Henüz mesajın yok')).toBeTruthy());
  });
});
