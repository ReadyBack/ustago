# ADR-0025: Komisyon politikası yaşam döngüsü ve finans sertleştirmesi

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-03

## Bağlam

Faz 5 finans alanı (ledger, ödeme, iade, kazanç, payout) çalışmaktadır ve yeniden yazılmaz
([ADR-0018](0018-finansal-defter-mimarisi.md) – [ADR-0020](0020-platform-ucreti-ve-usta-kazanci.md)).
Eksik olanlar: komisyon oranını güvenle yönetmek, sonucu belirsiz payout'ları ele almak ve
doğrulanmamış banka hesabına para göndermemek.

## Karar

- **Komisyon politikası yaşam döngüsü:** `DRAFT → SCHEDULED → ACTIVE → RETIRED`.
  - Taslak serbestçe silinebilir. Yayın `confirm: true` ister ve başlangıç en az 60 sn ileride
    olmalıdır (`FEE_POLICY_START_IN_PAST`).
  - Yayınlanan politikanın sayıları veritabanı tetikleyicisiyle **dondurulur**.
  - Eşzamanlı yayınlar advisory lock + benzersiz başlangıç indeksiyle sıralanır; aynı anda
    başlayan iki politika olamaz (`FEE_POLICY_START_CONFLICT`).
  - Yalnız henüz başlamamış (`SCHEDULED`) politika geri çekilebilir; aktif politika kapatılmaz,
    yenisiyle değiştirilir.
  - İş, anlaşma anındaki politikanın anlık görüntüsünü tutar; %15 ile anlaşılmış iş, sonra
    başlayan %17 politikadan etkilenmez.
  - Katı ortamda `is_development` politikalar hiç seçilmez; politika yoksa online ödeme kapalıdır.
- **Banka hesabı doğrulama:** yeni hesap `PENDING_VERIFICATION` başlar; `ADMIN_FINANCE` doğrular
  (denetimli). Para çekme = usta `VERIFIED` + hesap açık + hesap doğrulanmış
  (`payoutRefusal`). Katı ortamda test banka hesabı tanımlanamaz.
- **Sonucu belirsiz payout:** sağlayıcı zaman aşımı veya bilinmeyen hata payout'u
  `NEEDS_RECONCILIATION` yapar, CRITICAL uyarı açar ve para ayrılmış kalır. Otomatik düzeltme
  yoktur; `ADMIN_FINANCE` sağlayıcı kaydını kontrol edip `PAID` veya `FAILED` (notla) seçer.
  Net ret (`PayoutRejectedError`) doğrudan `FAILED` olur ve para iade edilir.
- **Kill switch:** `payments`, `payouts`, `cash`, `new_jobs`
  ([ADR-0022](0022-ortam-ayrimi-ve-fail-closed-config.md)).
- **Finans bildirimleri:** ödeme, iade, kazanç, payout olayları derin bağlantılı bildirim üretir
  ([ADR-0026](0026-operasyon-gozlemlenebilirlik-ve-mutabakat.md)).

## Sonuçlar

- Faz 5 kabul senaryosu (2200 anlaşma, +500 ek iş, 2700 ödeme, %15 = 405, net 2295) değişmeden
  geçer; e2e testi bunu her çalıştırmada kanıtlar.
- Ticari oran hâlâ karar değildir; geliştirme politikası "DEMO" etiketlidir.
