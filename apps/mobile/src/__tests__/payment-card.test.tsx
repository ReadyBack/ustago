import type { JobPaymentSummary, Payment } from '@ustago/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';

import { ApiError } from '../api/client';
import { paymentApi } from '../api/finance';
import { PaymentCard } from '../screens/job/PaymentCard';
import { jobFixture, paymentFixture, paymentSummaryFixture } from '../test/fixtures';

let mockDev = true;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    mockUseEffect(() => effect(), [effect]);
  },
}));
jest.mock('../api/config', () => ({
  get IS_DEV() {
    return mockDev;
  },
}));
jest.mock('../lib/confirm', () => ({
  confirm: (_title: string, _message: string, onYes: () => void) => onYes(),
}));
jest.mock('../api/finance', () => ({
  paymentApi: {
    summary: jest.fn(),
    chooseMethod: jest.fn(),
    create: jest.fn(),
    simulate: jest.fn(),
    confirmCash: jest.fn(),
    disputeCash: jest.fn(),
  },
}));

const api = jest.mocked(paymentApi);
const tl = (amountMinor: number) => ({ amountMinor, currency: 'TRY' as const });
const TEST_BANNER = 'TEST ÖDEME ORTAMI — gerçek ücret alınmaz';

async function show(summary: JobPaymentSummary) {
  api.summary.mockResolvedValue(summary);
  await render(<PaymentCard job={jobFixture({ status: 'COMPLETED' })} />);
  await waitFor(() => expect(screen.getByTestId('payment-card')).toBeTruthy());
}

