# ADR-0011: Doğrulama belgeleri ve nesne depolama

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

Ustalar kimlik ve mesleki belge yükler. Bu belgeler kişisel veridir (KVKK): herkese açık olamaz,
veritabanına ikili veri olarak konmamalı, sahte içerik (SVG içinde script, uzantısı değiştirilmiş
çalıştırılabilir dosya) sisteme girmemelidir. Üretimde S3 uyumlu bir depolama (S3, R2, MinIO)
kullanılacak; geliştirme ortamında dış servis olmamalıdır.

## Karar

**Port ve adaptörler** (`apps/api/src/storage`)

- `ObjectStorage` arayüzü: `createUploadUrl`, `createDownloadUrl`, `head`, `readPrefix`, `delete`.
- `local` adaptörü: dosyalar `STORAGE_LOCAL_DIR` altında; yalnızca HMAC imzalı, süreli
  bağlantılarla (`/api/v1/storage/local/:token`) erişilir. Token bir anahtar, bir işlem (PUT/GET),
  bitiş zamanı ve yüklemede Content-Type + boyut sınırı taşır. Production'da ortam şeması `local`
  sürücüsünü reddeder. `disabled` adaptörü yüklemeyi `503 STORAGE_UNAVAILABLE` ile reddeder.
- S3 uyumlu adaptör aynı arayüzü presigned URL'lerle uygular (canlıya çıkıştan önce).

**Akış**

1. `POST /providers/me/verifications/upload-intent { type, fileName, mimeType, sizeBytes }` →
   rastgele anahtar (`verifications/<providerId>/<uuidv7>.<ext>`), 15 dk geçerli imzalı PUT adresi.
   Dosya adı anahtara hiç girmez (path traversal ve kişisel veri sızıntısı yok); yalnızca temizlenmiş
   hâli `originalFileName` olarak saklanır.
2. İstemci dosyayı doğrudan depolamaya yükler. Yerel adaptör **tek yazımlıktır**: aynı bağlantıyla
   ikinci yükleme `409 STORAGE_OBJECT_EXISTS` alır; böylece incelenmiş dosya sonradan değiştirilemez.
3. `POST /providers/me/verifications { type, uploadId }` → sunucu dosyanın varlığını, boyutunu ve
   **ilk baytlarını (magic bytes)** kontrol eder. Yalnızca JPEG, PNG ve PDF; bildirilen türle
   içerik uyuşmazsa dosya silinir ve `422 INVALID_VERIFICATION_FILE` döner. SVG, HTML, çalıştırılabilir
   dosyalar şema düzeyinde reddedilir. Upload intent tek kullanımlıktır.
4. Admin `POST /admin/provider-verifications/:id/document-url` ile 2 dakikalık imzalı okuma adresi
   alır; her erişim `verification.document_accessed` olarak audit'e yazılır. Yanıt
   `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` taşır.

**Veri ayrımı**

- Depolama anahtarı ve imzalı adresler hiçbir usta, müşteri veya public DTO'da dönmez; admin
  DTO'sunda yalnızca `hasDocument` bulunur.
- TC kimlik numarası toplanmaz ve saklanmaz; belge görseli incelenir, numara sisteme yazılmaz
  (veri minimizasyonu).
- Yalnızca DRAFT/REJECTED iken bekleyen belge değiştirilebilir; eski dosya silinir. Bir tür için en
  fazla bir PENDING belge (kısmi unique indeks).

## Sonuçlar

- İstemci akışı her ortamda aynıdır (imzalı PUT → submit).
- Belge saklama süresi ve silme politikası (KVKK) Faz 2'de tanımlanmadı; onaylanan/reddedilen
  belgelerin ne kadar tutulacağı hukuki görüşle belirlenmeli.
- Virüs taraması yok; S3 adaptörüyle birlikte asenkron tarama (ör. ClamAV) eklenmeli.
