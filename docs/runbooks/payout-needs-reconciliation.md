# Sonucu belirsiz para çekme (NEEDS_RECONCILIATION)

Sağlayıcı zaman aşımı veya bilinmeyen hata verdiğinde payout `NEEDS_RECONCILIATION` olur,
para ustanın **ayrılmış** bakiyesinde kalır ve CRITICAL uyarı açılır
(`finance.payout_outcome_unknown:{id}`). Sistem kendiliğinden karar vermez.

1. Admin → Finans → Para çekme detayına git (`ADMIN_FINANCE` gerekir).
2. Sağlayıcı panelinde aynı referansı ara.
3. Para gitmişse **Ödendi (PAID)**, gitmemişse **Başarısız (FAILED)** seç; not zorunludur.
   FAILED seçilirse ayrılan para ustanın kullanılabilir bakiyesine döner.
4. Uyarı otomatik çözülür; işlem denetim kaydına yazılır. Emin değilsen karar verme, bekle.
