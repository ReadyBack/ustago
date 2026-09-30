import type { Opportunity, Quote } from '@ustago/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { providerV2Api } from '../api/provider-v2';
import { pickImage, uploadImage } from '../lib/image-upload';
import { OpportunityCard } from '../features/provider/OpportunityCard';
import { PortfolioForm } from '../features/provider/PortfolioForm';
import { buildPortfolioItem, moveId, PORTFOLIO_CONSENTS } from '../features/provider/portfolio';
import { QuoteForm } from '../features/provider/QuoteForm';
import {
  buildQuotePayload,
  computeBreakdown,
  EMPTY_QUOTE_FORM,
} from '../features/provider/quote-form';
import { buildWeeklyHours, type IntervalDraft } from '../features/provider/weekly-hours';
import { WeeklyHoursEditor } from '../features/provider/WeeklyHoursEditor';
import { distanceLabel, parseTrDate } from '../features/provider/labels';
import { opportunityFixture } from '../test/chat-fixtures';

jest.mock('../api/provider-v2', () => ({
  providerV2Api: {
    createQuote: jest.fn(),
    createPortfolioItem: jest.fn(),
    updatePortfolioItem: jest.fn(),
    portfolioUploadIntent: jest.fn(),
  },
}));
jest.mock('../lib/image-upload', () => ({ pickImage: jest.fn(), uploadImage: jest.fn() }));

const v2 = jest.mocked(providerV2Api);
const UPLOAD_ID = '3f2b6c1e-8a4d-4c1e-9b7a-2d5e6f7a8b9c';

const row = (weekday: number, start: string, end: string): IntervalDraft => ({
  key: `${weekday}-${start}`,
  weekday,
  start,
  end,
});

