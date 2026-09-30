# ADR-0027: Kişisel veri ve veri yaşam döngüsü (PII AND DATA LIFECYCLE)

- **Durum:** Kabul edildi (hukuki doğrulama bekliyor)
- **Tarih:** 2026-10-03

## Bağlam

UstaGO telefon, ad, adres, kimlik belgesi görüntüsü ve finansal kayıt tutar. Kullanıcı hesabını
silebilmeli ve verisini isteyebilmelidir; ama finansal kayıtlar ve denetim izi silinemez.
Saklama süreleri hukuki bir karardır: **Legal review required** (KVKK ve vergi mevzuatı kapsamında
süreler doğrulanmadı ve bu ADR süre belirlemez).

## Karar

### Sınıflandırma

Beş sınıf kullanılır: `PUBLIC`, `INTERNAL`, `PERSONAL`, `SENSITIVE`, `FINANCIAL`. Alan örnekleri
ve kurallar: [data-classification](../security/data-classification.md).

- Ham TC Kimlik numarası **toplanmaz ve saklanmaz**. Belge görüntüsü özel depolamada durur;
  gelecekte bir KYC sağlayıcısı yalnız bir referans (`external_reference`) döndürür.
- Loglar ve denetim metası `redact()` ile temizlenir: telefon, e-posta, IBAN, token, OTP,
  `Authorization`, belge anahtarları. İstek gövdesi loglanmaz. Metrik etiketinde kimlik yoktur.

### Saklama

- Her veri türünün süresi ayrıdır (oturum, OTP, webhook yükü, doğrulama belgesi, denetim,
  finansal defter). Bugünkü teknik davranış ve açık kararlar:
  [data-retention](../security/data-retention.md). Hepsi **Policy TBD / legal validation required**;
  otomatik silme işi yoktur.

### Hesap silme

- Durumlar: `REQUESTED → PROCESSING → COMPLETED`, engel varsa `BLOCKED_BY_ACTIVE_JOB`; kullanıcı
  bekleme süresinde `CANCELLED` yapabilir. Onay "HESABIMI SIL" yazarak verilir.
- Engeller: aktif iş, açık anlaşmazlık, açık para çekme. Kullanıcıya neden gösterilir.
- Bekleme süresi `ACCOUNT_DELETION_GRACE_HOURS` (geliştirmede 24 sa); üretimde açıkça verilmezse
  API açılmaz.
- İşleme **hard delete değil, takma adlandırmadır** (pseudonymization): e-posta, telefon, parola
  özeti silinir; ad "Silinmiş Kullanıcı" olur; oturumlar ve cihazlar iptal edilir, push token
  silinir; usta profili gizlenir ve konumu temizlenir. Kullanıcı satırı kalır, böylece ödeme,
  iade, defter, yorum ve denetim kayıtlarının yabancı anahtarları bozulmaz.
- Finansal kayıtlar değişmez (defter yalnız eklemeye açık). Doğrulama belgelerinin ne zaman
  silineceği hukuki karardır; bugün silinmez.

### Veri dışa aktarma

- Faz 6 yalnız talebi kaydeder (`data_export_requests`, kullanıcı başına tek açık talep). Dosya
  üretimi ve teslimi yoktur; arayüz bunu açıkça söyler.

## Sonuçlar

- Hiçbir talep kaybolmaz; yapılmayan kısım "yapıldı" gibi gösterilmez.
- Faz 7+: saklama işleri, dışa aktarma dosyası, belge silme; hepsi hukuki karardan sonra.
