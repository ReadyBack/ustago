import { Module } from '@nestjs/common';

import { AddressesModule } from './addresses/addresses.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ConfigModule } from './config/config.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { MatchingModule } from './matching/matching.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OpsCoreModule } from './ops/ops-core.module.js';
import { OpsModule } from './ops/ops.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { PushModule } from './push/push.module.js';
import { QualityModule } from './quality/quality.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { SecurityModule } from './security/security.module.js';
import { ServiceRequestsModule } from './service-requests/service-requests.module.js';
import { SmsModule } from './sms/sms.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    OpsCoreModule,
    SecurityModule,
    QualityModule,
    PushModule,
    RateLimitModule,
    SmsModule,
    StorageModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProvidersModule,
    CategoriesModule,
    LocationsModule,
    AddressesModule,
    AdminModule,
    MatchingModule,
    NotificationsModule,
    ServiceRequestsModule,
    JobsModule,
    FinanceModule,
    QuotesModule,
    ReviewsModule,
    OpsModule,
  ],
})
export class AppModule {}