describe('Çalışma saatleri', () => {
  it('refuses overlapping intervals on the same day', () => {
    const result = buildWeeklyHours([row(1, '09:00', '13:00'), row(1, '12:00', '18:00')]);
    expect(result).toEqual({
      ok: false,
      error: 'Pazartesi: Aynı gün için çakışan saat aralıkları var.',
    });
  });

  it('accepts touching intervals and the same hours on different days', () => {
    const result = buildWeeklyHours([
      row(1, '09:00', '12:00'),
      row(1, '12:00', '18:00'),
      row(2, '09:00', '18:00'),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.hours).toEqual([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 720, endMinute: 1080 },
        { weekday: 2, startMinute: 540, endMinute: 1080 },
      ]);
    }
  });

  it('refuses an end before the start and unreadable times', () => {
    expect(buildWeeklyHours([row(3, '18:00', '09:00')])).toMatchObject({ ok: false });
    expect(buildWeeklyHours([row(3, 'sabah', '12:00')])).toMatchObject({ ok: false });
    expect(buildWeeklyHours([])).toEqual({ ok: true, body: { hours: [] } });
  });

  it('does not save overlapping hours from the editor', async () => {
    const onSave = jest.fn(() => Promise.resolve());
    await render(
      <WeeklyHoursEditor
        initial={[
          { weekday: 5, startMinute: 540, endMinute: 780 },
          { weekday: 5, startMinute: 720, endMinute: 1080 },
        ]}
        onSave={onSave}
      />,
    );
    await fireEvent.press(screen.getByTestId('save-weekly-hours'));
    expect(screen.getByText('Cuma: Aynı gün için çakışan saat aralıkları var.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('Teklif formu V2', () => {
  it('computes the total as the sum of the lines', () => {
    const b = computeBreakdown({ labor: '1.500', material: '250,50', service: '', other: '100' });
    expect(b.total).toBe(150000 + 25050 + 10000);
    expect(b.parts).toEqual({ labor: 150000, material: 25050, service: null, other: 10000 });
    expect(
      computeBreakdown({ labor: 'abc', material: '', service: '', other: '' }).invalidLine,
    ).toBe('labor');
  });

  it('builds a body that createQuoteSchema accepts, total = labour + material', () => {
    const result = buildQuotePayload({
      ...EMPTY_QUOTE_FORM,
      lines: { labor: '1500', material: '250', service: '', other: '' },
      eta: 'HOUR_2',
      note: '  Gaz dahil ',
    });
    expect(result).toEqual({
      ok: true,
      body: {
        totalMinor: 175000,
        laborMinor: 150000,
        materialMinor: 25000,
        materialsIncluded: true,
        arrivalEta: 'HOUR_2',
        note: 'Gaz dahil',
      },
    });
  });

  it('needs an arrival estimate and a date for "Özel tarih"', () => {
    const lines = { labor: '1500', material: '', service: '', other: '' };
    expect(buildQuotePayload({ ...EMPTY_QUOTE_FORM, lines })).toEqual({
      ok: false,
      error: 'Ne zaman gelebileceğini seç.',
    });
    expect(
      buildQuotePayload({ ...EMPTY_QUOTE_FORM, lines, eta: 'CUSTOM', customDate: '31.02.2099' }),
    ).toMatchObject({ ok: false });
    const custom = buildQuotePayload({
      ...EMPTY_QUOTE_FORM,
      lines,
      eta: 'CUSTOM',
      customDate: '15.03.2099',
      customTime: '14:30',
    });
    expect(custom).toMatchObject({
      ok: true,
      body: { arrivalEta: 'CUSTOM', availableFrom: '2099-03-15T14:30:00+03:00' },
    });
  });

  it('explains the labour + material + servis case the shared schema still refuses', () => {
    const result = buildQuotePayload({
      ...EMPTY_QUOTE_FORM,
      lines: { labor: '1000', material: '200', service: '100', other: '' },
      eta: 'TODAY',
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^Şimdilik/) });
    // Without material the extra line is accepted.
    expect(
      buildQuotePayload({
        ...EMPTY_QUOTE_FORM,
        lines: { labor: '1000', material: '', service: '100', other: '50' },
        eta: 'TODAY',
      }),
    ).toMatchObject({ ok: true, body: { totalMinor: 115000 } });
  });

  it('shows the computed total and sends the breakdown', async () => {
    const onCreated = jest.fn();
    v2.createQuote.mockResolvedValue({ id: 'q-1' } as Quote);
    await render(<QuoteForm requestId="req-1" requestType="QUOTE" onCreated={onCreated} />);
    await fireEvent.changeText(screen.getByTestId('quote-line-labor'), '1.500');
    await fireEvent.changeText(screen.getByTestId('quote-line-service'), '200');
    expect(screen.getByTestId('quote-total').props.children).toBe('₺1.700');
    await fireEvent.press(screen.getByText('1 saat içinde'));
    await fireEvent.press(screen.getByTestId('send-quote'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(v2.createQuote).toHaveBeenCalledWith('req-1', {
      totalMinor: 170000,
      laborMinor: 150000,
      serviceMinor: 20000,
      arrivalEta: 'HOUR_1',
    });
  });
});

describe('Sana Uygun İşler kartı', () => {
  it('shows an approximate distance, district/province and never an address', async () => {
    // Even if a response carried an address by mistake, the card would not print it.
    const leaked = {
      ...opportunityFixture(),
      address: { addressLine: 'Atatürk Caddesi No 12', buildingNo: '12' },
    } as Opportunity;
    await render(<OpportunityCard o={leaked} onPress={jest.fn()} />);
    expect(screen.getByTestId('distance-req-1').props.children).toEqual(['📍 ', 'Yaklaşık 12 km']);
    expect(screen.getByText(/Seyhan \/ Adana/)).toBeTruthy();
    expect(screen.getByText('₺1.500–₺2.000')).toBeTruthy();
    expect(screen.getByText('⭐ Sana özel')).toBeTruthy();
    expect(screen.getByText('Yeni')).toBeTruthy();
    expect(screen.getByText('📷 2')).toBeTruthy();
    expect(screen.queryByText(/Atatürk/)).toBeNull();
  });

  it('drops the "Yeni" badge once viewed and shows no distance when unknown', async () => {
    await render(
      <OpportunityCard
        o={opportunityFixture({
          distance: null,
          isPreferredForMe: false,
          dispatch: {
            wave: 1,
            dispatchedAt: '2026-09-30T08:01:00.000Z',
            viewedAt: '2026-09-30T08:02:00.000Z',
          },
        })}
        onPress={jest.fn()}
      />,
    );
    expect(screen.queryByText('Yeni')).toBeNull();
    expect(screen.queryByText(/km/)).toBeNull();
    expect(distanceLabel({ km: 0.3, approximate: true })).toBe('Yaklaşık 1 km');
  });
});

describe('Portföy', () => {
  const allConsents = Object.fromEntries(PORTFOLIO_CONSENTS.map((c) => [c.key, true]));

  it('refuses to save without every consent box', () => {
    const draft = {
      title: 'Klima montajı',
      description: '',
      categoryId: null,
      uploadIds: [UPLOAD_ID],
      consents: { ...allConsents, permission: false },
    };
    expect(buildPortfolioItem(draft)).toMatchObject({ ok: false });
    expect(buildPortfolioItem({ ...draft, consents: allConsents })).toEqual({
      ok: true,
      body: {
        title: 'Klima montajı',
        description: null,
        categoryId: null,
        uploadIds: [UPLOAD_ID],
        consentConfirmed: true,
      },
    });
  });

  it('keeps "Kaydet" disabled until the checklist is complete', async () => {
    jest.mocked(pickImage).mockResolvedValue({
      uri: 'file:///a.jpg',
      mimeType: 'image/jpeg',
      blob: {} as Blob,
    });
    jest.mocked(uploadImage).mockResolvedValue(UPLOAD_ID);
    v2.createPortfolioItem.mockResolvedValue({} as never);
    const onSaved = jest.fn();
    await render(
      <PortfolioForm services={[]} editing={null} onSaved={onSaved} onCancel={jest.fn()} />,
    );
    await fireEvent.changeText(screen.getByTestId('portfolio-title'), 'Klima montajı');
    await fireEvent.press(screen.getByTestId('portfolio-add-photo'));
    await waitFor(() => expect(screen.getByLabelText('Fotoğraf 1')).toBeTruthy());

    const save = screen.getByTestId('portfolio-save');
    expect(save.props.accessibilityState.disabled).toBe(true);
    for (const c of PORTFOLIO_CONSENTS.slice(0, -1)) {
      await fireEvent.press(screen.getByTestId(`consent-${c.key}`));
    }
    expect(screen.getByTestId('portfolio-save').props.accessibilityState.disabled).toBe(true);
    const last = PORTFOLIO_CONSENTS[PORTFOLIO_CONSENTS.length - 1];
    await fireEvent.press(screen.getByTestId(`consent-${last?.key}`));
    expect(screen.getByTestId('portfolio-save').props.accessibilityState.disabled).toBe(false);

    await fireEvent.press(screen.getByTestId('portfolio-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(v2.createPortfolioItem).toHaveBeenCalledWith(
      expect.objectContaining({ uploadIds: [UPLOAD_ID], consentConfirmed: true }),
    );
  });

  it('moves items up and down for accessible reordering', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('Tarih girişi', () => {
  it('reads GG.AA.YYYY in Türkiye saati and refuses impossible dates', () => {
    expect(parseTrDate('01.10.2026')).toBe('2026-10-01T00:00:00+03:00');
    expect(parseTrDate('30.02.2026')).toBeNull();
  });
});
