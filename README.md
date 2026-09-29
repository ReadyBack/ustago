# UstaGO

Mobil öncelikli yerel hizmet pazaryeri ve usta işletme platformu.
Ürün ve teknik tanım: [PROJECT.md](PROJECT.md). Mimari kararlar: [docs/adr](docs/adr/README.md).

> **Durum:** Faz 0 (repository ve standartlar). Ürün özellikleri henüz yok.

## Yapı

```text
apps/
  api/      NestJS 12 API (Prisma 7 + PostgreSQL, Redis)   → http://localhost:3000/api/v1
  admin/    Next.js 16 admin paneli                         → http://localhost:3001
  mobile/   Expo SDK 57 (React Native) uygulaması
packages/
  config/         Ortam değişkeni şemaları (Zod)
  types/          Paylaşılan TypeScript tipleri
  validation/     Paylaşılan Zod şemaları
  ui/             Tasarım tokenları
  eslint-config/  Ortak ESLint ayarları
  tsconfig/       Ortak TypeScript ayarları (strict)
infrastructure/   Docker ve yardımcı betikler
docs/             ADR, mimari, ürün ve API dokümanları
```

## Gereksinimler

- Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable` yeterli)
- Docker (PostgreSQL ve Redis için)
- Mobil için: telefonda Expo Go veya Android/iOS emülatörü

## Lokal kurulum

```bash
# 1. Bağımlılıklar (Prisma istemcisi de üretilir)
corepack enable
pnpm install

# 2. Ortam değişkenleri
cp .env.example .env
cp apps/admin/.env.example apps/admin/.env.local    # isteğe bağlı
cp apps/mobile/.env.example apps/mobile/.env        # isteğe bağlı

# 3. PostgreSQL + Redis
pnpm db:up

# 4. Paylaşılan paketleri derle ve uygulamaları başlat
pnpm build --filter "./packages/*"
pnpm dev
```

`pnpm dev` API'yi (3000), admin'i (3001) ve Expo'yu birlikte başlatır. Tek tek çalıştırmak için:

```bash
pnpm --filter @ustago/api dev
pnpm --filter @ustago/admin dev
pnpm --filter @ustago/mobile dev
```

Kontrol:

- API sağlığı: http://localhost:3000/api/v1/health (veya `infrastructure/scripts/check-services.sh`)
- Swagger: http://localhost:3000/api/docs
- Admin: http://localhost:3001 (API durumunu gösterir)
- Mobil: terminaldeki QR kodu Expo Go ile okutun. Fiziksel cihazda `EXPO_PUBLIC_API_URL` için
  bilgisayarın yerel IP'sini kullanın.

## Komutlar

| Komut                               | Açıklama                                                              |
| ----------------------------------- | --------------------------------------------------------------------- |
| `pnpm lint`                         | Tüm paketlerde ESLint                                                 |
| `pnpm typecheck`                    | Tüm paketlerde TypeScript (strict)                                    |
| `pnpm test`                         | Birim ve smoke testleri (Docker gerekmez)                             |
| `pnpm test:e2e`                     | API'yi gerçek PostgreSQL + Redis ile test eder (`pnpm db:up` gerekir) |
| `pnpm format` / `pnpm format:check` | Prettier                                                              |
| `pnpm build`                        | Tüm paketleri ve uygulamaları derler                                  |
| `pnpm db:up` / `pnpm db:down`       | Docker servislerini başlatır / durdurur                               |
| `pnpm db:generate`                  | Prisma istemcisini üretir                                             |
| `pnpm db:migrate`                   | Prisma migration oluşturur ve uygular (geliştirme)                    |

## Kurallar (özet)

Tam liste: PROJECT.md §31.

- TypeScript `strict`, `any` yasak (ESLint hatası).
- Input doğrulaması backend'de zorunlu; şemalar `@ustago/validation` içinde.
- Para her zaman `amount_minor` tamsayı + `currency`; tarih veritabanında UTC.
- Secret koda yazılmaz; yeni değişken hem şemaya hem `.env.example`'a eklenir.
- Her fazın sonunda `pnpm lint && pnpm typecheck && pnpm test`.

## CI

`.github/workflows/ci.yml`: install → format check → lint → typecheck → test → API e2e
(GitHub Actions servis konteynerlerinde PostgreSQL + Redis).
