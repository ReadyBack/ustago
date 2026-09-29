# Domain modeli (Faz 1)

Kaynak: [`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma). Kararların gerekçesi:
[ADR-0005](../adr/0005-kullanici-musteri-usta-modeli.md), [ADR-0006](../adr/0006-para-saklama-stratejisi.md),
[ADR-0007](../adr/0007-auth-ve-token-stratejisi.md), [ADR-0008](../adr/0008-cekirdek-domain-modeli.md).

## Genel kurallar

| Kural         | Uygulama                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| ID            | UUIDv7 (`@default(uuid(7))`). İl: plaka kodu. Ara tablolar: birleşik anahtar.                                   |
| Zaman         | `timestamptz(3)`, UTC. Kritik tablolarda `created_at`, `updated_at`.                                            |
| Değişmez log  | `quote_revisions`, `job_status_history`, `ledger_entries`, `trust_events`, `audit_logs`: yalnızca `created_at`. |
| Soft delete   | `users`, `addresses`, `provider_profiles` → `deleted_at`.                                                       |
| İyimser kilit | `service_requests`, `quotes`, `jobs`, `change_orders`, `payments` → `version`.                                  |
| Para          | `BigInt` kuruş (`*_minor`) + `currency` (`TRY`).                                                                |
| İsimler       | Tablo/sütun `snake_case`, kod `camelCase`.                                                                      |

## Alanlar ve tablolar

```text
Kimlik ve oturum
  users ─┬─ user_roles (CUSTOMER | PROVIDER | ADMIN | SUPER_ADMIN, çoklu)
         ├─ auth_sessions ── refresh_tokens (yalnızca SHA-256 hash)
         ├─ devices (push token, platform)
         ├─ customer_profiles (1:1)
         └─ provider_profiles (1:0..1) ─┬─ provider_services ── service_categories
                                        ├─ provider_service_areas ── districts
                                        ├─ provider_verifications (kimlik, mesleki belge...)
                                        └─ provider_scores (UstaScore, 1:1)

Konum ve katalog
  provinces (81 il) ── districts ── addresses
  provinces ×× service_categories → province_categories (il bazında aktif / NOW açık)
  service_categories (iki seviyeli ağaç)

Talep → teklif → iş
  service_requests (NOW | QUOTE, bütçe opsiyonel)
    ├─ emergency_dispatch_offers (NOW: bildirilen ustalar, ilk kabul kazanır)
    ├─ quotes (talep × usta) ── quote_revisions (teklif, karşı teklif; silinmez)
    └─ jobs (1:0..1; agreed_price_minor kilitli, current_total_minor)
         ├─ job_status_history
         ├─ change_orders (ek iş: öneri → kabul / ret)
         ├─ payments ── payment_transactions
         ├─ reviews (iş × yön başına bir)
         └─ disputes ── evidence

Para kaydı
  ledger_accounts (usta bekleyen / kullanılabilir / ödenen, platform) ── ledger_entries (çift taraflı)

Güven
  trust_events (UstaScore sinyalleri; usta ve müşteri)
  disciplinary_actions ── appeals ── evidence

Sistem
  notifications, audit_logs
```

## Önemli ilişkiler ve kısıtlar

- `jobs.service_request_id` **benzersiz**: bir talepten tek iş çıkar; NOW'da iki ustanın aynı
  anda kabulü ve bir talebin iki teklifinin kabulü veritabanı seviyesinde engellenir.
- `quotes (service_request_id, provider_id)` benzersiz: usta bir talep için tek müzakere
  dizisi açar; her hamle yeni `quote_revisions` satırıdır (`(quote_id, revision_no)` benzersiz).
- `reviews (job_id, direction)` benzersiz: çift yorum engellenir.
- `payments.idempotency_key` ve `payment_transactions.idempotency_key` benzersiz: tekrar gelen
  istek veya webhook ikinci kez işlenmez.
- `ledger_accounts (owner_key, type, currency)` benzersiz. `owner_key` usta id'si veya `platform`'dur; PostgreSQL'de NULL değerler benzersiz anahtarda çakışmadığı için boş bırakılmaz.
- Silme davranışı: kimlik alt kayıtları (oturum, rol, profil) kullanıcıyla `Cascade`; iş, ödeme,
  teklif ve yorum gibi iş kayıtları `Restrict` (geçmiş silinemez).

## Faz 1'de API'si olanlar

`users`, `user_roles`, `auth_sessions`, `refresh_tokens`, `devices`, `customer_profiles`,
`provider_profiles`, `service_categories`, `provinces`, `districts`, `audit_logs`.
Diğer tablolar şemada ve migration'dadır; servisleri ilgili fazlarda yazılacaktır.
