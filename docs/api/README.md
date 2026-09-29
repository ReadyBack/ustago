# API

- Taban yol: `/api/v1`
- Swagger UI (lokal): http://localhost:3000/api/docs
- Standart hata gövdesi: `@ustago/types` → `ApiErrorResponse`

| Uç nokta                  | Açıklama                                                                      |
| ------------------------- | ----------------------------------------------------------------------------- |
| `GET /api/v1/health`      | Hazırlık kontrolü: PostgreSQL ve Redis. DB yoksa 503, Redis yoksa `degraded`. |
| `GET /api/v1/health/live` | Canlılık: sadece süreç ayakta mı.                                             |
