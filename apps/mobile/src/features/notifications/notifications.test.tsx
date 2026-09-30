import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';

import { notificationV2Api } from '../../api/customer-v2';
import { notificationFixture } from '../../test/customer-fixtures';
import { NotificationCenter } from './NotificationCenter';
import { categoryForTab, filterByTab } from './tabs';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    mockUseEffect(() => effect(), [effect]);
  },
}));
jest.mock('../../api/customer-v2', () => ({
  notificationV2Api: { list: jest.fn(), markRead: jest.fn() },
  homeApi: { badges: jest.fn(() => Promise.resolve({ notifications: 0, messages: 0 })) },
}));

const list = jest.mocked(notificationV2Api.list);
const markRead = jest.mocked(notificationV2Api.markRead);

const job = notificationFixture({ id: 'n-job', title: 'Ustanız yola çıktı' });
const quote = notificationFixture({
  id: 'n-quote',
  type: 'quote.created',
  title: 'Yeni teklif geldi',
  deepLink: '/quotes/q-1',
  category: 'JOBS',
});
const message = notificationFixture({
  id: 'n-msg',
  type: 'message.received',
  title: 'Yeni mesaj',
  category: 'MESSAGES',
  deepLink: null,
  readAt: '2026-09-30T11:00:00.000Z',
});
const payment = notificationFixture({
  id: 'n-pay',
  type: 'payment.succeeded',
  title: 'Ödeme alındı',
  category: 'FINANCE',
});
const all = [job, quote, message, payment];

describe('notification tabs', () => {
  it('maps tabs to API categories; offers are quote.* rows inside JOBS', () => {
    expect(categoryForTab('ALL')).toBeNull();
    expect(categoryForTab('QUOTES')).toBe('JOBS');
    expect(categoryForTab('FINANCE')).toBe('FINANCE');
    expect(filterByTab(all, 'QUOTES').map((n) => n.id)).toEqual(['n-quote']);
    expect(filterByTab(all, 'JOBS').map((n) => n.id)).toEqual(['n-job']);
    expect(filterByTab(all, 'MESSAGES').map((n) => n.id)).toEqual(['n-msg']);
    expect(filterByTab(all, 'ALL')).toHaveLength(4);
    expect(filterByTab(all, 'ACCOUNT')).toEqual([]);
  });
});

describe('NotificationCenter', () => {
  beforeEach(() => {
    list.mockReset();
    markRead.mockReset();
    mockPush.mockReset();
    list.mockImplementation(({ category }) =>
      Promise.resolve({
        items: category ? all.filter((n) => n.category === category) : all,
        nextCursor: null,
      }),
    );
    markRead.mockResolvedValue(undefined);
  });

  it('filters by category tab and asks the API for that category', async () => {
    await render(<NotificationCenter />);
    await waitFor(() => expect(screen.getByText('Ödeme alındı')).toBeTruthy());
    expect(list).toHaveBeenLastCalledWith({ category: null });

    await fireEvent.press(screen.getByText('Teklifler'));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ category: 'JOBS' }));
    await waitFor(() => expect(screen.getByText('Yeni teklif geldi')).toBeTruthy());
    expect(screen.queryByText('Ustanız yola çıktı')).toBeNull();
    expect(screen.queryByText('Ödeme alındı')).toBeNull();

    await fireEvent.press(screen.getByText('Hesap'));
    await waitFor(() => expect(screen.getByText('Bildirim yok')).toBeTruthy());
  });

  it('marks unread rows as read on tap and follows the deep link', async () => {
    await render(<NotificationCenter />);
    await waitFor(() => expect(screen.getByText('Yeni teklif geldi')).toBeTruthy());
    expect(screen.getByLabelText(/^Okunmamış\. Yeni teklif geldi/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('notification-n-quote'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/quote/q-1'));
    expect(markRead).toHaveBeenCalledWith(['n-quote']);
    expect(screen.getByLabelText(/^Yeni teklif geldi/)).toBeTruthy();
  });

  it('marks everything read', async () => {
    await render(<NotificationCenter />);
    await waitFor(() => expect(screen.getByTestId('mark-all-read')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('mark-all-read'));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith());
  });
});
