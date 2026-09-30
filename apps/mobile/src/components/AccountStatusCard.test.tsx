import { fireEvent, render, screen } from '@testing-library/react-native';

import { verificationCaseFixture } from '../test/fixtures';
import { AccountStatusCard } from './AccountStatusCard';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

describe('AccountStatusCard', () => {
  beforeEach(() => mockPush.mockClear());

  it('invites an unverified provider into the verification flow', async () => {
    await render(<AccountStatusCard view={verificationCaseFixture()} />);
    expect(screen.getByText('Hesap aktif')).toBeTruthy();
    expect(screen.getByText('Doğrulama: Doğrulanmadı')).toBeTruthy();
    expect(screen.queryByTestId('account-notice')).toBeNull();
    await fireEvent.press(screen.getByText('Hesabımı Doğrula'));
    expect(mockPush).toHaveBeenCalledWith('/verification');
  });

  it('explains a suspension and its reason', async () => {
    await render(
      <AccountStatusCard
        view={verificationCaseFixture({
          status: 'VERIFIED',
          accountStatus: 'SUSPENDED',
          capabilities: {
            listed: false,
            canQuote: false,
            canTakeNowJobs: false,
            canRequestPayout: true,
            showVerifiedBadge: false,
            restrictions: ['Yeni teklif veremezsiniz.'],
          },
          activeSuspension: {
            id: 's1',
            level: 'SUSPENDED',
            status: 'ACTIVE',
            reasonCode: 'NO_SHOW',
            userVisibleReason: 'Tekrarlanan randevu kaçırma',
            startsAt: '2026-09-01T00:00:00.000Z',
            expiresAt: null,
            createdAt: '2026-09-01T00:00:00.000Z',
          },
        })}
      />,
    );
    expect(screen.getByTestId('account-notice')).toBeTruthy();
    expect(screen.getByText('Hesabınız askıya alındı')).toBeTruthy();
    expect(screen.getByText('Gerekçe: Tekrarlanan randevu kaçırma')).toBeTruthy();
    expect(screen.getByText('• Yeni teklif veremezsiniz.')).toBeTruthy();
    expect(screen.queryByTestId('open-verification')).toBeNull();
  });

  it('shows the revision reason and the verified badge', async () => {
    await render(
      <AccountStatusCard
        view={verificationCaseFixture({
          status: 'NEEDS_REVISION',
          userVisibleReason: 'Kimlik fotoğrafı bulanık.',
        })}
      />,
    );
    expect(screen.getByText('Kimlik fotoğrafı bulanık.')).toBeTruthy();
    expect(screen.getByText('Eksikleri tamamla')).toBeTruthy();

    await render(
      <AccountStatusCard
        view={verificationCaseFixture({
          status: 'VERIFIED',
          capabilities: { ...verificationCaseFixture().capabilities, showVerifiedBadge: true },
        })}
      />,
    );
    expect(screen.getByText('✓ Kimliği/hesabı doğrulanmıştır')).toBeTruthy();
  });
});
