import { render, screen, waitFor, within } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';

import { ApiError } from '../api/client';
import { walletApi } from '../api/finance';
import { WalletScreen } from '../screens/finance/WalletScreen';
import { walletFixture } from '../test/fixtures';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    mockUseEffect(() => effect(), [effect]);
  },
}));
jest.mock('../api/finance', () => ({
  walletApi: { get: jest.fn(), earnings: jest.fn(), transactions: jest.fn() },
}));

const api = jest.mocked(walletApi);
const tl = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

describe('Kazançlarım', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the balances, statements and movements from the server', async () => {
    api.get.mockResolvedValue(
      walletFixture({
        recent: [
          {
            transactionId: 'tx-1',
            type: 'PAYMENT_CAPTURED',
            label: 'Ödeme alındı',
            jobTitle: 'Klima gaz dolumu',
            createdAt: '2026-09-30T10:00:00.000Z',
            changes: [{ bucket: 'PENDING', amount: tl(187000) }],
          },
        ],
      }),
    );
    api.earnings.mockResolvedValue({
      items: [
        {
          id: 'earn-1',
          jobId: 'job-1',
          jobTitle: 'Klima gaz dolumu',
          categoryName: 'Klima',
          gross: tl(220000),
          platformFee: tl(33000),
          net: tl(187000),
          refunded: tl(0),
          feeBps: 1500,
          status: 'PENDING',
          holdUntil: '2026-10-02T09:00:00.000Z',
          releasedAt: null,
          createdAt: '2026-09-30T10:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    await render(<WalletScreen />);
    await waitFor(() => expect(screen.getByTestId('wallet-balances')).toBeTruthy());

    expect(screen.getByText('TEST ÖDEME ORTAMI — gerçek ücret alınmaz')).toBeTruthy();
    expect(within(screen.getByTestId('wallet-withdrawable')).getByText('₺2.350')).toBeTruthy();
    const balances = within(screen.getByTestId('wallet-balances'));
    expect(balances.getByLabelText('Bekleyen: ₺1.870')).toBeTruthy();
    expect(balances.getByLabelText('Kullanılabilir: ₺2.500')).toBeTruthy();
    expect(balances.getByLabelText('Ayrılan (para çekme): ₺500')).toBeTruthy();
    expect(balances.getByLabelText('Platform borcu: ₺150')).toBeTruthy();
    expect(balances.getByText(/Sonraki serbest kalma/)).toBeTruthy();

    const month = within(screen.getByTestId('statement-THIS_MONTH'));
    expect(month.getByText('Bu ay')).toBeTruthy();
    expect(month.getByLabelText('Brüt iş tutarı: ₺5.000')).toBeTruthy();
    expect(month.getByLabelText('Platform ücretleri: −₺750')).toBeTruthy();
    expect(month.getByLabelText('Net kazanç: ₺4.250')).toBeTruthy();
    expect(screen.getByText('Son 30 gün')).toBeTruthy();

    expect(screen.getByText('Ödeme alındı')).toBeTruthy();
    expect(screen.getByText('Bekleyen: +₺1.870')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('earning-earn-1')).toBeTruthy());
    expect(screen.getByText('Beklemede')).toBeTruthy();
  });

  it('shows an empty state before the first earning', async () => {
    api.get.mockResolvedValue(walletFixture());
    api.earnings.mockResolvedValue({ items: [], nextCursor: null });
    await render(<WalletScreen />);
    await waitFor(() => expect(screen.getByText('Henüz kazancınız yok')).toBeTruthy());
    expect(screen.getByText('Henüz hareket yok.')).toBeTruthy();
  });

  it('shows the error state with a retry when the wallet cannot load', async () => {
    api.get.mockRejectedValue(
      new ApiError(403, 'PROVIDER_ONLY', 'Bu bölüm yalnızca ustalar içindir.'),
    );
    api.earnings.mockResolvedValue({ items: [], nextCursor: null });
    await render(<WalletScreen />);
    await waitFor(() =>
      expect(screen.getByText('Bu bölüm yalnızca ustalar içindir.')).toBeTruthy(),
    );
    expect(screen.getByText('Tekrar dene')).toBeTruthy();
  });
});
