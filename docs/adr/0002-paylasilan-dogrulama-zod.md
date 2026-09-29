# ADR-0002: Paylaşılan doğrulama için Zod

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

Backend'de input doğrulaması zorunludur (PROJECT.md §31.6). Aynı kurallar mobil ve admin
formlarında da gereklidir. NestJS'in klasik `class-validator` yaklaşımı sınıf/decorator
tabanlıdır ve React Native ile paylaşılması zordur.

## Karar

- Şemalar `@ustago/validation` paketinde **Zod 4** ile yazılır; her şema `@ustago/types`
  tipini `satisfies` ile karşılar.
- API tarafında `ZodValidationPipe` (apps/api/src/common/pipes) şemayı uygular ve
  `VALIDATION_FAILED` kodlu standart hata döner.
- `nestjs-zod` Faz 0 itibarıyla NestJS 12'yi desteklemediği için küçük bir yerel pipe kullanılır.
- Ortam değişkenleri de Zod ile doğrulanır (`@ustago/config`).

## Sonuçlar

- Tek şema; istemci ve sunucu aynı kuralı uygular.
- Swagger şemaları için Faz 1'de Zod → OpenAPI dönüşümü (ör. `z.toJSONSchema`) eklenmelidir.