describe('Payment card (customer)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDev = true;
  });

  it('shows the test banner, the totals and a pay button for what is left', async () => {
    await show(
      paymentSummaryFixture({
        paid: tl(170000),
        netPaid: tl(170000),
        outstanding: tl(50000),
        actions: { canPayOnline: true },
      }),
    );
    expect(screen.getByText(TEST_BANNER)).toBeTruthy();
    expect(screen.getByText('Kalan')).toBeTruthy();
    expect(screen.getByText('₺2.200')).toBeTruthy();
    expect(screen.getByTestId('pay-button')).toHaveTextContent('Kalan ₺500 ÖDE');
    expect(screen.queryByText('Başarılı ödeme (TEST)')).toBeNull();
    expect(screen.queryByText(/fatura/i)).toBeNull();
  });

  it('labels the first payment with the full amount and offers both methods', async () => {
    await show(
      paymentSummaryFixture({
        method: null,
        actions: { canChooseMethod: true, canPayOnline: true },
      }),
    );
    expect(screen.getByTestId('pay-button')).toHaveTextContent('₺2.200 ÖDE');
    expect(screen.getByText('Uygulamadan öde')).toBeTruthy();
    expect(screen.getByText('Ustaya doğrudan öde')).toBeTruthy();
  });

  it('hides the banner and the test buttons outside test mode', async () => {
    await show(
      paymentSummaryFixture({
        testMode: false,
        outstanding: tl(0),
        inFlight: paymentFixture({ testMode: false }),
      }),
    );
    expect(screen.queryByText(TEST_BANNER)).toBeNull();
    expect(screen.getByTestId('payment-pending')).toBeTruthy();
    expect(screen.queryByText('Başarılı ödeme (TEST)')).toBeNull();
    expect(screen.queryByText('Başarısız ödeme (TEST)')).toBeNull();
  });

  it('never shows the test buttons in a release build, even in test mode', async () => {
    mockDev = false;
    await show(paymentSummaryFixture({ outstanding: tl(0), inFlight: paymentFixture() }));
    expect(screen.getByText(TEST_BANNER)).toBeTruthy();
    expect(screen.queryByText('Başarılı ödeme (TEST)')).toBeNull();
  });

  it('starts a payment, runs the test step and shows success', async () => {
    const due = paymentSummaryFixture({ actions: { canPayOnline: true } });
    const pending = paymentFixture();
    const paid = paymentSummaryFixture({
      paid: tl(220000),
      netPaid: tl(220000),
      outstanding: tl(0),
      payments: [paymentFixture({ status: 'SUCCEEDED', succeededAt: '2026-09-30T10:01:00.000Z' })],
    });
    await show(due);
    api.create.mockResolvedValue(pending);
    api.summary.mockResolvedValue(paymentSummaryFixture({ outstanding: tl(0), inFlight: pending }));
    await fireEvent.press(screen.getByTestId('pay-button'));
    await waitFor(() => expect(screen.getByText('Başarılı ödeme (TEST)')).toBeTruthy());
    expect(api.create).toHaveBeenCalledWith(
      'job-1',
      expect.stringMatching(/^[A-Za-z0-9_-]{8,80}$/),
    );

    api.simulate.mockResolvedValue(
      paymentFixture({ status: 'SUCCEEDED', succeededAt: '2026-09-30T10:01:00.000Z' }),
    );
    api.summary.mockResolvedValue(paid);
    await fireEvent.press(screen.getByText('Başarılı ödeme (TEST)'));
    await waitFor(() => expect(screen.getByTestId('payment-success')).toBeTruthy());
    expect(api.simulate).toHaveBeenCalledWith('pay-1', 'SUCCESS');
    expect(screen.getByText('₺2.200 ödendi. Teşekkürler!')).toBeTruthy();
    expect(screen.queryByTestId('pay-button')).toBeNull();
    expect(screen.queryByText('Başarılı ödeme (TEST)')).toBeNull();
  });

  it('shows the failure message when the test payment is declined', async () => {
    const pending = paymentFixture();
    await show(paymentSummaryFixture({ outstanding: tl(0), inFlight: pending }));
    api.simulate.mockResolvedValue(
      paymentFixture({ status: 'FAILED', lastFailureCode: 'CARD_DECLINED' }),
    );
    api.summary.mockResolvedValue(paymentSummaryFixture({ actions: { canPayOnline: true } }));
    await fireEvent.press(screen.getByText('Başarısız ödeme (TEST)'));
    await waitFor(() =>
      expect(screen.getByText('Ödeme alınamadı. Lütfen tekrar deneyin.')).toBeTruthy(),
    );
    expect(api.simulate).toHaveBeenCalledWith('pay-1', 'CARD_DECLINED');
    expect(
      screen.getByText('Kart reddedildi. Lütfen başka bir kartla tekrar deneyin.'),
    ).toBeTruthy();
    // The customer can try again.
    expect(screen.getByTestId('pay-button')).toBeTruthy();
  });

  it('sends one payment request for a double tap', async () => {
    await show(paymentSummaryFixture({ actions: { canPayOnline: true } }));
    let finish: (p: Payment) => void = () => undefined;
    api.create.mockImplementation(
      () =>
        new Promise<Payment>((resolve) => {
          finish = resolve;
        }),
    );
    const button = screen.getByTestId('pay-button');
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pay-button')).toBeDisabled();
    api.summary.mockResolvedValue(
      paymentSummaryFixture({ outstanding: tl(0), inFlight: paymentFixture() }),
    );
    finish(paymentFixture());
    await waitFor(() => expect(screen.getByTestId('payment-pending')).toBeTruthy());
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it('reuses the idempotency key when a retry follows a network failure', async () => {
    await show(paymentSummaryFixture({ actions: { canPayOnline: true } }));
    api.create.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamadı.'));
    await fireEvent.press(screen.getByTestId('pay-button'));
    await waitFor(() => expect(screen.getByText('Sunucuya ulaşılamadı.')).toBeTruthy());
    api.create.mockResolvedValueOnce(paymentFixture());
    await fireEvent.press(screen.getByTestId('pay-button'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    expect(api.create.mock.calls[1]?.[1]).toBe(api.create.mock.calls[0]?.[1]);
  });

  it('maps finance error codes to friendly Turkish', async () => {
    await show(paymentSummaryFixture({ actions: { canPayOnline: true } }));
    api.create.mockRejectedValueOnce(new ApiError(409, 'PAYMENT_NOTHING_DUE', 'Nothing due'));
    await fireEvent.press(screen.getByTestId('pay-button'));
    await waitFor(() =>
      expect(screen.getByText('Bu iş için ödenecek tutar kalmadı.')).toBeTruthy(),
    );
  });

  it('lets the customer confirm a cash payment with both sides shown', async () => {
    await show(
      paymentSummaryFixture({
        method: 'CASH',
        cash: {
          id: 'cash-1',
          status: 'PROVIDER_CONFIRMED',
          amount: tl(220000),
          customerConfirmedAt: null,
          providerConfirmedAt: '2026-09-30T10:00:00.000Z',
          confirmedAt: null,
          disputedAt: null,
        },
        actions: { canConfirmCash: true, canDisputeCash: true },
      }),
    );
    expect(screen.getByText('Usta ödemeyi aldığını bildirdi. Yaptıysanız onaylayın.')).toBeTruthy();
    expect(screen.getByText('Aldım ✓')).toBeTruthy();
    expect(screen.getByText('Sorun bildir')).toBeTruthy();
    api.confirmCash.mockResolvedValue(paymentSummaryFixture({ method: 'CASH' }));
    await fireEvent.press(screen.getByText('Ödemeyi yaptım'));
    await waitFor(() => expect(api.confirmCash).toHaveBeenCalledWith('job-1'));
    await waitFor(() => expect(screen.queryByText('Ödemeyi yaptım')).toBeNull());
  });

  it('asks for a note before reporting a cash problem', async () => {
    await show(paymentSummaryFixture({ method: 'CASH', actions: { canDisputeCash: true } }));
    await fireEvent.press(screen.getByText('Sorun bildir'));
    await fireEvent.press(screen.getByTestId('send-cash-dispute'));
    expect(screen.getByText('Lütfen durumu en az 10 karakterle açıklayın.')).toBeTruthy();
    expect(api.disputeCash).not.toHaveBeenCalled();
    api.disputeCash.mockResolvedValue(paymentSummaryFixture({ method: 'CASH' }));
    await fireEvent.changeText(
      screen.getByTestId('cash-dispute-note'),
      'Ödemeyi yaptım ama usta almadığını söylüyor.',
    );
    await fireEvent.press(screen.getByTestId('send-cash-dispute'));
    await waitFor(() =>
      expect(api.disputeCash).toHaveBeenCalledWith(
        'job-1',
        'Ödemeyi yaptım ama usta almadığını söylüyor.',
      ),
    );
  });
});

describe('Payment card (provider)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the fee breakdown and the development-rate note, never a pay button', async () => {
    await show(
      paymentSummaryFixture({
        viewerRole: 'PROVIDER',
        method: 'CASH',
        providerBreakdown: {
          gross: tl(220000),
          platformFee: tl(33000),
          net: tl(187000),
          feeBps: 1500,
          developmentPolicy: true,
        },
        actions: { canConfirmCash: true },
      }),
    );
    expect(screen.getByText('Brüt')).toBeTruthy();
    expect(screen.getByText('Platform ücreti (%15)')).toBeTruthy();
    expect(screen.getByText('−₺330')).toBeTruthy();
    expect(screen.getByText('Net kazancınız')).toBeTruthy();
    expect(screen.getByText('₺1.870')).toBeTruthy();
    expect(screen.getByText('Geliştirme oranı; nihai ticari oran değildir.')).toBeTruthy();
    expect(screen.getByText('Ödemeyi aldım')).toBeTruthy();
    expect(screen.queryByTestId('pay-button')).toBeNull();
  });
});
