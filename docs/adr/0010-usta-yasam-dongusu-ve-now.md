# ADR-0010: Usta yaşam döngüsü, onboarding ve NOW müsaitliği

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

Usta başvurusu birden fazla adımdan oluşur, admin incelemesinden geçer ve reddedilebilir veya
askıya alınabilir. Durum kuralları servis kodunun içine dağılmış `if`'lerle yazılırsa tutarsız
geçişler (ör. başvuru incelenirken bölgeleri değiştirmek, onaysız ustanın acil işlere görünmesi)
kaçınılmaz olur.

## Karar

**Durum makinesi** (`apps/api/src/providers/domain/provider-lifecycle.ts`)

| Olay        | Kimden         | Kime           | Kim yapar |
| ----------- | -------------- | -------------- | --------- |
| `SUBMIT`    | DRAFT          | PENDING_REVIEW | Usta      |
| `APPROVE`   | PENDING_REVIEW | ACTIVE         | Admin     |
| `REJECT`    | PENDING_REVIEW | REJECTED       | Admin     |
| `REAPPLY`   | REJECTED       | DRAFT          | Usta      |
| `SUSPEND`   | ACTIVE         | SUSPENDED      | Admin     |
| `REINSTATE` | SUSPENDED      | ACTIVE         | Admin     |

- Geçişler yalnızca `transitionFor(status, event)` üzerinden yapılır; tablo dışı her şey
  `409 INVALID_PROVIDER_STATE` döner. Hangi durumda hangi bölümün düzenlenebileceği `canEdit` ile
  tek yerde tanımlıdır: PENDING_REVIEW ve SUSPENDED'da profil, hizmet, bölge ve belge değişmez.
- Admin kararları koşullu güncellemedir (`WHERE status IN (...)`): iki admin aynı anda karar
  verirse ilki kazanır, ikincisi 409 alır. Usta tarafı satırı `SELECT … FOR UPDATE` ile kilitler.
- Başvuru gönderme idempotenttir: PENDING_REVIEW'daki bir başvuruyu tekrar göndermek aynı profili
  döner, ikinci bir audit kaydı yazmaz.
- Admin kendi usta başvurusunu veya belgesini inceleyemez (`403 CANNOT_REVIEW_SELF`).
- Red ve askı sebebi zorunludur (5–1000 karakter), `statusReason` olarak ustaya gösterilir.

**Onboarding adımları** (`domain/onboarding.ts`)

`PHONE_VERIFIED`, `PROFILE` (ad, en az 20 karakter tanıtım, deneyim yılı), `SERVICES` (en az bir
aktif kategori), `SERVICE_AREAS` (en az bir aktif ilçe), `REQUIRED_VERIFICATIONS` (şimdilik
`IDENTITY`; bekleyen veya onaylı). Eksik adım varken gönderim `422 PROVIDER_ONBOARDING_INCOMPLETE`
ve `details.missingSteps` döner. Admin onayı ayrıca zorunlu belgelerin **onaylanmış** olmasını
ister (`422 VERIFICATION_REQUIRED`).

**NOW (Acil Usta)**

- `nowEnabled`: ustanın tercihi; onboarding sırasında kaydedilebilir, NOW destekleyen en az bir
  kategori gerektirir (`NOW_CATEGORY_NOT_SUPPORTED`).
- `isAvailableNow`: gerçek müsaitlik. Yalnızca ACTIVE usta, `nowEnabled` açıkken ve hizmet verdiği
  en az bir il × kategori çiftinde NOW açıkken açabilir (`PROVIDER_NOT_ACTIVE`, `NOW_NOT_AVAILABLE`).
- Bir il × kategori çiftinde NOW açık mı: il aktif, kategori (ve üst kategorisi) aktif ve NOW
  destekliyor, varsa `province_categories` satırı da izin veriyor (`isNowOpen`).
- Veritabanı da korur: `CHECK (NOT is_available_now OR (now_enabled AND status = 'ACTIVE'))`.
  Aktiflikten çıkan her geçiş `isAvailableNow`'ı kapatır; kategori/bölge değişikliği NOW
  bayraklarını yeniden hesaplar.
- Admin bir il × kategori çiftinde NOW'ı kapattığında ustaların bayrağı toplu değiştirilmez;
  Faz 3'teki eşleştirme sorgusu her seferinde çiftin açık olduğunu yeniden kontrol eder. Bu,
  admin anahtarının hemen etkili olmasını ve ustaların tercihinin korunmasını sağlar.

## Sonuçlar

- PENDING_REVIEW, REJECTED veya SUSPENDED bir usta hiçbir yolla dispatch edilebilir olamaz.
- Yeni belge türü zorunlu hale getirmek `REQUIRED_VERIFICATION_TYPES` listesine eklemektir;
  kategoriye özel zorunluluk ileride aynı noktadan genişletilir.
- Durum makinesi saf fonksiyonlardan oluştuğu için birim testlerle eksiksiz doğrulanır.
