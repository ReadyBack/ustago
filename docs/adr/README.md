# Mimari Karar Kayıtları (ADR)

Önemli mimari kararlar burada kısa ADR dosyaları olarak tutulur.

- Yeni karar: `0000-template.md` dosyasını kopyalayın, sıradaki numarayı verin.
- Bir karar değişirse eski ADR silinmez; durumu `Yerini aldı: ADR-XXXX` olarak güncellenir.

| No                                                         | Başlık                                            | Durum        |
| ---------------------------------------------------------- | ------------------------------------------------- | ------------ |
| [0001](0001-monorepo-ve-moduler-monolith.md)               | pnpm + Turborepo monorepo, modüler monolith       | Kabul edildi |
| [0002](0002-paylasilan-dogrulama-zod.md)                   | Paylaşılan doğrulama için Zod                     | Kabul edildi |
| [0003](0003-prisma-7-ve-veri-kurallari.md)                 | Prisma 7, para ve zaman kuralları                 | Kabul edildi |
| [0004](0004-ortam-degiskenleri.md)                         | Ortam değişkenleri ve secret yönetimi             | Kabul edildi |
| [0005](0005-kullanici-musteri-usta-modeli.md)              | Tek hesap, çoklu rol (müşteri/usta/admin)         | Kabul edildi |
| [0006](0006-para-saklama-stratejisi.md)                    | Para saklama stratejisi (BigInt kuruş)            | Kabul edildi |
| [0007](0007-auth-ve-token-stratejisi.md)                   | Kimlik doğrulama ve token stratejisi              | Kabul edildi |
| [0008](0008-cekirdek-domain-modeli.md)                     | Çekirdek domain modeli                            | Kabul edildi |
| [0009](0009-telefon-otp-ve-sms.md)                         | Telefon + OTP girişi, SMS soyutlaması             | Kabul edildi |
| [0010](0010-usta-yasam-dongusu-ve-now.md)                  | Usta yaşam döngüsü, onboarding ve NOW             | Kabul edildi |
| [0011](0011-dogrulama-belgeleri-ve-nesne-depolama.md)      | Doğrulama belgeleri ve nesne depolama             | Kabul edildi |
| [0012](0012-turkiye-konum-referans-verisi.md)              | Türkiye konum referans verisi                     | Kabul edildi |
| [0013](0013-admin-kimlik-dogrulama.md)                     | Admin paneli kimlik doğrulama (BFF)               | Kabul edildi |
| [0014](0014-talep-teklif-pazarlik-ve-now.md)               | Talep, teklif, pazarlık, fiyat kilidi ve NOW      | Kabul edildi |
| [0015](0015-is-yasam-dongusu-ve-ek-is.md)                  | İş yaşam döngüsü, ek iş ve sorun bildirimi        | Kabul edildi |
| [0016](0016-ustascore-v1-ve-usta-kalite-modeli.md)         | Değerlendirme, UstaScore V1, yaptırımlar          | Kabul edildi |
| [0017](0017-bildirim-outbox-ve-expo-push.md)               | Bildirimler, outbox ve Expo push                  | Kabul edildi |
| [0018](0018-finansal-defter-mimarisi.md)                   | Finansal defter (ledger) mimarisi                 | Kabul edildi |
| [0019](0019-odeme-saglayici-soyutlamasi.md)                | Ödeme sağlayıcı soyutlaması ve webhook            | Kabul edildi |
| [0020](0020-platform-ucreti-ve-usta-kazanci.md)            | Platform ücreti, kazanç, nakit, iade, payout      | Kabul edildi |
| [0021](0021-uretim-hazirligi-seviyeleri.md)                | Üretim hazırlığı seviyeleri                       | Kabul edildi |
| [0022](0022-ortam-ayrimi-ve-fail-closed-config.md)         | Ortam ayrımı ve fail-closed config                | Kabul edildi |
| [0023](0023-usta-dogrulama-ve-guven.md)                    | Usta doğrulama ve güven                           | Kabul edildi |
| [0024](0024-oturum-ve-kimlik-dogrulama-guvenligi.md)       | Oturum ve kimlik doğrulama güvenliği              | Kabul edildi |
| [0025](0025-komisyon-politikasi-ve-finans-sertlestirme.md) | Komisyon politikası, finans sertleştirme          | Kabul edildi |
| [0026](0026-gozlemlenebilirlik-ve-operasyon-uyarilari.md)  | Gözlemlenebilirlik ve operasyon uyarıları         | Kabul edildi |
| [0027](0027-kisisel-veri-ve-veri-yasam-dongusu.md)         | Kişisel veri ve veri yaşam döngüsü                | Kabul edildi |
| [0028](0028-eslestirme-dagitim-ve-pazar-yeri-analitigi.md) | Eşleştirme (MATCH_V1), dalga dağıtımı ve analitik | Kabul edildi |
| [0029](0029-konum-mesafe-ve-konum-gizliligi.md)            | Konum, mesafe ve konum gizliliği                  | Kabul edildi |
| [0030](0030-talep-bagli-sohbet.md)                         | Talebe bağlı sohbet                               | Kabul edildi |
| [0031](0031-usta-musaitligi.md)                            | Usta müsaitliği                                   | Kabul edildi |
