import { normalizeSearchText } from '@ustago/validation';

import type { CategoryQuestionType, PrismaClient } from '../generated/prisma/client.js';

/**
 * Starting search aliases and request-form questions for the seeded
 * categories (Faz 7, docs/adr/0028). Safe in every environment: only
 * inserts what is missing (createMany + skipDuplicates on the unique keys),
 * never updates or deletes, so admin edits always win. Categories that do
 * not exist (renamed or removed slugs) are skipped. An alias that equals a
 * category name or is already bound elsewhere is skipped too.
 */
export const CATEGORY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  elektrik: ['elektrikçi', 'elektrik ustası', 'sigorta attı', 'priz', 'aydınlatma'],
  'su-tesisati': ['tesisatçı', 'su kaçağı', 'musluk', 'tıkanıklık', 'sıhhi tesisat'],
  klima: ['klimacı', 'klima servisi', 'klima montajı', 'klima bakımı'],
  cilingir: ['kapı açma', 'anahtarcı', 'kilit değişimi'],
  'beyaz-esya': ['çamaşır makinesi', 'bulaşık makinesi', 'buzdolabı', 'beyaz eşya servisi'],
  'boya-badana': ['boyacı', 'badana', 'duvar boyama'],
  temizlik: ['ev temizliği', 'temizlikçi', 'ofis temizliği'],
  montaj: ['mobilya montajı', 'tv montajı', 'perde montajı'],
};

interface QuestionSeed {
  key: string;
  label: string;
  helpText?: string;
  type: CategoryQuestionType;
  options?: { value: string; label: string }[];
  required?: boolean;
  minValue?: number;
  maxValue?: number;
}

export const CATEGORY_QUESTIONS: Readonly<Record<string, readonly QuestionSeed[]>> = {
  elektrik: [
    {
      key: 'problem',
      label: 'Sorun ne?',
      type: 'SINGLE_SELECT',
      required: true,
      options: [
        { value: 'power_out', label: 'Tamamen elektrik yok' },
        { value: 'socket_switch', label: 'Priz/anahtar arızası' },
        { value: 'breaker_trips', label: 'Sigorta atıyor' },
        { value: 'lighting_install', label: 'Aydınlatma montajı' },
        { value: 'other', label: 'Diğer' },
      ],
    },
    { key: 'urgent', label: 'Acil mi?', type: 'BOOLEAN' },
  ],
  'su-tesisati': [
    {
      key: 'problem',
      label: 'Sorun ne?',
      type: 'SINGLE_SELECT',
      required: true,
      options: [
        { value: 'leak', label: 'Su kaçağı' },
        { value: 'clog', label: 'Tıkanıklık' },
        { value: 'faucet', label: 'Musluk / batarya' },
        { value: 'new_install', label: 'Yeni tesisat' },
        { value: 'other', label: 'Diğer' },
      ],
    },
    { key: 'main_valve_closed', label: 'Ana vana kapatılabildi mi?', type: 'BOOLEAN' },
  ],
  klima: [
    {
      key: 'service',
      label: 'Ne yapılacak?',
      type: 'SINGLE_SELECT',
      required: true,
      options: [
        { value: 'install', label: 'Montaj' },
        { value: 'maintenance', label: 'Bakım / temizlik' },
        { value: 'repair', label: 'Arıza' },
        { value: 'uninstall', label: 'Söküm' },
      ],
    },
    { key: 'unit_count', label: 'Kaç cihaz?', type: 'NUMBER', minValue: 1, maxValue: 20 },
  ],
  cilingir: [
    {
      key: 'situation',
      label: 'Durum ne?',
      type: 'SINGLE_SELECT',
      required: true,
      options: [
        { value: 'locked_out', label: 'Kapıda kaldım' },
        { value: 'lock_change', label: 'Kilit değişimi' },
        { value: 'steel_door', label: 'Çelik kapı / kasa' },
        { value: 'other', label: 'Diğer' },
      ],
    },
  ],
  'boya-badana': [
    { key: 'rooms', label: 'Kaç oda?', type: 'NUMBER', minValue: 1, maxValue: 20 },
    { key: 'paint_supplied', label: 'Boya malzemesi sizde mi?', type: 'BOOLEAN' },
  ],
};

export async function seedCategoryContent(
  prisma: PrismaClient,
): Promise<{ aliases: number; questions: number }> {
  const categories = await prisma.serviceCategory.findMany({
    select: { id: true, slug: true, name: true },
  });
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const names = new Set(categories.map((c) => normalizeSearchText(c.name)));

  const aliasRows = Object.entries(CATEGORY_ALIASES).flatMap(([slug, aliases]) => {
    const categoryId = bySlug.get(slug);
    if (!categoryId) return [];
    return aliases.flatMap((alias) => {
      const normalized = normalizeSearchText(alias);
      return normalized.length < 2 || names.has(normalized)
        ? []
        : [{ categoryId, alias, normalized }];
    });
  });
  const aliases = await prisma.categoryAlias.createMany({ data: aliasRows, skipDuplicates: true });

  const questionRows = Object.entries(CATEGORY_QUESTIONS).flatMap(([slug, questions]) => {
    const categoryId = bySlug.get(slug);
    if (!categoryId) return [];
    return questions.map((q, index) => ({
      categoryId,
      key: q.key,
      label: q.label,
      helpText: q.helpText ?? null,
      type: q.type,
      ...(q.options ? { options: q.options } : {}),
      required: q.required ?? false,
      minValue: q.minValue ?? null,
      maxValue: q.maxValue ?? null,
      sortOrder: index * 10,
    }));
  });
  const questions = await prisma.categoryQuestion.createMany({
    data: questionRows,
    skipDuplicates: true,
  });

  return { aliases: aliases.count, questions: questions.count };
}
