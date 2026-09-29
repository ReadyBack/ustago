# Mimari

Genel teknik mimari için kökteki [PROJECT.md](../../PROJECT.md) §15–22 ve [ADR'ler](../adr/README.md).

```text
apps/mobile (Expo) ─┐
                    ├─ HTTP /api/v1 ─> apps/api (NestJS) ─┬─> PostgreSQL (Prisma)
apps/admin (Next) ──┘                                     └─> Redis (cache / BullMQ)
```

## Faz 2 modülleri (apps/api/src)

| Modül              | Sorumluluk                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/otp`         | Telefon + OTP ile giriş/kayıt ve telefon doğrulama ([ADR-0009](../adr/0009-telefon-otp-ve-sms.md))                                       |
| `sms`              | `SmsProvider` portu: console / fake / disabled adaptörleri                                                                               |
| `storage`          | `ObjectStorage` portu, yerel imzalı URL adaptörü, magic-byte kontrolü ([ADR-0011](../adr/0011-dogrulama-belgeleri-ve-nesne-depolama.md)) |
| `providers/domain` | Saf iş kuralları: yaşam döngüsü, onboarding, NOW ([ADR-0010](../adr/0010-usta-yasam-dongusu-ve-now.md))                                  |
| `providers`        | Usta profili, hizmetler, bölgeler, belgeler, başvuru, müsaitlik, public profil                                                           |
| `addresses`        | Müşteri adresleri (tek varsayılan, IDOR korumalı)                                                                                        |
| `admin`            | Başvuru ve belge inceleme, askıya alma, denetim kaydı listesi                                                                            |
| `locations`        | 81 il / 973 ilçe, il × kategori ayarları ([ADR-0012](../adr/0012-turkiye-konum-referans-verisi.md))                                      |

Kurallar domain katmanında saf fonksiyonlardır; servisler yalnızca veriyi okur, kuralı çağırır ve
transaction içinde yazar. Veritabanı son savunma hattıdır: CHECK kısıtları (telefon E.164,
koordinat aralıkları, ACTIVE dışı usta müsait olamaz, red sebebi zorunlu) ve kısmi unique
indeksler (kullanıcı başına tek varsayılan adres, numara başına tek açık OTP, tür başına tek
bekleyen belge).

```text
Tarayıcı ──(httpOnly çerez)──> apps/admin (Next.js BFF) ──Bearer──> apps/api
Mobil ────────────────────────────Bearer──────────────────────────> apps/api ──> ObjectStorage (imzalı URL)
```
