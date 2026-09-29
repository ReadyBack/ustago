import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module.js';
import { AdminProvidersController } from './admin-providers.controller.js';
import { AdminProvidersService } from './admin-providers.service.js';

@Module({
  imports: [ProvidersModule],
  controllers: [AdminProvidersController],
  providers: [AdminProvidersService],
})
export class AdminModule {}
