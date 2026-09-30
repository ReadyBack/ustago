import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Job, JobListItem, Paginated } from '@ustago/types';
import {
  apiErrorResponseSchema,
  jobListItemSchema,
  jobSchema,
  type ListJobsQuery,
  listJobsQuerySchema,
  paginatedSchema,
  uuidSchema,
} from '@ustago/validation';

import { type AuthUser, CurrentUser } from '../common/auth/decorators.js';
import { ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { JobsService } from './jobs.service.js';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @ApiOperation({
    summary: 'Çağıranın işleri. role=CUSTOMER aldığı, role=PROVIDER verdiği hizmetler.',
  })
  @ApiZodResponse(200, paginatedSchema(jobListItemSchema))
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listJobsQuerySchema)) query: ListJobsQuery,
  ): Promise<Paginated<JobListItem>> {
    return this.jobs.list(user.id, query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'İş detayı: yalnızca işin müşterisi ve ustası görür. Anlaşma sonrası tam adres ve iletişim açılır.',
  })
  @ApiZodResponse(200, jobSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'JOB_NOT_FOUND (başkasının işi dahil)')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<Job> {
    return this.jobs.get(user.id, id);
  }
}
