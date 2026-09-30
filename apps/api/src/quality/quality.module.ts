import { Global, Module } from '@nestjs/common';

import { QualitySweepService } from './quality-sweep.service.js';
import { QualityRepository } from './quality.repository.js';
import { QualityService } from './quality.service.js';

@Global()
@Module({
  providers: [QualityRepository, QualityService, QualitySweepService],
  exports: [QualityService, QualityRepository],
})
export class QualityModule {}
