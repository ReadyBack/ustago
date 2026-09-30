# ADR-0021: Üretim hazırlığı seviyeleri ve "mimari hazır" ilkesi

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-03

## Bağlam

Faz 6 UstaGO'yu üretime yaklaştırır, ama gerçek ödeme sağlayıcısı, KYC sağlayıcısı, SMS
sağlayıcısı, özel nesne depolama ve hukuki onay henüz yoktur. Bir bileşenin "çalışıyor"
görünmesi ile üretimde gerçek kullanıcıya açılabilmesi farklı şeylerdir. Mock ile çalışan bir
akışa "production ready" demek sahte başarı olur.

## Karar

Her bileşen dört seviyeden biriyle raporlanır:

| Seviye           | Anlamı                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| Development      | Yerelde uçtan uca çalışır; mock/console adaptörlerle test edilir.                      |
| Staging-ready    | `APP_ENV=staging` ile açılır; test kısayolları kapalıdır; gerçek dış servis gerekmez.  |
| Production-ready | Gerçek sağlayıcı bağlı, hukuki/ticari kararlar verilmiş, runbook ve alarmlar hazırdır. |
| Blocker          | Üretime geçişi engelleyen karar veya entegrasyon (ör. "Legal review required").        |

- Sağlayıcı soyutlaması olan ama gerçek sağlayıcısı olmayan her parça **"mimari hazır"**
  (architecture ready) olarak işaretlenir, "üretime hazır" değil.
- Hukuki gereklilik uydurulmaz. Belirsiz her konu "Legal review required" veya
  "Policy TBD / legal validation required" olarak açık bırakılır.
- Üretim için ticari/hukuki karar gerektiren değerlerin (kazanç bekletme süresi, minimum para
  çekme, hesap silme bekleme süresi) üretimde varsayılanı yoktur; açıkça verilmezse API açılmaz
  ([ADR-0022](0022-ortam-ayrimi-ve-fail-closed-config.md)).

## Sonuçlar

- FAZ6-RAPOR.md her bileşen için bu tabloyu doldurur.
- Faz 7 (gerçek sağlayıcı entegrasyonları) bu tablodaki "Blocker" sütunundan beslenir.
