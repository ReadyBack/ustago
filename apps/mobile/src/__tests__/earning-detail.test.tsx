import type { ProviderEarning } from '@ustago/types';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';

import EarningDetail from '../../app/earnings/[id]';
import { walletApi } from '../api/finance';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'earn-1' }),
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    mockUseEffect(() => effect(), [effect]);
  },
}));
jest.mock('../api/finance', () => ({ walletApi: { earning: jest.fn() } }));

const tl = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

const earning = (overrides: Partial<ProviderEarning> = {}): ProviderEarning => ({
  id: 'earn-1',
  jobId: 'job-1',
  jobTitle: 'Sigorta panosu yenileme',
  categoryName: 'Elektrik',
  gross: tl(300000),
  platformFee: tl(45000),
  net: tl(255000),
  refunded: tl(0),
  feeBps: 1500,
  status: 'AVAILABLE',
  holdUntil: null,
  releasedAt: '2026-09-30T10:00:00.000Z',
  createdAt: '2026-09-30T09:00:00.000Z',
  ...overrides,
});

describe('Earning detail', () => {
  it('shows gross, fee and net', async () => {
    jest.mocked(walletApi.earning).mockResolvedValue(earning());
    await render(<EarningDetail />);
    await waitFor(() => expect(screen.getByTestId('earning-detail')).toBeTruthy());
    expect(screen.getByText('₺2.550')).toBeTruthy();
    expect(screen.queryByText('İade')).toBeNull();
  });

  it('takes the provider part of a refund off the net, so the rows add up', async () => {
    jest.mocked(walletApi.earning).mockResolvedValue(earning({ refunded: tl(21250) }));
    await render(<EarningDetail />);
    await waitFor(() => expect(screen.getByTestId('earning-detail')).toBeTruthy());
    expect(screen.getByText('−₺212,50')).toBeTruthy();
    // 3.000 − 450 − 212,50
    expect(screen.getByText('₺2.337,50')).toBeTruthy();
    expect(screen.queryByText('₺2.550')).toBeNull();
  });
});
