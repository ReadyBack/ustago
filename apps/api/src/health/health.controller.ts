import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@ustago/types';
import type { Response } from 'express';

import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Readiness: checks the database and Redis. */
  @Get()
  @ApiOkResponse({ description: 'API is ready (Redis may be degraded).' })
  @ApiServiceUnavailableResponse({ description: 'Database is unreachable.' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.health.check();
    if (result.status === 'down') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  /** Liveness: the process is up, no dependency checks. */
  @Get('live')
  @ApiOkResponse({ description: 'Process is alive.' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
