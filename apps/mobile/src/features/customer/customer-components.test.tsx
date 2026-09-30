import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { favoritesApi } from '../../api/customer-v2';
import { dispatchFixture, providerCardFixture, quoteFixture } from '../../test/customer-fixtures';
import { DispatchStatusCard } from './DispatchStatusCard';
import { ProviderCard } from './ProviderCard';
import { ComparisonLabels, QuoteComparisonTable, QuoteOfferCard } from './QuoteCompare';
import { dispatchProgressText, distanceText, responseText } from './text';

jest.mock('../../api/customer-v2', () => ({
  favoritesApi: { add: jest.fn(), remove: jest.fn() },
}));

const add = jest.mocked(favoritesApi.add);
const remove = jest.mocked(favoritesApi.remove);

describe('ProviderCard', () => {
  beforeEach(() => {
    add.mockReset();
    remove.mockReset();
  });

  it('shows real stats, the identity badge and an approximate distance', async () => {
    await render(<ProviderCard provider={providerCardFixture()} onPress={jest.fn()} />);
    expect(screen.getByText('✓ Kimliği doğrulandı')).toBeTruthy();
    expect(screen.getByText(/Yaklaşık 12 km/)).toBeTruthy();
    expect(screen.getByText(/Genellikle ~12 dk içinde yanıt verir/)).toBeTruthy();
    expect(screen.getByText('Bugün müsait')).toBeTruthy();
    expect(screen.queryByText(/en iyi/i)).toBeNull();
    expect(screen.queryByText(/yol mesafesi/i)).toBeNull();
  });

  it('hides response stats and distance when the API has none', async () => {
    await render(
      <ProviderCard
        provider={providerCardFixture({
          responseStats: null,
          distance: null,
          rating: null,
          isNewProvider: true,
          isVerified: false,
          availableToday: false,
        })}
        onPress={jest.fn()}
      />,
    );
    expect(screen.queryByText(/yanıt verir/)).toBeNull();
    expect(screen.queryByText(/Yaklaşık/)).toBeNull();
    expect(screen.queryByText('✓ Kimliği doğrulandı')).toBeNull();
    expect(screen.getByText('Yeni usta')).toBeTruthy();
    expect(screen.getByText(/Henüz değerlendirme yok/)).toBeTruthy();
  });

  it('opens the profile on press', async () => {
    const onPress = jest.fn();
    const p = providerCardFixture();
    await render(<ProviderCard provider={p} onPress={onPress} />);
    await fireEvent.press(screen.getByText('Ahmet Usta'));
    expect(onPress).toHaveBeenCalledWith(p);
  });

  it('flips the heart at once and keeps it when the server agrees', async () => {
    add.mockResolvedValue(undefined);
    const onChange = jest.fn();
    await render(
      <ProviderCard
        provider={providerCardFixture()}
        onPress={jest.fn()}
        onFavoriteChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByLabelText('Ahmet Usta favorilere ekle'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('p-1', true));
    expect(add).toHaveBeenCalledWith('p-1');
    expect(screen.getByLabelText('Ahmet Usta favorilerden çıkar')).toBeTruthy();
  });

  it('rolls the optimistic favorite back and explains when the server refuses', async () => {
    let reject: (e: Error) => void = () => undefined;
    remove.mockReturnValue(
      new Promise<void>((_, r) => {
        reject = r;
      }),
    );
    await render(
      <ProviderCard provider={providerCardFixture({ isFavorite: true })} onPress={jest.fn()} />,
    );
    await fireEvent.press(screen.getByLabelText('Ahmet Usta favorilerden çıkar'));
    // Optimistic: already shown as removed while the request runs.
    expect(screen.getByLabelText('Ahmet Usta favorilere ekle')).toBeTruthy();
    reject(new Error('offline'));
    await waitFor(() =>
      expect(screen.getByLabelText('Ahmet Usta favorilerden çıkar')).toBeTruthy(),
    );
    expect(screen.getByText(/Beklenmeyen bir hata oluştu/)).toBeTruthy();
  });
});

describe('text helpers', () => {
  it('always says "Yaklaşık" and never below 1 km', () => {
    expect(distanceText({ km: 0.2, approximate: true })).toBe('Yaklaşık 1 km');
    expect(distanceText({ km: 12.4, approximate: true })).toBe('Yaklaşık 12 km');
    expect(distanceText(null)).toBeNull();
  });

  it('formats response stats and hides missing ones', () => {
    expect(responseText({ medianMinutes: 95, responseRatePercent: 80, sampleSize: 20 })).toBe(
      'Genellikle ~2 saat içinde yanıt verir',
    );
    expect(responseText(null)).toBeNull();
  });

  it('describes dispatch progress from real counts', () => {
    expect(dispatchProgressText(dispatchFixture())).toBe(
      '7 uygun ustaya gönderildi · 3 görüntüledi · 1 teklif',
    );
    expect(dispatchProgressText(dispatchFixture({ viewedCount: 0, quoteCount: 0 }))).toBe(
      '7 uygun ustaya gönderildi · henüz teklif yok',
    );
    expect(dispatchProgressText(dispatchFixture({ dispatchedCount: 0 }))).toBeNull();
  });
});

describe('DispatchStatusCard', () => {
  it('shows progress, the preferred provider and the expand action', async () => {
    const onExpand = jest.fn();
    await render(
      <DispatchStatusCard
        dispatch={dispatchFixture({
          canExpand: true,
          noOfferPrompt: true,
          preferredProvider: { id: 'p-1', displayName: 'Ahmet Usta', status: 'VIEWED', only: true },
        })}
        onExpand={onExpand}
        expanding={false}
        error={null}
      />,
    );
    expect(screen.getByText('7 uygun ustaya gönderildi · 3 görüntüledi · 1 teklif')).toBeTruthy();
    expect(screen.getByText(/Ahmet Usta talebini görüntüledi/)).toBeTruthy();
    expect(screen.getByText(/yalnızca bu ustaya/)).toBeTruthy();
    expect(screen.getByTestId('no-offer-prompt')).toBeTruthy();
    await fireEvent.press(screen.getByText('Arama alanını genişlet'));
    expect(onExpand).toHaveBeenCalled();
  });

  it('explains no supply and waitlist, without an expand button unless allowed', async () => {
    await render(
      <DispatchStatusCard
        dispatch={dispatchFixture({
          dispatchedCount: 0,
          quoteCount: 0,
          viewedCount: 0,
          supply: 'WAITLIST',
        })}
        onExpand={jest.fn()}
        expanding={false}
        error={null}
      />,
    );
    expect(screen.getByText(/bekleme listesine alındı/)).toBeTruthy();
    expect(screen.queryByText('Arama alanını genişlet')).toBeNull();
  });
});

describe('offer comparison', () => {
  it('renders only the labels the server sent', async () => {
    await render(<ComparisonLabels labels={['LOWEST_PRICE']} />);
    expect(screen.getByText('En düşük fiyat')).toBeTruthy();
    expect(screen.queryByText('En yakın')).toBeNull();
    expect(screen.queryByText('En yüksek puan')).toBeNull();
    expect(screen.queryByText(/en iyi/i)).toBeNull();
  });

  it('renders nothing without labels', async () => {
    await render(<ComparisonLabels labels={[]} />);
    expect(screen.queryByTestId('comparison-labels')).toBeNull();
  });

  it('shows the price breakdown, ETA and distance on an offer and asks to message', async () => {
    const onMessage = jest.fn();
    const q = quoteFixture({ comparisonLabels: ['NEAREST'] });
    await render(
      <QuoteOfferCard quote={q} onOpen={jest.fn()} onMessage={onMessage} messaging={false} />,
    );
    expect(screen.getByText('₺1.500')).toBeTruthy();
    expect(screen.getByText('İşçilik: ₺1.000')).toBeTruthy();
    expect(screen.getByText('Malzeme: ₺500')).toBeTruthy();
    expect(screen.queryByText(/Hizmet:/)).toBeNull();
    expect(screen.getByText(/Varış: 1 saat içinde/)).toBeTruthy();
    expect(screen.getByText(/Yaklaşık 7 km/)).toBeTruthy();
    expect(screen.getByText('En yakın')).toBeTruthy();
    expect(screen.queryByText('En düşük fiyat')).toBeNull();
    await fireEvent.press(screen.getByText('Mesaj gönder'));
    expect(onMessage).toHaveBeenCalledWith(q);
  });

  it('lays quotes side by side with each provider’s own labels', async () => {
    await render(
      <QuoteComparisonTable
        quotes={[
          quoteFixture({ id: 'q-1', comparisonLabels: ['LOWEST_PRICE'] }),
          quoteFixture({
            id: 'q-2',
            comparisonLabels: [],
            latest: { total: { amountMinor: 180000, currency: 'TRY' }, arrivalEta: 'TOMORROW' },
          }),
        ]}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.getByTestId('compare-col-q-1')).toBeTruthy();
    expect(screen.getByTestId('compare-col-q-2')).toBeTruthy();
    expect(screen.getAllByText('En düşük fiyat')).toHaveLength(1);
    expect(screen.getByText('Yarın')).toBeTruthy();
    expect(screen.getByText('₺1.800')).toBeTruthy();
  });
});
