import type { Payout, PayoutDestination } from '@ustago/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';

import { ApiError } from '../api/client';
import { payoutApi, walletApi } from '../api/finance';
import { PayoutScreen } from '../screens/finance/PayoutScreen';
import { walletFixture } from '../test/fixtures';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    mockUseEffect(() => effect(), [effect]);
  },
}));
jest.mock('../lib/confirm', () => ({
  confirm: (_title: string, _message: string, onYes: () => void) => onYes(),
}));
jest.mock('../api/finance', () => ({
  walletApi: { get: jest.fn() },
  payoutApi: {
    list: jest.fn(),
    setDestination: jest.fn(),
    request: jest.fn(),
    cancel: jest.fn(),
  },
}));

const wallet = jest.mocked(walletApi);
const payouts = jest.mocked(payoutApi);
const tl = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });

const destination: PayoutDestination = {
  id: 'dest-1',
  holderName: 'Demo Usta',
  maskedIban: 'TR** **** **** **** **** **13 26',
  isTest: true,
  verificationStatus: 'VERIFIED',
};

const payout = (overrides: Partial<Payout> = {}): Payout => ({
  id: 'po-1',
  amount: tl(100050),
  status: 'REQUESTED',
  destination,
  failureCode: null,
  createdAt: '2026-09-30T11:00:00.000Z',
  paidAt: null,
  cancelledAt: null,
  failedAt: null,
  ...overrides,
});

async function show(dest: PayoutDestination | null, items: Payout[] = []) {
  wallet.get.mockResolvedValue(walletFixture({ destination: dest }));
  payouts.list.mockResolvedValue({ items, nextCursor: null });
  await render(<PayoutScreen />);
  await waitFor(() => expect(screen.getByTestId('payout-withdrawable')).toBeTruthy());
}

describe('Para Çek', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects an invalid IBAN and shows only the masked IBAN after saving', async () => {
    await show(null);
    await fireEvent.changeText(screen.getByTestId('holder-name'), 'Demo Usta');
    await fireEvent.changeText(
      screen.getByTestId('iban-input'),
      'TR33 0006 1005 1978 6457 8413 27',
    );
    await fireEvent.press(screen.getByTestId('save-destination'));
    expect(screen.getByText('Geçerli bir TR IBAN girin (TR + 24 rakam).')).toBeTruthy();
    expect(payouts.setDestination).not.toHaveBeenCalled();

    payouts.setDestination.mockResolvedValue(destination);
    await fireEvent.changeText(
      screen.getByTestId('iban-input'),
      'tr33 0006 1005 1978 6457 8413 26',
    );
    await fireEvent.press(screen.getByTestId('save-destination'));
    await waitFor(() => expect(screen.getByTestId('masked-iban')).toBeTruthy());
    expect(payouts.setDestination).toHaveBeenCalledWith('Demo Usta', 'TR330006100519786457841326');
    expect(screen.getByText('TR** **** **** **** **** **13 26')).toBeTruthy();
    expect(screen.getByText('TEST hesabı')).toBeTruthy();
    expect(screen.queryByText(/TR330006100519786457841326/)).toBeNull();
  });

  it('converts "1.000,50" to 100050 kuruş and sends it with an idempotency key', async () => {
    await show(destination);
    payouts.request.mockResolvedValue(payout());
    await fireEvent.changeText(screen.getByTestId('payout-amount'), '1.000,50');
    await fireEvent.press(screen.getByTestId('request-payout'));
    await waitFor(() => expect(screen.getByTestId('payout-done')).toBeTruthy());
    expect(payouts.request).toHaveBeenCalledWith(
      100050,
      expect.stringMatching(/^[A-Za-z0-9_-]{8,80}$/),
    );
    expect(screen.getByText('₺1.000,50 için talebiniz alındı.')).toBeTruthy();
  });

  it('checks the amount against the minimum and the withdrawable balance', async () => {
    await show(destination);
    await fireEvent.changeText(screen.getByTestId('payout-amount'), '50');
    await fireEvent.press(screen.getByTestId('request-payout'));
    expect(screen.getByText('En az ₺100 çekebilirsiniz.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('payout-amount'), '5000');
    await fireEvent.press(screen.getByTestId('request-payout'));
    expect(screen.getByText('En fazla ₺2.350 çekebilirsiniz.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('payout-amount'), '12,345');
    await fireEvent.press(screen.getByTestId('request-payout'));
    expect(screen.getByText('Tutarı 500 veya 500,50 biçiminde yazın.')).toBeTruthy();
    expect(payouts.request).not.toHaveBeenCalled();
  });

  it('sends one payout request for a double tap', async () => {
    await show(destination);
    let finish: (p: Payout) => void = () => undefined;
    payouts.request.mockImplementation(
      () =>
        new Promise<Payout>((resolve) => {
          finish = resolve;
        }),
    );
    await fireEvent.changeText(screen.getByTestId('payout-amount'), '500');
    await fireEvent.press(screen.getByTestId('request-payout'));
    await fireEvent.press(screen.getByTestId('request-payout'));
    expect(payouts.request).toHaveBeenCalledTimes(1);
    finish(payout({ amount: tl(50000) }));
    await waitFor(() => expect(screen.getByTestId('payout-done')).toBeTruthy());
    expect(payouts.request).toHaveBeenCalledTimes(1);
  });

  it('shows a friendly message for a server-side refusal', async () => {
    await show(destination);
    payouts.request.mockRejectedValue(
      new ApiError(422, 'INSUFFICIENT_AVAILABLE_BALANCE', 'Insufficient'),
    );
    await fireEvent.changeText(screen.getByTestId('payout-amount'), '500');
    await fireEvent.press(screen.getByTestId('request-payout'));
    await waitFor(() =>
      expect(screen.getByText('Çekilebilir bakiyeniz bu tutar için yeterli değil.')).toBeTruthy(),
    );
  });

  it('lists requests with their status and cancels a requested one', async () => {
    await show(destination, [
      payout(),
      payout({ id: 'po-2', status: 'PAID', paidAt: '2026-09-29T11:00:00.000Z' }),
    ]);
    expect(screen.getByText('Talep edildi')).toBeTruthy();
    expect(screen.getAllByText('Ödendi')).toHaveLength(2); // badge and paid-at row
    expect(screen.queryByTestId('cancel-payout-po-2')).toBeNull();
    payouts.cancel.mockResolvedValue(payout({ status: 'CANCELLED' }));
    await fireEvent.press(screen.getByTestId('cancel-payout-po-1'));
    await waitFor(() => expect(payouts.cancel).toHaveBeenCalledWith('po-1'));
  });
});
