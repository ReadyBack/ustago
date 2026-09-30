# Ödeme sağlayıcısı seçimi

**STATUS: DECISION REQUIRED** · Sahip: ürün + finans + hukuk

UstaGO bugün yalnız `mock` (TEST parası) ve `disabled` sağlayıcıyla çalışır; soyutlama hazırdır
([ADR-0019](../adr/0019-odeme-saglayici-soyutlamasi.md)). Hiçbir sağlayıcı değerlendirilmedi veya
önerilmedi; aşağıdaki tablo adaylar için boş bir şablondur.

| Kriter                      | Aday A | Aday B | Aday C |
| --------------------------- | ------ | ------ | ------ |
| Marketplace support         |        |        |        |
| Submerchant/provider payout |        |        |        |
| Split payment               |        |        |        |
| Refund                      |        |        |        |
| Partial refund              |        |        |        |
| Webhook (imzalı)            |        |        |        |
| 3DS                         |        |        |        |
| Tokenization                |        |        |        |
| Settlement (süre, hesap)    |        |        |        |
| Fees                        |        |        |        |
| Sandbox                     |        |        |        |
| Documentation               |        |        |        |
| Support                     |        |        |        |
| Compliance (lisans, PCI)    |        |        |        |

- Pazaryeri/emanet modeli ve lisans gereksinimi: **Legal review required**.
- Seçimden sonra: adaptör, sözleşme testleri, staging denemesi, `PAYMENT_PROVIDER` enum değeri.
