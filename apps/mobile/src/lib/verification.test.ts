import { documentFixture, verificationCaseFixture } from '../test/fixtures';
import {
  ACCOUNT_STATUS,
  accountNotice,
  canContinue,
  documentFileError,
  documentStateLabel,
  extraRequirements,
  identityRequirement,
  initialStep,
  MAX_DOCUMENT_BYTES,
  missingBasics,
  nextStep,
  previousStep,
  rejectedDocuments,
  uploadProgress,
  VERIFICATION_STATUS,
} from './verification';

describe('status labels', () => {
  it('labels every verification and account status', () => {
    expect(VERIFICATION_STATUS.NEEDS_REVISION).toEqual({
      label: 'Düzeltme istendi',
      tone: 'danger',
    });
    expect(VERIFICATION_STATUS.VERIFIED.tone).toBe('success');
    expect(ACCOUNT_STATUS.SUSPENDED).toEqual({ label: 'Hesap askıda', tone: 'danger' });
    expect(ACCOUNT_STATUS.LIMITED.tone).toBe('warning');
  });

  it('describes a document on file', () => {
    expect(documentStateLabel(null).label).toBe('Yüklenmedi');
    expect(documentStateLabel(documentFixture('IDENTITY')).label).toBe('İnceleniyor');
    expect(documentStateLabel(documentFixture('IDENTITY', { status: 'REJECTED' }))).toEqual({
      label: 'Reddedildi',
      tone: 'danger',
    });
  });
});

describe('steps', () => {
  it('starts at the intro, or on the status page once the case is sent', () => {
    expect(initialStep(verificationCaseFixture())).toBe(1);
    expect(initialStep(verificationCaseFixture({ status: 'NEEDS_REVISION' }))).toBe(1);
    expect(initialStep(verificationCaseFixture({ status: 'UNDER_REVIEW' }))).toBe(5);
    expect(initialStep(verificationCaseFixture({ status: 'VERIFIED' }))).toBe(5);
    expect(initialStep(verificationCaseFixture({ canEditDocuments: false }))).toBe(5);
  });

  it('needs the identity document before the extras', () => {
    const empty = verificationCaseFixture();
    expect(canContinue(1, empty)).toBe(true);
    expect(canContinue(2, empty)).toBe(false);
    const withId = verificationCaseFixture({
      documents: [
        { type: 'IDENTITY', required: true, reason: '', current: documentFixture('IDENTITY') },
      ],
    });
    expect(canContinue(2, withId)).toBe(true);
    const rejected = verificationCaseFixture({
      documents: [
        {
          type: 'IDENTITY',
          required: true,
          reason: '',
          current: documentFixture('IDENTITY', { status: 'REJECTED' }),
        },
      ],
    });
    expect(canContinue(2, rejected)).toBe(false);
  });

  it('needs every required document before the review, and canSubmit to send', () => {
    const view = verificationCaseFixture({
      documents: [
        { type: 'IDENTITY', required: true, reason: '', current: documentFixture('IDENTITY') },
        { type: 'BUSINESS_LICENSE', required: true, reason: '', current: null },
        { type: 'OTHER', required: false, reason: '', current: null },
      ],
    });
    expect(canContinue(3, view)).toBe(false);
    expect(canContinue(4, view)).toBe(false);
    expect(canContinue(4, verificationCaseFixture({ canSubmit: true }))).toBe(true);
    expect(canContinue(5, verificationCaseFixture({ canSubmit: true }))).toBe(false);
  });

  it('cannot start when documents may not be edited', () => {
    expect(canContinue(1, verificationCaseFixture({ canEditDocuments: false }))).toBe(false);
  });

  it('moves between steps', () => {
    expect(nextStep(1)).toBe(2);
    expect(nextStep(5)).toBe(5);
    expect(previousStep(1)).toBeNull();
    expect(previousStep(3)).toBe(2);
    expect(previousStep(5)).toBeNull();
  });

  it('splits identity from the other documents and finds rejected ones', () => {
    const view = verificationCaseFixture({
      documents: [
        { type: 'IDENTITY', required: true, reason: '', current: documentFixture('IDENTITY') },
        {
          type: 'TAX_REGISTRATION',
          required: true,
          reason: '',
          current: documentFixture('TAX_REGISTRATION', {
            status: 'REJECTED',
            rejectionReason: 'Belge okunmuyor',
          }),
        },
      ],
    });
    expect(identityRequirement(view)?.type).toBe('IDENTITY');
    expect(extraRequirements(view).map((d) => d.type)).toEqual(['TAX_REGISTRATION']);
    expect(rejectedDocuments(view).map((d) => d.type)).toEqual(['TAX_REGISTRATION']);
  });

  it('lists missing profile steps, not documents', () => {
    const view = verificationCaseFixture({
      checklist: [
        { key: 'PROFILE', label: 'Profil bilgileri', done: false },
        { key: 'SERVICES', label: 'Hizmet kategorileri', done: true },
        { key: 'SERVICE_AREAS', label: 'Hizmet bölgeleri', done: false },
        { key: 'DOCUMENTS', label: 'Zorunlu belgeler', done: false },
        { key: 'SUBMIT', label: 'İncelemeye gönder', done: false },
      ],
    });
    expect(missingBasics(view)).toEqual(['Profil bilgileri', 'Hizmet bölgeleri']);
  });
});

describe('accountNotice', () => {
  it('is empty while the account is active', () => {
    expect(accountNotice(verificationCaseFixture())).toBeNull();
  });

  it('explains a suspension with its reason and end date', () => {
    const notice = accountNotice(
      verificationCaseFixture({
        accountStatus: 'SUSPENDED',
        activeSuspension: {
          id: 's1',
          level: 'SUSPENDED',
          status: 'ACTIVE',
          reasonCode: 'NO_SHOW',
          userVisibleReason: 'Tekrarlanan randevu kaçırma',
          startsAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2026-10-01T00:00:00.000Z',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      }),
    );
    expect(notice?.tone).toBe('danger');
    expect(notice?.body).toContain('teklif veremez');
    expect(notice?.reason).toBe('Tekrarlanan randevu kaçırma');
    expect(notice?.until).toBe('2026-10-01T00:00:00.000Z');
  });

  it('covers limited and banned accounts', () => {
    expect(accountNotice(verificationCaseFixture({ accountStatus: 'LIMITED' }))?.tone).toBe(
      'warning',
    );
    expect(accountNotice(verificationCaseFixture({ accountStatus: 'BANNED' }))?.title).toBe(
      'Hesabınız kapatıldı',
    );
  });
});

describe('uploads', () => {
  it('accepts JPEG, PNG and PDF up to 10 MB', () => {
    expect(documentFileError('image/jpeg', 1000)).toBeNull();
    expect(documentFileError('application/pdf', MAX_DOCUMENT_BYTES)).toBeNull();
    expect(documentFileError('image/svg+xml', 1000)).toMatch(/JPEG, PNG veya PDF/);
    expect(documentFileError(null, 1000)).toMatch(/JPEG, PNG veya PDF/);
    expect(documentFileError('image/png', MAX_DOCUMENT_BYTES + 1)).toMatch(/10 MB/);
    expect(documentFileError('image/png', 0)).toMatch(/boş/);
  });

  it('shows increasing progress through the stages', () => {
    const values = (['preparing', 'uploading', 'confirming', 'done'] as const).map(
      (s) => uploadProgress(s).value,
    );
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(uploadProgress('done').value).toBe(1);
    expect(uploadProgress('failed').label).toBe('Yükleme başarısız');
  });
});
