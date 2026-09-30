import { Global, Module } from '@nestjs/common';

import { DISTANCE_CALCULATOR, HaversineDistanceCalculator } from './distance.js';
import { GeoService } from './geo.service.js';

@Global()
@Module({
  providers: [
    { provide: DISTANCE_CALCULATOR, useValue: new HaversineDistanceCalculator() },
    GeoService,
  ],
  exports: [GeoService, DISTANCE_CALCULATOR],
})
export class GeoModule {}
