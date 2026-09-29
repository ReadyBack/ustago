import { BadRequestException } from '@nestjs/common';
import { moneySchema } from '@ustago/validation';

import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(moneySchema);

  it('returns parsed data', () => {
    expect(pipe.transform({ amountMinor: 100, currency: 'TRY' })).toEqual({
      amountMinor: 100,
      currency: 'TRY',
    });
  });

  it('throws VALIDATION_FAILED with issue details', () => {
    try {
      pipe.transform({ amountMinor: 1.5, currency: 'TRY' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as { code: string };
      expect(body.code).toBe('VALIDATION_FAILED');
    }
  });
});
