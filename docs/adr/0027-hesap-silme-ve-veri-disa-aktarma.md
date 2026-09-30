# ADR-0027: Hesap silme ve veri dışa aktarma talepleri

- **Durum:** Kabul edildi (hukuki doğrulama bekliyor)
- **Tarih:** 2026-10-03

## Bağlam

Kullanıcı hesabını silebilmeli ve verisini isteyebilmelidir. Ancak finansal kayıtlar (defter,
ödeme, iade) ve anlaşmazlık kanıtları silinemez; saklama süreleri hukuki bir karardır.
**Legal review required** (KVKK ve vergi mevzuatı kapsamında saklama süreleri doğrulanmadı).

## Karar

- **Hesap silme talebi:** kullanıcı "HESABIMI SIL" yazarak onaylar. Aktif iş, açık anlaşmazlık
  veya açık para çekme varsa talep `BLOCKED_BY_ACTIVE_JOB` ile engellenir ve engeller gösterilir.
  Bekleme süresi (`ACCOUNT_DELETION_GRACE_HOURS`, geliştirmede 24 sa) içinde iptal edilebilir.
  Üretimde bu süre açıkça verilmedikçe API açılmaz (Policy TBD / legal validation required).
- **İşleme:** vadesi gelen talepler `FOR UPDATE SKIP LOCKED` ile alınır, engeller yeniden kontrol
  edilir, sonra **takma adlandırma** yapılır: e-posta, telefon, parola özeti silinir, ad
  "Silinmiş Kullanıcı" olur, oturumlar ve cihazlar iptal edilir, usta profili gizlenir.
  Finansal kayıtlar, yorumlar ve denetim kayıtları kimliksiz halde kalır.
- **Veri dışa aktarma:** Faz 6 yalnız talebi kaydeder (kullanıcı başına tek açık talep). Dışa
  aktarma dosyasının üretimi ve teslimi uygulanmamıştır; arayüz bunu açıkça söyler.

## Sonuçlar

- Hiçbir talep kaybolmaz; uygulanmayan kısım "yapıldı" gibi gösterilmez.
- Saklama süreleri: [data-retention](../security/data-retention.md) (Legal review required).
