import { Module } from '@nestjs/common';

import { MatchingModule } from '../matching/matching.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RequestExpiryService } from './request-expiry.service.js';
import { RequestPhotosService } from './request-photos.service.js';
import { RequestStore } from './request.store.js';
import {
  MyServiceRequestsController,
  ServiceRequestsController,
} from './service-requests.controller.js';
import { ServiceRequestsService } from './service-requests.service.js';

@Module({
  imports: [MatchingModule, NotificationsModule],
  controllers: [ServiceRequestsController, MyServiceRequestsController],
  providers: [RequestStore, RequestPhotosService, ServiceRequestsService, RequestExpiryService],
  exports: [RequestStore, RequestExpiryService],
})
export class ServiceRequestsModule {}
