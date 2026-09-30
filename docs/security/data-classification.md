# Veri sınıflandırması

> Teknik başlangıç sınıflandırmasıdır. **Legal review required** (KVKK kapsamındaki kategoriler ve
> işleme şartları hukuken doğrulanmadı). Karar kaydı: [ADR-0027](../adr/0027-kisisel-veri-ve-veri-yasam-dongusu.md).

| Sınıf       | Örnek alanlar                                                                                     | Kurallar                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `PUBLIC`    | Kategori, il/ilçe, yayınlanmış yorum, usta vitrin adı, puan, "Kimliği/hesabı doğrulanmıştır"      | Herkese açık API'de dönebilir.                                                                   |
| `INTERNAL`  | Denetim kaydı, risk sinyali, operasyon uyarısı, admin iç notu, mutabakat çalışması                | Yalnız yetkili admin görür; iç not kullanıcıya/ustaya asla dönmez.                               |
| `PERSONAL`  | Ad, telefon, e-posta, adres, konum, cihaz adı/platformu, oturum zamanları                         | Yalnız sahibi ve yetkili admin; loglarda ve denetim metasında maskelenir; metrik etiketi olamaz. |
| `SENSITIVE` | Kimlik belgesi görüntüsü, belge depolama anahtarı, OTP özeti, parola/refresh token özeti, IP HMAC | Özel depolama, kısa ömürlü imzalı URL, erişim denetimi; asla loglanmaz, API'de dönmez.           |
| `FINANCIAL` | Ödeme, iade, defter, kazanç, para çekme, nakit kaydı, maskeli IBAN, komisyon politikası           | Yalnız eklemeli; silinmez; hesap silmede kimliksizleştirilir; tam IBAN saklanmaz.                |

## Özel kurallar

- **Ham TC Kimlik numarası toplanmaz ve saklanmaz.**
- Oturum tablosunda IP ham değil HMAC'tir. Admin işlemlerinin denetim kaydında ham IP tutulur;
  süresi **Policy TBD**.
- `redact()` anahtar adına göre maskeler (telefon, e-posta, IBAN, token, OTP, `code`, adres,
  `Authorization`, çerez, depolama anahtarı, imza). İstek gövdesi loglanmaz.
