# UstaGO

Mobil öncelikli yerel hizmet pazaryeri ve usta işletme platformu.
Ürün ve teknik tanım: [PROJECT.md](PROJECT.md). Mimari kararlar: [docs/adr](docs/adr/README.md).

> **Durum:** Faz 2 tamamlandı: telefon + OTP girişi, 81 il / 973 ilçe, müşteri adresleri, usta
> onboarding ve belge doğrulama, admin inceleme paneli. Talep, teklif ve iş akışları (Faz 3+)
> henüz başlamadı.

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

## Lokal kurulum (yeni geliştirici)

```bash
# 1. Repository'yi klonla ve bağımlılıkları kur (Prisma istemcisi de üretilir)
git clone <repo-url> ustago && cd ustago
corepack enable
pnpm install

# 2. Ortam değişkenleri (tek .env kökte; git'e girmez)
cp .env.example .env
#    İsteğe bağlı: SEED_DEV_PASSWORD'e demo hesaplar için bir şifre yaz (en az 10 karakter).
cp apps/admin/.env.example apps/admin/.env.local    # isteğe bağlı
cp apps/mobile/.env.example apps/mobile/.env        # isteğe bağlı

# 3. PostgreSQL + Redis (Docker)
pnpm db:up

# 4. Migration'ları uygula
pnpm db:deploy          # mevcut migration'ları uygular
#    Şemayı değiştirdiysen yeni migration üret: pnpm db:migrate --name <degisiklik>

# 5. Seed: 81 il, 973 ilçe, kategoriler ve demo hesaplar
pnpm db:seed

# 6. Paylaşılan paketleri derle ve API'yi başlat
pnpm build --filter "./packages/*"
pnpm --filter @ustago/api dev       # veya hepsi birden: pnpm dev

# 7. Testler
pnpm test               # birim + smoke (Docker gerekmez)
pnpm test:e2e           # gerçek PostgreSQL + Redis (adım 3-4 gerekli)
```

Sıfırdan başlamak için `pnpm db:reset` veritabanını siler, migration'ları yeniden uygular ve seed'i
çalıştırır (yalnızca lokal).

### Demo hesaplar (yalnızca geliştirme)

`pnpm db:seed`, `NODE_ENV` `production` değilse üç demo hesap oluşturur. Adresler `.test` alan
adındadır, gerçek bir kutuya gidemez:

| E-posta               | Roller                | Not                                                            |
| --------------------- | --------------------- | -------------------------------------------------------------- |
| `admin@ustago.test`   | CUSTOMER, SUPER_ADMIN | Tüm yönetim uç noktaları                                       |
| `musteri@ustago.test` | CUSTOMER              |                                                                |
| `usta@ustago.test`    | CUSTOMER, PROVIDER    | Onaylı usta; Elektrik, Su Tesisatı; Kadıköy, Üsküdar, Ataşehir |

Şifre repository'de yoktur. `.env` içindeki `SEED_DEV_PASSWORD` doluysa o kullanılır (ve seed her
çalıştığında bu hesapların şifresi ona eşitlenir). Boşsa seed rastgele bir şifre üretir ve **bir kez**
terminale yazar. Şifreyi unutursan `SEED_DEV_PASSWORD`'ü doldurup `pnpm db:seed`'i tekrar çalıştır.
Üretimde (`NODE_ENV=production`) seed yalnızca il/ilçe/kategori verisini yükler.

Denemek için: Swagger'da (http://localhost:3000/api/docs) `POST /api/v1/auth/login` ile giriş yap,
dönen `accessToken`'ı sağ üstteki **Authorize** düğmesine yapıştır.

### Telefonla giriş (geliştirme)

`SMS_PROVIDER=console` iken gerçek SMS gönderilmez; kod API loguna `[DEV SMS → +90532*****67]`
satırıyla yazılır. `POST /api/v1/auth/otp/request { "phone": "0532 123 45 67" }` → logdaki kod →
`POST /api/v1/auth/otp/verify { "phone": "...", "code": "123456" }`. Production'da `console` ve
`fake` sağlayıcıları ortam şeması tarafından reddedilir ([ADR-0009](docs/adr/0009-telefon-otp-ve-sms.md)).

### Admin paneli

```bash
pnpm --filter @ustago/api dev          # API :3000
pnpm --filter @ustago/admin dev        # Admin :3001 → http://localhost:3001
```

`admin@ustago.test` ile giriş yap. Panel: genel bakış, usta başvuruları, usta detayı (onboarding,
belgeler), belge görüntüleme, belge ve başvuru onay/red, askıya alma. Oturum httpOnly çerezlerde
tutulur; token tarayıcı JavaScript'ine verilmez ([ADR-0013](docs/adr/0013-admin-kimlik-dogrulama.md)).
Belge yüklemeleri geliştirmede `apps/api/.data/storage` altında durur (git'e girmez).

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
| `pnpm db:deploy`                    | Mevcut migration'ları uygular (CI / üretim)                           |
| `pnpm db:seed`                      | Referans veri + (geliştirmede) demo hesaplar                          |
| `pnpm db:reset`                     | Lokal veritabanını sıfırlar, migration + seed                         |
| `pnpm db:validate`                  | Prisma şemasını doğrular                                              |

## Kurallar (özet)

Tam liste: PROJECT.md §31.

- TypeScript `strict`, `any` yasak (ESLint hatası).
- Input doğrulaması backend'de zorunlu; şemalar `@ustago/validation` içinde.
- Para her zaman `amount_minor` tamsayı + `currency`; tarih veritabanında UTC.
- Secret koda yazılmaz; yeni değişken hem şemaya hem `.env.example`'a eklenir.
- Her fazın sonunda `pnpm lint && pnpm typecheck && pnpm test`.

## Dokümanlar

- API, hata biçimi ve uç noktalar: [docs/api](docs/api/README.md)
- Domain modeli: [docs/architecture/domain-model.md](docs/architecture/domain-model.md)
- Kararlar: [docs/adr](docs/adr/README.md) (0005 rol modeli, 0006 para, 0007 auth, 0008 domain,
  0009 OTP/SMS, 0010 usta yaşam döngüsü ve NOW, 0011 belge ve depolama, 0012 konum verisi,
  0013 admin oturumu)
- Türkiye il/ilçe verisinin kaynağı: [docs/reference-data](docs/reference-data/turkey-locations.md)

## CI

`.github/workflows/ci.yml`: install → format check → lint → typecheck → test → build → Prisma validate +
migrate deploy + şema/migration fark kontrolü → seed (iki kez, idempotent) → API e2e
(GitHub Actions servis konteynerlerinde PostgreSQL + Redis).
