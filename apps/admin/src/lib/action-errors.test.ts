import { describe, expect, it } from 'vitest';

import { actionErrorMessage, FORBIDDEN_MESSAGE, VERSION_CONFLICT_MESSAGE } from './action-errors';
import { formText, isConfirmed, issueMessage } from './form-action';
import {
  ALERT_STATUS_LABELS,
  FEE_POLICY_LIFECYCLE_LABELS,
  JOB_STATUS_LABELS,
  labelOf,
  PROVIDER_VERIFICATION_STATUS_LABELS,
  VERIFICATION_CASE_FILTERS,
} from './labels';

describe('actionErrorMessage', () => {
  it('shows one clear Turkish message for any permission 403', () => {
    expect(
      actionErrorMessage({
        status: 403,
        code: 'ADMIN_PERMISSION_REQUIRED',
        message: 'Bu işlem için yönetici yetkiniz yok.',
      }),
    ).toBe('Bu işlem için yetkiniz yok.');
    expect(actionErrorMessage({ status: 403, code: 'FORBIDDEN', message: 'x' })).toBe(
      FORBIDDEN_MESSAGE,
    );
  });

  it('keeps a specific 403 explanation when the code is known', () => {
    expect(
      actionErrorMessage({ status: 403, code: 'ADMIN_SELF_PERMISSION_CHANGE', message: 'x' }),
    ).toMatch(/Kendi yetkilerinizi/);
  });

  it('maps the verification version conflict', () => {
    expect(
      actionErrorMessage({ status: 409, code: 'VERIFICATION_VERSION_CONFLICT', message: 'x' }),
    ).toBe(VERSION_CONFLICT_MESSAGE);
    expect(VERSION_CONFLICT_MESSAGE).toBe(
      'Kayıt başka biri tarafından güncellendi, sayfayı yenileyin.',
    );
  });

  it('falls back to the API message for unknown codes', () => {
    expect(actionErrorMessage({ status: 422, code: 'SOMETHING_NEW', message: 'API dedi' })).toBe(
      'API dedi',
    );
    expect(actionErrorMessage({ status: 409, code: 'toString', message: 'API dedi' })).toBe(
      'API dedi',
    );
  });
});

describe('form helpers', () => {
  it('reads text fields and the confirm box', () => {
    const form = new FormData();
    form.set('a', 'x');
    expect(formText(form, 'a')).toBe('x');
    expect(formText(form, 'missing')).toBe('');
    expect(isConfirmed(form)).toBe(false);
    form.set('confirm', 'on');
    expect(isConfirmed(form)).toBe(false);
    form.set('confirm', 'yes');
    expect(isConfirmed(form)).toBe(true);
  });

  it('picks a field message for the first issue', () => {
    const error = { issues: [{ message: 'Too small', path: ['note'] }] };
    expect(issueMessage(error, { note: 'Not kısa.' })).toBe('Not kısa.');
    expect(issueMessage(error)).toBe('Too small');
    expect(issueMessage({ issues: [] })).toBe('Geçersiz istek.');
  });
});

describe('Faz 6 labels', () => {
  it('labels every verification case filter', () => {
    for (const s of VERIFICATION_CASE_FILTERS) {
      expect(PROVIDER_VERIFICATION_STATUS_LABELS[s]).toBeTruthy();
    }
    expect(FEE_POLICY_LIFECYCLE_LABELS.SCHEDULED).toBe('Planlandı');
    expect(ALERT_STATUS_LABELS.ACTIVE).toBeTruthy();
  });

  it('labelOf shows unknown API values as-is', () => {
    expect(labelOf(JOB_STATUS_LABELS, 'COMPLETED')).toBe('Tamamlandı');
    expect(labelOf(JOB_STATUS_LABELS, 'NEW_STATUS')).toBe('NEW_STATUS');
    expect(labelOf(JOB_STATUS_LABELS, 'constructor')).toBe('constructor');
  });
});
