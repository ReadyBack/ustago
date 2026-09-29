import { describe, expectTypeOf, it } from 'vitest';

import type { Money } from './index.js';

describe('@ustago/types', () => {
  it('models money as integer minor units', () => {
    expectTypeOf<Money['amountMinor']>().toEqualTypeOf<number>();
    expectTypeOf<Money['currency']>().toEqualTypeOf<'TRY'>();
  });
});
