import type { Job } from '@ustago/types';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';

import JobDetail from '../../app/job/[id]';
import { jobApi } from '../api/services';
import { jobFixture } from '../test/fixtures';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'job-1' }),
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    mockUseEffect(() => effect(), [effect]);
  },
}));
jest.mock('../api/services', () => ({
  jobApi: { get: jest.fn() },
  changeOrderApi: {},
  reviewApi: {},
}));

const get = jest.mocked(jobApi.get);

async function show(job: Job) {
  get.mockResolvedValue(job);
  await render(<JobDetail />);
  await waitFor(() => expect(screen.getByText(job.serviceRequest.title)).toBeTruthy());
}

const PRIMARY = [
  'action-en-route',
  'action-arrive',
  'action-start',
  'action-request-completion',
  'action-complete',
];
const primaries = () => PRIMARY.filter((id) => screen.queryByTestId(id));

describe('Job detail', () => {
  beforeEach(() => get.mockReset());

  it('gives the provider exactly one next step', async () => {
    await show(
      jobFixture({
        viewerRole: 'PROVIDER',
        status: 'CONFIRMED',
        actions: { enRoute: true, cancel: true },
      }),
    );
    expect(primaries()).toEqual(['action-en-route']);
    expect(screen.getByText('YOLA ÇIKTIM')).toBeTruthy();
  });

  it('asks the customer to confirm or report a problem once the provider says done', async () => {
    await show(
      jobFixture({
        status: 'AWAITING_COMPLETION_CONFIRMATION',
        actions: { complete: true, dispute: true },
      }),
    );
    expect(primaries()).toEqual(['action-complete']);
    expect(screen.getByText('İŞ TAMAMLANDI')).toBeTruthy();
    expect(screen.getByText('SORUN BİLDİR')).toBeTruthy();
  });

  it('holds completion while a change order waits and never mentions payment', async () => {
    await show(
      jobFixture({
        viewerRole: 'PROVIDER',
        status: 'IN_PROGRESS',
        currentTotal: { amountMinor: 270000, currency: 'TRY' },
        changeOrders: [
          {
            id: 'co-1',
            jobId: 'job-1',
            status: 'PENDING',
            amount: { amountMinor: 30000, currency: 'TRY' },
            description: 'Kompresör rölesi değişimi',
            previousTotal: { amountMinor: 270000, currency: 'TRY' },
            proposedTotal: { amountMinor: 300000, currency: 'TRY' },
            createdAt: '2026-09-30T09:00:00.000Z',
            respondedAt: null,
          },
        ],
        actions: { requestCompletion: false },
      }),
    );
    expect(screen.getByTestId('action-request-completion')).toBeDisabled();
    expect(
      screen.getAllByText('Önce bekleyen ek iş talebinin sonuçlanması gerekiyor.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('₺2.700')).toBeTruthy();
    expect(screen.queryByText(/ödeme/i)).toBeNull();
  });
});
