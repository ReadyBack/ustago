import { Module } from '@nestjs/common';

import { ProvidersController } from './providers.controller.js';
import { ProvidersService } from './providers.service.js';

@Module({
  controllers: [ProvidersController],
  providers: [ProvidersService],
})
export class ProvidersModule {}
