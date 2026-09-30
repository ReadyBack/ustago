# ADR-0023: Usta doğrulama ve güven (PROVIDER VERIFICATION AND TRUST)

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-03

## Bağlam

Faz 2'de usta başvurusu ve belge onayı tek bir durumda karışıktı. Üretimde "başvurusu onaylı",
"kimliği doğrulanmış" ve "hesabı askıda" farklı sorulardır; biri diğerini ima etmemelidir.
Gerçek bir KYC sağlayıcısı seçilmemiştir
([kyc-provider-selection](../decisions/kyc-provider-selection.md)).

## Karar

- **Üç bağımsız eksen**, tek bir politika fonksiyonunda (`providerPolicy`) birleşir:
  - Başvuru durumu (Faz 2): `DRAFT → PENDING_REVIEW → ACTIVE / REJECTED`
  - Doğrulama vakası: `NOT_STARTED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW → VERIFIED`, ayrıca
    `NEEDS_REVISION` (tekrar `SUBMITTED`), `REJECTED` (tekrar `IN_PROGRESS`) ve `SUSPENDED`
    (`VERIFIED` askıya alınınca; yeniden incelemeyle `UNDER_REVIEW` ya da doğrudan `VERIFIED`).
    Vaka düzeyinde süre dolumu yoktur. Belgede `EXPIRED` durumu vardır, ama belge süresini
    otomatik dolduran bir iş Faz 6'da yoktur (bilinen eksik).
  - Hesap durumu: `ACTIVE / LIMITED / SUSPENDED / BANNED`
- Politika: listelenme ve teklif verme = başvuru onaylı + hesap açık. NOW işler ve para çekme
  ayrıca `VERIFIED` ister. Rozet ("Kimliği/hesabı doğrulanmıştır") yalnız `VERIFIED` + hesap açık.
- Vaka geçişleri saf bir durum makinesidir; her geçiş `provider_verification_events` tablosuna
  (yalnız ekleme) yazılır. Admin işlemleri `expectedVersion` ister; eşzamanlı karar 409
  `VERIFICATION_VERSION_CONFLICT` alır. Kendi başvurusunu inceleme yasaktır.
- Kullanıcıya görünen gerekçe ile iç not ayrı alanlardır; iç not asla ustaya gösterilmez.
- **Belge güvenliği:** belgeler özel depolamada, kısa ömürlü imzalı URL ile açılır
  (`DOCUMENT_URL_TTL_SECONDS`); her erişim `verification.document_accessed` olarak denetlenir.
  SHA-256 ve boyut kaydedilir. `scan_status` alanı vardır; gerçek tarayıcı yoktur
  (`MALWARE_SCANNER=none`, durum `NOT_SCANNED`), bu bir üretim engelidir.
- **Ham TC Kimlik numarası saklanmaz**; ne API ne mobil uygulama böyle bir alan ister.
- **Askıya alma:** `provider_suspensions` (seviye, gerekçe kodu, kullanıcı gerekçesi, iç not,
  bitiş, otomatik kaldırma). Askıya alma sağlayıcı satırını `FOR UPDATE`, teklif oluşturma
  `FOR SHARE` kilitler; askıya alınan usta aynı anda teklif veremez. Kaldırma not ister.
  Mevcut işler silinmez; usta devam eden işlerini tamamlayabilir.
- **Süreli askıya alma:** `expiresAt` geldiğinde, `autoLift` seçilmişse askı `EXPIRED` olur ve
  erişim geri gelir. Seçilmemişse otomatik geri açmak güvenli sayılmaz: askı
  `EXPIRED_PENDING_REVIEW` olur ve bir admin kaldırana kadar hesap kısıtlı kalır.
- Faz 4 cezaları (`ProviderPenalty`, sıralama/davranış sinyali) ile hesap askısı (ürün erişim
  kontrolü) ayrı kavramlardır; biri diğerini yazmaz.
- Doğrulama UstaScore'a küçük ve açıklanabilir bir sinyal olabilir, ama `VERIFIED` "kaliteli usta"
  demek değildir; herkese açık ifade "Kimliği/hesabı doğrulanmıştır"dır.
- Faz 5 kayıtlarından geri doldurma (migration) yalnız verinin kanıtladığını yazar: kimlik belgesi
  onaylı aktif usta `VERIFIED`, diğerleri daha düşük. Kanıtı olmayan aktif usta listelenmeye ve
  teklif vermeye devam eder, NOW ve para çekme için doğrulanması gerekir.
- Demo seed doğrulama kararları `source = DEMO_SEED` ile işaretlenir ve yalnız
  `ALLOW_TEST_KYC` açıkken yazılır.

## Sonuçlar

- "Kim ne yapabilir" tek yerden değişir; SQL eşleştirme sorguları aynı kuralı aynalar.
- Gerçek KYC sağlayıcısı geldiğinde vaka modeli değişmez; `method` alanı `MANUAL` dışında bir
  değer alır. Hukuki saklama süreleri: Legal review required.
