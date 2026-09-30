# Veri saklama

> **Legal review required.** Bu belge süre **belirlemez**. Hukuki doğrulama yapılana kadar
> hiçbir veri otomatik silinmez; tabloda yalnız bugünkü teknik davranış vardır.

| Veri                        | Sınıf     | Bugünkü davranış                                                | Saklama süresi                         |
| --------------------------- | --------- | --------------------------------------------------------------- | -------------------------------------- |
| Oturumlar (`auth_sessions`) | PERSONAL  | İptal/bitişte `revoked_at` yazılır, satır kalır                 | Policy TBD / legal validation required |
| OTP kayıtları               | SENSITIVE | Kod özeti; süresi dolar, satır kalır                            | Policy TBD / legal validation required |
| Webhook yükleri             | FINANCIAL | Olay kimliği, sonucu ve yükün tamamı (JSONB) saklanır; silinmez | Policy TBD / legal validation required |
| Doğrulama belgeleri         | SENSITIVE | Özel depolamada kalır; hesap silmede silinmez                   | Legal review required                  |
| Denetim kayıtları           | INTERNAL  | Yalnız eklemeli; API'den silinemez                              | Policy TBD / legal validation required |
| Finansal defter ve kayıtlar | FINANCIAL | Yalnız eklemeli; asla silinmez                                  | Legal review required (vergi/muhasebe) |
| Kullanıcı hesabı            | PERSONAL  | Silme talebinde bekleme sonrası takma adlandırılır              | Policy TBD / legal validation required |
| Risk sinyalleri, uyarılar   | INTERNAL  | İnceleme/çözüm sonrası kalır                                    | Policy TBD                             |
| Veri dışa aktarma talepleri | PERSONAL  | Yalnız talep kaydı; dosya üretilmez                             | Policy TBD                             |

Süreler onaylanınca her veri türü için planlı bir temizlik işi, testi ve runbook eklenecektir.
