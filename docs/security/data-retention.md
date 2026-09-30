# Veri saklama

> **Legal review required.** Aşağıdaki süreler **öneri değildir**; hukuki doğrulama yapılana kadar
> hiçbir veri otomatik silinmez. Tabloda yalnız bugünkü teknik davranış yazılıdır.

| Veri                        | Bugünkü davranış                                         | Saklama süresi                         |
| --------------------------- | -------------------------------------------------------- | -------------------------------------- |
| Kullanıcı hesabı            | Silme talebinde bekleme süresi sonra kimliksizleştirilir | Policy TBD / legal validation required |
| Doğrulama belgeleri         | Saklanır; hesap silmede silinmez                         | Legal review required                  |
| Ödeme, iade, defter, payout | Silinmez (yalnız ekleme)                                 | Legal review required (vergi mevzuatı) |
| Denetim kayıtları           | Silinmez (yalnız ekleme)                                 | Policy TBD                             |
| Oturumlar, cihazlar         | İptal edilir, satır kalır                                | Policy TBD                             |
| OTP kayıtları               | Süresi dolar, satır kalır                                | Policy TBD                             |
| Risk sinyalleri             | İnceleme sonrası kalır                                   | Policy TBD                             |
| Veri dışa aktarma talebi    | Yalnız talep kaydı (dosya üretilmez)                     | Policy TBD                             |

Saklama süreleri onaylandığında her biri için planlı bir temizlik işi ve runbook eklenecektir.
