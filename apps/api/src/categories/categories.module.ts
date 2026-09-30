import { Module } from '@nestjs/common';

import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import {
  CategoryAdminController,
  CategoryContentController,
} from './category-content.controller.js';
import { CategoryContentService } from './category-content.service.js';
import { PriceGuideService } from './price-guide.service.js';

@Module({
  controllers: [CategoriesController, CategoryContentController, CategoryAdminController],
  providers: [CategoriesService, CategoryContentService, PriceGuideService],
  // CategoryContentService.validateAnswers(): used when a request is created.
  exports: [CategoryContentService, PriceGuideService],
})
export class CategoriesModule {}
