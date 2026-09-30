import { Global, Module } from '@nestjs/common';

import { AvailabilityEvaluator } from './availability-evaluator.js';

@Global()
@Module({
  providers: [AvailabilityEvaluator],
  exports: [AvailabilityEvaluator],
})
export class AvailabilityModule {}
