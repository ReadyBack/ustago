import { Module } from '@nestjs/common';

import { MatchingRepository } from './matching.repository.js';

@Module({
  providers: [MatchingRepository],
  exports: [MatchingRepository],
})
export class MatchingModule {}
