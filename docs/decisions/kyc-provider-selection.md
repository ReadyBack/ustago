# KYC (kimlik doğrulama) sağlayıcısı seçimi

**STATUS: DECISION REQUIRED** · Sahip: ürün + güvenlik + hukuk

Bugün doğrulama **elle** yapılır (`KYC_PROVIDER=manual`): usta belge yükler, `ADMIN_VERIFICATION`
inceler. Otomatik kimlik doğrulama, resmî kaynak sorgusu veya canlılık testi yoktur; ham TC Kimlik
numarası saklanmaz. Sağlayıcı önerilmedi; tablo boş şablondur.

| Kriter                 | Aday A | Aday B |
| ---------------------- | ------ | ------ |
| Identity verification  |        |        |
| Document verification  |        |        |
| Liveness (gerekiyorsa) |        |        |
| Türkiye desteği        |        |        |
| API                    |        |        |
| Data residency         |        |        |
| Retention              |        |        |
| Pricing                |        |        |
| Manual review desteği  |        |        |
| Webhook                |        |        |

- Meslek bazlı zorunlu belgeler: **Policy TBD / legal validation required** (bugün admin tarafından
  ayarlanan kategori gereksinimleri vardır, mevzuat kodlanmadı).
- Seçimden sonra vaka modeli değişmez; `method` ve `external_reference` doldurulur.
