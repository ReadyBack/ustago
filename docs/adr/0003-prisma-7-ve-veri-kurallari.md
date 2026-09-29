# ADR-0003: Prisma 7, para ve zaman kuralları

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

PROJECT.md PostgreSQL + Prisma önerir. Prisma 7 driver adapter mimarisine geçmiştir.

## Karar

- Prisma 7, `prisma-client` generator'ı ve `@prisma/adapter-pg` ile kullanılır.
  Üretilen istemci `apps/api/src/generated/prisma` altındadır (git'e girmez, `postinstall`'da üretilir).
- Bağlantı ayarı `apps/api/prisma.config.ts` içindedir ve kök `.env`'i okur.
- Faz 0'da model yoktur; tablolar kendi fazlarında migration ile eklenir. Migration'lar commit edilir.
- **Para:** asla float değil; `amount_minor` (kuruş) tamsayı + `currency` (ör. `TRY`).
  Ayrıntılar: [ADR-0006](0006-para-saklama-stratejisi.md) (veritabanında `BigInt`).
- **Zaman:** veritabanında UTC; arayüz kullanıcının saat dilimine göre gösterir.
- **İsimlendirme:** tablolar `snake_case` (`@@map`), kodda `camelCase`.

## Sonuçlar

- Prisma sürümü RC değil, en son kararlı 7.x sürümüdür; 8.x kararlı olunca ayrı bir ADR ile değerlendirilir.
