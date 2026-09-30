# Veri sınıflandırması

> Bu sınıflandırma teknik bir başlangıçtır. **Legal review required** (KVKK "özel nitelikli
> kişisel veri" kapsamı ve işleme şartları hukuken doğrulanmadı).

| Sınıf          | Örnekler                                                  | Kurallar                                                                    |
| -------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Gizli          | Parola özeti, refresh token özeti, OTP özeti, API sırları | Asla loglanmaz, API'de dönmez, denetim metasında maskelenir.                |
| Hassas kişisel | Kimlik belgesi görüntüsü, banka hesabı (IBAN), telefon    | Özel depolama, imzalı kısa URL, erişim denetlenir; IBAN maskeli gösterilir. |
| Kişisel        | Ad, e-posta, adres, konum, cihaz bilgisi                  | Yalnız ilgili kullanıcı ve yetkili admin görür; loglarda maskelenir.        |
| Finansal       | Ödeme, iade, defter, kazanç, payout                       | Yalnız eklemeli; silinmez; hesap silmede kimliksizleştirilir.               |
| İç             | Denetim kaydı, risk sinyali, iç not                       | Yalnız admin; iç not kullanıcıya gösterilmez.                               |
| Genel          | Kategori, il/ilçe, yayınlanmış yorum, usta vitrin bilgisi | Herkese açık.                                                               |

## Özel kurallar

- **Ham TC Kimlik numarası saklanmaz.** Belge görüntüsü saklanır; numara ayrıca alan olarak tutulmaz.
- IP adresi oturum tablosunda HMAC olarak saklanır; denetim kaydında admin işlemleri için ham IP
  tutulur (saklama süresi Policy TBD).
- Metrik etiketlerinde ve yapılandırılmış loglarda kişisel veri bulunmaz (`redact()`).
