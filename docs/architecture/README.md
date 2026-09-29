# Mimari

Genel teknik mimari için kökteki [PROJECT.md](../../PROJECT.md) §15–22 ve [ADR'ler](../adr/README.md).

```text
apps/mobile (Expo) ─┐
                    ├─ HTTP /api/v1 ─> apps/api (NestJS) ─┬─> PostgreSQL (Prisma)
apps/admin (Next) ──┘                                     └─> Redis (cache / BullMQ)
```
