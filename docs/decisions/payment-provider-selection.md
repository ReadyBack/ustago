# Ödeme sağlayıcısı seçimi

- **Durum:** DECISION REQUIRED
- **Sahip:** Ürün + finans + hukuk

UstaGO şu an yalnız `mock` (TEST parası) ve `disabled` ödeme sağlayıcısıyla çalışır. Soyutlama
([ADR-0019](../adr/0019-odeme-saglayici-soyutlamasi.md)) hazırdır; gerçek entegrasyon yoktur.

## Karar için sorular

- Türkiye'de lisanslı ödeme kuruluşu mu, pazaryeri (alt üye işyeri / emanet) modeli mi?
  **Legal review required** (6493 sayılı kanun kapsamı ve lisans gereksinimi doğrulanmadı).
- Ustaya ödeme (payout) aynı sağlayıcıdan mı yapılacak?
- 3D Secure, taksit, iade süresi, chargeback süreci, komisyon oranları.
- Webhook imzası, idempotency anahtarı ve test ortamı desteği.

## Seçim yapılınca

- Yeni `PaymentProvider` / `PayoutProvider` adaptörü, sözleşme testleri, staging denemesi.
- `PAYMENT_PROVIDER` enum'una yeni değer; mock üretimde zaten reddedilir.
