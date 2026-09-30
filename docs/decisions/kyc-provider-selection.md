# KYC (kimlik doğrulama) yöntemi seçimi

- **Durum:** DECISION REQUIRED
- **Sahip:** Ürün + güvenlik + hukuk

Faz 6'da doğrulama **elle** yapılır (`KYC_PROVIDER=manual`): usta belge yükler, admin inceler.
Otomatik kimlik doğrulama, e-Devlet/NVİ sorgusu veya canlılık testi yoktur. Ham TC Kimlik numarası
saklanmaz.

## Seçenekler (değerlendirilmedi)

- Elle inceleme ile devam (ölçek sınırlı).
- Üçüncü taraf KYC sağlayıcısı (belge + canlılık).
- Resmî kaynak sorgusu. **Legal review required** (erişim yetkisi ve KVKK açık rıza).

## Açık sorular

- Hangi meslekler için ek belge (ustalık belgesi, SRC vb.) zorunlu? **Policy TBD / legal validation required.**
- Belgeler ne kadar saklanır? ([data-retention](../security/data-retention.md))
