import { type CanActivate, Inject, Injectable } from '@nestjs/common';

import { notFound } from '../common/http/errors.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';

/**
 * Fail-closed switch for the development-only finance routes (mock
 * payment decision, "mark test payout paid"). Outside development with
 * the mock providers they answer 404 as if they did not exist; production
 * refuses to boot with the mock providers in the first place.
 */
@Injectable()
export class DevFinanceGuard implements CanActivate {
  constructor(@Inject(FINANCE_CONFIG) private readonly config: FinanceConfig) {}

  canActivate(): boolean {
    if (!this.config.devRoutesEnabled) throw notFound('ROUTE_NOT_FOUND', 'Kaynak bulunamadı.');
    return true;
  }
}
