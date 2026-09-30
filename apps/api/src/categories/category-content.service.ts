import { Inject, Injectable } from '@nestjs/common';
import type { CategoryAnswerSnapshot, CategoryQuestion, RequestForm } from '@ustago/types';
import {
  type CreateCategoryAlias,
  type CreateCategoryQuestion,
  MAX_CATEGORY_ALIASES,
  MAX_CATEGORY_QUESTIONS,
  MAX_REQUEST_PHOTOS,
  normalizeSearchText,
  type UpdateCategoryQuestion,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { conflict, notFound, unprocessable } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { Prisma, type CategoryQuestion as QuestionRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type CategoryQuestionRow,
  parseQuestionOptions,
  validateCategoryAnswers,
} from './domain/category-answers.js';

const categoryNotFound = () => notFound('CATEGORY_NOT_FOUND', 'Kategori bulunamadı.');
const questionNotFound = () => notFound('QUESTION_NOT_FOUND', 'Soru bulunamadı.');
const aliasNotFound = () => notFound('ALIAS_NOT_FOUND', 'Eş anlamlı bulunamadı.');
const invalidQuestion = (message: string) => unprocessable('INVALID_QUESTION', message);
const aliasTaken = () => conflict('ALIAS_TAKEN', 'Bu arama kelimesi zaten bir kategoriye bağlı.');

const QUESTION_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as const;

const isSelect = (type: string) => type === 'SINGLE_SELECT' || type === 'MULTI_SELECT';

export function toCategoryQuestion(q: QuestionRow): CategoryQuestion {
  return {
    id: q.id,
    key: q.key,
    label: q.label,
    helpText: q.helpText,
    type: q.type,
    options: isSelect(q.type) ? parseQuestionOptions(q.options) : [],
    required: q.required,
    minValue: q.minValue,
    maxValue: q.maxValue,
    sortOrder: q.sortOrder,
    isActive: q.isActive,
  };
}

/**
 * Admin-managed category content (Faz 7, docs/adr/0028): request-form
 * questions (never hard-deleted: `isActive=false`; key and type never
 * change, so published answers keep their meaning), search aliases, and
 * the public request form. Every admin change is audited.
 */
@Injectable()
export class CategoryContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // -- Public request form --------------------------------------------------

  async requestForm(categoryId: string): Promise<RequestForm> {
    const category = await this.prisma.serviceCategory.findFirst({
      where: {
        id: categoryId,
        isActive: true,
        OR: [{ parentId: null }, { parent: { isActive: true } }],
      },
      include: { questions: { where: { isActive: true }, orderBy: [...QUESTION_ORDER] } },
    });
    if (!category) throw categoryNotFound();
    return {
      category: {
        id: category.id,
        slug: category.slug,
        name: category.name,
        icon: category.icon,
      },
      photoPolicy: category.requestPhotoPolicy,
      maxPhotos: MAX_REQUEST_PHOTOS,
      maxPhotoBytes: this.env.REQUEST_PHOTO_MAX_BYTES,
      supportsNow: category.supportsNow,
      questions: category.questions.map(toCategoryQuestion),
    };
  }

  /** Active questions of a category, ready for `validateCategoryAnswers`. */
  activeQuestions(
    categoryId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<CategoryQuestionRow[]> {
    return tx.categoryQuestion.findMany({
      where: { categoryId, isActive: true },
      orderBy: [...QUESTION_ORDER],
    });
  }

  /**
   * Validates answers against the category's live questions. Returns the
   * snapshot to store with the request; throws 422 INVALID_ANSWERS with
   * `details.errors` ([{ key, code, message }]) otherwise.
   */
  async validateAnswers(
    categoryId: string,
    answers: Readonly<Record<string, unknown>> | null | undefined,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<CategoryAnswerSnapshot[]> {
    const result = validateCategoryAnswers(await this.activeQuestions(categoryId, tx), answers);
    if (!result.ok) {
      throw unprocessable('INVALID_ANSWERS', 'Soruların cevaplarını kontrol edin.', {
        errors: result.errors,
      });
    }
    return result.snapshot;
  }

  // -- Admin: questions -----------------------------------------------------

  async listQuestions(categoryId: string): Promise<CategoryQuestion[]> {
    await this.requireCategory(categoryId);
    const rows = await this.prisma.categoryQuestion.findMany({
      where: { categoryId },
      orderBy: [...QUESTION_ORDER],
    });
    return rows.map(toCategoryQuestion);
  }

  async createQuestion(
    actorId: string,
    categoryId: string,
    input: CreateCategoryQuestion,
    ipAddress: string | null,
  ): Promise<CategoryQuestion> {
    await this.requireCategory(categoryId);
    checkRangeFitsType(input.type, input.minValue ?? null, input.maxValue ?? null);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM service_categories WHERE id = ${categoryId}::uuid FOR UPDATE`;
        await this.checkActiveLimit(tx, categoryId);
        const created = await tx.categoryQuestion.create({
          data: {
            categoryId,
            key: input.key,
            label: input.label,
            helpText: input.helpText ?? null,
            type: input.type,
            options: isSelect(input.type) ? (input.options ?? []) : Prisma.DbNull,
            required: input.required,
            minValue: input.type === 'NUMBER' ? (input.minValue ?? null) : null,
            maxValue: input.type === 'NUMBER' ? (input.maxValue ?? null) : null,
            sortOrder: input.sortOrder,
          },
        });
        await this.audit.recordIn(tx, {
          action: 'category.question_created',
          actorId,
          entityType: 'category_question',
          entityId: created.id,
          ipAddress,
          metadata: { categoryId, key: created.key, type: created.type },
        });
        return created;
      });
      return toCategoryQuestion(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('QUESTION_KEY_TAKEN', 'Bu kategoride aynı anahtarla bir soru var.');
      }
      throw error;
    }
  }

  async updateQuestion(
    actorId: string,
    id: string,
    input: UpdateCategoryQuestion,
    ipAddress: string | null,
  ): Promise<CategoryQuestion> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.categoryQuestion.findUnique({ where: { id } });
      if (!current) throw questionNotFound();
      await tx.$queryRaw`SELECT id FROM service_categories WHERE id = ${current.categoryId}::uuid FOR UPDATE`;

      if (input.options !== undefined) {
        if (!isSelect(current.type)) {
          if (input.options.length > 0) throw invalidQuestion('Bu soru türü seçenek almaz.');
        } else {
          const values = input.options.map((o) => o.value);
          if (values.length < 2 || new Set(values).size !== values.length) {
            throw invalidQuestion('Seçmeli sorular en az iki farklı seçenek ister.');
          }
        }
      }
      const minValue = input.minValue === undefined ? current.minValue : input.minValue;
      const maxValue = input.maxValue === undefined ? current.maxValue : input.maxValue;
      checkRangeFitsType(current.type, minValue, maxValue);
      if (input.isActive === true && !current.isActive) {
        await this.checkActiveLimit(tx, current.categoryId);
      }

      const updated = await tx.categoryQuestion.update({
        where: { id },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.helpText !== undefined ? { helpText: input.helpText } : {}),
          ...(input.options !== undefined && isSelect(current.type)
            ? { options: input.options }
            : {}),
          ...(input.required !== undefined ? { required: input.required } : {}),
          ...(input.minValue !== undefined ? { minValue: input.minValue } : {}),
          ...(input.maxValue !== undefined ? { maxValue: input.maxValue } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await this.audit.recordIn(tx, {
        action: 'category.question_updated',
        actorId,
        entityType: 'category_question',
        entityId: id,
        ipAddress,
        metadata: {
          categoryId: current.categoryId,
          key: current.key,
          changed: Object.keys(input),
          previous: {
            label: current.label,
            required: current.required,
            isActive: current.isActive,
            sortOrder: current.sortOrder,
          },
        },
      });
      return updated;
    });
    return toCategoryQuestion(row);
  }

  // -- Admin: aliases -------------------------------------------------------

  async listAliases(categoryId: string): Promise<{ id: string; alias: string }[]> {
    await this.requireCategory(categoryId);
    const rows = await this.prisma.categoryAlias.findMany({
      where: { categoryId },
      orderBy: [{ alias: 'asc' }, { id: 'asc' }],
      select: { id: true, alias: true },
    });
    return rows;
  }

  async createAlias(
    actorId: string,
    categoryId: string,
    input: CreateCategoryAlias,
    ipAddress: string | null,
  ): Promise<{ id: string; alias: string }> {
    await this.requireCategory(categoryId);
    const normalized = normalizeSearchText(input.alias);
    if (normalized.length < 2) {
      throw unprocessable('INVALID_ALIAS', 'Arama kelimesi en az iki harf veya rakam içermeli.');
    }
    const categories = await this.prisma.serviceCategory.findMany({
      select: { id: true, name: true },
    });
    const sameName = categories.find((c) => normalizeSearchText(c.name) === normalized);
    if (sameName) {
      throw conflict(
        'ALIAS_MATCHES_CATEGORY_NAME',
        sameName.id === categoryId
          ? 'Kategori adı zaten aranıyor; eş anlamlı olarak eklenmez.'
          : 'Bu kelime başka bir kategorinin adı.',
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM service_categories WHERE id = ${categoryId}::uuid FOR UPDATE`;
        const count = await tx.categoryAlias.count({ where: { categoryId } });
        if (count >= MAX_CATEGORY_ALIASES) {
          throw unprocessable(
            'ALIAS_LIMIT_REACHED',
            `Bir kategoride en fazla ${MAX_CATEGORY_ALIASES} eş anlamlı olabilir.`,
          );
        }
        if (await tx.categoryAlias.findUnique({ where: { normalized } })) throw aliasTaken();
        const alias = await tx.categoryAlias.create({
          data: { categoryId, alias: input.alias, normalized },
          select: { id: true, alias: true },
        });
        await this.audit.recordIn(tx, {
          action: 'category.alias_created',
          actorId,
          entityType: 'category_alias',
          entityId: alias.id,
          ipAddress,
          metadata: { categoryId, alias: alias.alias, normalized },
        });
        return alias;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw aliasTaken();
      }
      throw error;
    }
  }

  async deleteAlias(actorId: string, id: string, ipAddress: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const alias = await tx.categoryAlias.findUnique({ where: { id } });
      if (!alias) throw aliasNotFound();
      await tx.categoryAlias.delete({ where: { id } });
      await this.audit.recordIn(tx, {
        action: 'category.alias_deleted',
        actorId,
        entityType: 'category_alias',
        entityId: id,
        ipAddress,
        metadata: { categoryId: alias.categoryId, alias: alias.alias },
      });
    });
  }

  private async requireCategory(categoryId: string): Promise<void> {
    const found = await this.prisma.serviceCategory.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!found) throw categoryNotFound();
  }

  private async checkActiveLimit(tx: Prisma.TransactionClient, categoryId: string) {
    const active = await tx.categoryQuestion.count({ where: { categoryId, isActive: true } });
    if (active >= MAX_CATEGORY_QUESTIONS) {
      throw unprocessable(
        'QUESTION_LIMIT_REACHED',
        `Bir kategoride en fazla ${MAX_CATEGORY_QUESTIONS} etkin soru olabilir.`,
      );
    }
  }
}

/** Only NUMBER questions carry a range, and min ≤ max. */
function checkRangeFitsType(type: string, minValue: number | null, maxValue: number | null) {
  if (type !== 'NUMBER' && (minValue !== null || maxValue !== null)) {
    throw invalidQuestion('En küçük/en büyük değer yalnızca sayı sorularında kullanılır.');
  }
  if (minValue !== null && maxValue !== null && minValue > maxValue) {
    throw invalidQuestion('En büyük değer en küçükten küçük olamaz.');
  }
}
