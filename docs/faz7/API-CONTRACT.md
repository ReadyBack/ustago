# Faz 7 API sözleşmesi

Tüm yollar `/api/v1` altındadır. Tipler `@ustago/types`, istek/yanıt şemaları
`@ustago/validation` içindedir (dosyalar: `provider-ops.ts`, `discovery.ts`,
`chat.ts`, `analytics.ts`, `marketplace.ts`, `lifecycle.ts`, `catalog.ts`).
Listeler Faz 2'deki gibi `Paginated<T>` (`{ items, nextCursor }`) döner; aksi
belirtilmişse orada yazar. Hata gövdesi değişmedi (`apiErrorResponseSchema`).

Sahip sütunu bu fazın iç iş bölümüdür (kod sahipliği), ürün davranışı değildir.

## Konum ve kapsama (usta)

| Yöntem | Yol                      | Gövde / sorgu                                                             | Yanıt              | Sahip |
| ------ | ------------------------ | ------------------------------------------------------------------------- | ------------------ | ----- |
| GET    | `/providers/me/coverage` |                                                                           | `ProviderCoverage` | core  |
| PUT    | `/providers/me/regions`  | `setProviderRegionsSchema`                                                | `ProviderCoverage` | core  |
| PATCH  | `/providers/me/coverage` | `updateCoverageSettingsSchema` (`maxTravelKm`, `serviceCenterDistrictId`) | `ProviderCoverage` | core  |
| GET    | `/locations/provinces`   | (değişmedi) her il artık `launchStatus` ve `countryCode` taşır            | `Province[]`       | core  |

Mevcut `PUT /providers/me/service-areas` (ilçe listesi) aynen kalır.

## Müsaitlik (usta)

| Yöntem | Yol                                   | Gövde                                                                       | Yanıt                  | Sahip |
| ------ | ------------------------------------- | --------------------------------------------------------------------------- | ---------------------- | ----- |
| GET    | `/providers/me/availability-settings` |                                                                             | `ProviderAvailability` | core  |
| PATCH  | `/providers/me/availability-settings` | `updateAvailabilitySettingsSchema` (`acceptingNewJobs?`, `availableToday?`) | `ProviderAvailability` | core  |
| PUT    | `/providers/me/weekly-hours`          | `setWeeklyHoursSchema`                                                      | `ProviderAvailability` | core  |
| POST   | `/providers/me/time-off`              | `createTimeOffSchema`                                                       | `ProviderAvailability` | core  |
| DELETE | `/providers/me/time-off/:id`          |                                                                             | `ProviderAvailability` | core  |
| GET    | `/providers/me/home`                  |                                                                             | `ProviderHome`         | core  |

Mevcut `PATCH /providers/me/availability` (NOW "müsaitim") aynen kalır.

## Usta gelen kutusu, dağıtım

| Yöntem | Yol                                   | Sorgu / gövde                                                                                   | Yanıt                                                                                                                         | Sahip |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----- |
| GET    | `/opportunities`                      | `listOpportunitiesQuerySchema` + `sort=NEW\|NEAREST\|BUDGET`, `maxDistanceKm`, `dispatchedOnly` | `Paginated<Opportunity>` (`distance`, `dispatch`, `isPreferredForMe`, `answers`, `budgetMax`, `scheduleOption`, `photoCount`) | core  |
| GET    | `/opportunities/:id`                  |                                                                                                 | `Opportunity` (açınca `viewedAt` kaydedilir)                                                                                  | core  |
| POST   | `/service-requests/:id/expand-search` | `expandSearchSchema`                                                                            | `ServiceRequest` (müşteri)                                                                                                    | core  |

## Talep V2 (müşteri)

| Yöntem | Yol                            | Gövde / sorgu                                                                                                                         | Yanıt                                          | Sahip   |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------- |
| POST   | `/service-requests`            | `createServiceRequestSchema` + `budgetMaxMinor`, `scheduleOption`, `answers`, `preferredProviderId`, `preferredOnly`, `rehireOfJobId` | `ServiceRequest`                               | core    |
| GET    | `/service-requests/:id`        |                                                                                                                                       | `ServiceRequest` (`dispatch: DispatchSummary`) | core    |
| GET    | `/categories/:id/request-form` |                                                                                                                                       | `RequestForm`                                  | profile |
| GET    | `/categories/:id/price-guide`  | `priceGuideQuerySchema` (`provinceId?`)                                                                                               | `PriceGuide`                                   | profile |
| GET    | `/jobs/:id/rehire`             |                                                                                                                                       | `RehireDraft`                                  | core    |
| GET    | `/service-requests/:id/quotes` | (değişmedi) teklifler artık `comparisonLabels`, `distance`, `conversationId` taşır                                                    | `Quote[]`                                      | core    |
| POST   | `/service-requests/:id/quotes` | `createQuoteSchema` + `serviceMinor`, `otherMinor`, `arrivalEta`                                                                      | `Quote`                                        | core    |

## Keşif, arama, favoriler, ana sayfa (müşteri)

| Yöntem | Yol                                  | Sorgu / gövde                                                                                                                             | Yanıt                         | Sahip   |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------- |
| GET    | `/search`                            | `searchQuerySchema` (`q`, `provinceId?`)                                                                                                  | `SearchResult`                | core    |
| POST   | `/search/click`                      | `searchClickSchema`                                                                                                                       | 204                           | core    |
| GET    | `/categories/popular`                | `popularCategoriesQuerySchema`                                                                                                            | `CategoryRef[]`               | core    |
| GET    | `/providers`                         | `discoverProvidersQuerySchema` (`categoryId`, `districtId?`, `sort`, `availableToday?`, `verifiedOnly?`, `minRating?`, `cursor`, `limit`) | `Paginated<ProviderCard>`     | core    |
| GET    | `/providers/:id`                     | `providerProfileQuerySchema` (`districtId?`)                                                                                              | `PublicProviderProfileV2`     | profile |
| GET    | `/providers/:id/reviews`             | `listProviderReviewsQuerySchema` + `sort`, `rating?`                                                                                      | `Paginated<PublicReview>`     | profile |
| GET    | `/providers/:id/review-distribution` |                                                                                                                                           | `ReviewDistribution`          | profile |
| GET    | `/me/favorites`                      | cursor                                                                                                                                    | `Paginated<FavoriteProvider>` | core    |
| PUT    | `/me/favorites/:providerId`          |                                                                                                                                           | 204 (idempotent)              | core    |
| DELETE | `/me/favorites/:providerId`          |                                                                                                                                           | 204 (idempotent)              | core    |
| GET    | `/me/home`                           |                                                                                                                                           | `CustomerHome`                | core    |
| GET    | `/me/badges`                         |                                                                                                                                           | `BadgeCounts`                 | chat    |

## Portföy, profil fotoğrafı, yorum yanıtı (usta)

| Yöntem | Yol                                     | Gövde                       | Yanıt                             | Sahip   |
| ------ | --------------------------------------- | --------------------------- | --------------------------------- | ------- |
| POST   | `/providers/me/photo/upload-intent`     | `imageUploadIntentSchema`   | `UploadIntent` (Faz 6 biçimi)     | profile |
| PUT    | `/providers/me/photo`                   | `setProfilePhotoSchema`     | `{ photoUrl }`                    | profile |
| DELETE | `/providers/me/photo`                   |                             | 204                               | profile |
| GET    | `/providers/me/portfolio`               |                             | `PortfolioItem[]`                 | profile |
| POST   | `/providers/me/portfolio`               | `createPortfolioItemSchema` | `PortfolioItem`                   | profile |
| PATCH  | `/providers/me/portfolio/:id`           | `updatePortfolioItemSchema` | `PortfolioItem`                   | profile |
| DELETE | `/providers/me/portfolio/:id`           |                             | 204                               | profile |
| PUT    | `/providers/me/portfolio/order`         | `reorderPortfolioSchema`    | `PortfolioItem[]`                 | profile |
| POST   | `/providers/me/portfolio/upload-intent` | `imageUploadIntentSchema`   | `UploadIntent`                    | profile |
| POST   | `/reviews/:id/reply`                    | `replyToReviewSchema`       | `ProviderReviewReply` (tek sefer) | profile |

## Mesajlaşma

| Yöntem | Yol                                       | Gövde / sorgu                                          | Yanıt                                               | Sahip |
| ------ | ----------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- | ----- |
| POST   | `/conversations`                          | `openConversationSchema` (`quoteId` veya `jobId`)      | `ConversationDetail` (varsa mevcut)                 | chat  |
| GET    | `/conversations`                          | `listConversationsQuerySchema`                         | `Paginated<ConversationListItem>`                   | chat  |
| GET    | `/conversations/:id`                      |                                                        | `ConversationDetail`                                | chat  |
| GET    | `/conversations/:id/messages`             | `listMessagesQuerySchema` (`before`, `after`, `limit`) | `MessagePage`                                       | chat  |
| POST   | `/conversations/:id/messages`             | `sendMessageSchema` (TEXT/IMAGE, `clientMessageId`)    | `ChatMessage` (aynı `clientMessageId` → aynı mesaj) | chat  |
| POST   | `/conversations/:id/read`                 | `markConversationReadSchema`                           | 204                                                 | chat  |
| POST   | `/conversations/:id/images/upload-intent` | `imageUploadIntentSchema`                              | `UploadIntent`                                      | chat  |
| GET    | `/messages/:id/image-url`                 |                                                        | `{ url, expiresAt }`                                | chat  |
| POST   | `/messages/:id/report`                    | `reportMessageSchema`                                  | 204                                                 | chat  |
| PUT    | `/conversations/:id/block`                | (karşı tarafı engeller)                                | `ConversationDetail`                                | chat  |
| DELETE | `/conversations/:id/block`                |                                                        | `ConversationDetail`                                | chat  |
| GET    | `/admin/message-reports`                  | `listMessageReportsQuerySchema`                        | `Paginated<AdminMessageReport>`                     | chat  |
| POST   | `/admin/message-reports/:id/access`       | `accessReportedConversationSchema` (gerekçe)           | `AdminReportedConversation` (denetim kaydı)         | chat  |
| POST   | `/admin/message-reports/:id/resolve`      | `resolveMessageReportSchema`                           | `AdminMessageReport`                                | chat  |

Sistem mesajları (teklif geldi, teklif kabul edildi, iş başladı, iş tamamlandı,
ek iş) `ConversationsService.postSystemEventIn(tx, { serviceRequestId,
providerId, eventKey, body })` ile yazılır; `eventKey` tekrarı yok sayar.

## Bildirimler V2

| Yöntem    | Yol                         | Gövde / sorgu                                             | Yanıt                                     | Sahip        |
| --------- | --------------------------- | --------------------------------------------------------- | ----------------------------------------- | ------------ |
| GET       | `/notifications`            | `listNotificationsQuerySchema` + `category?`              | `Paginated<AppNotification>` (`category`) | core (hazır) |
| POST      | `/notifications/read`       | `{ ids?: string[], all?: true, category? }` (mevcut)      | 204                                       | core (hazır) |
| GET/PATCH | `/notification-preferences` | + `newMessagePush`, `newJobAlerts`, `quietHoursStart/End` | `NotificationPreferences`                 | core (hazır) |

## Admin: kategori, konum, pazar yeri

| Yöntem | Yol                                    | Gövde / sorgu                                                | Yanıt                          | Sahip        |
| ------ | -------------------------------------- | ------------------------------------------------------------ | ------------------------------ | ------------ |
| GET    | `/admin/categories/:id/questions`      |                                                              | `CategoryQuestion[]`           | profile      |
| POST   | `/admin/categories/:id/questions`      | `createCategoryQuestionSchema`                               | `CategoryQuestion`             | profile      |
| PATCH  | `/admin/category-questions/:id`        | `updateCategoryQuestionSchema` (silme yok: `isActive=false`) | `CategoryQuestion`             | profile      |
| GET    | `/admin/categories/:id/aliases`        |                                                              | `{ id, alias }[]`              | profile      |
| POST   | `/admin/categories/:id/aliases`        | `createCategoryAliasSchema`                                  | `{ id, alias }`                | profile      |
| DELETE | `/admin/category-aliases/:id`          |                                                              | 204                            | profile      |
| PATCH  | `/categories/:id`                      | + `requestPhotoPolicy`                                       | `Category`                     | profile      |
| PATCH  | `/locations/provinces/:id`             | `updateProvinceRequestSchema` (`isActive?`, `waitlistOpen?`) | `Province`                     | core (hazır) |
| GET    | `/admin/marketplace/overview`          | `marketplaceOverviewQuerySchema` (`days`)                    | `MarketplaceOverview`          | core         |
| GET    | `/admin/marketplace/regions`           | `regionStatsQuerySchema` (`days`, `provinceId?`)             | `RegionStats[]`                | core         |
| GET    | `/admin/marketplace/categories`        | `categoryStatsQuerySchema`                                   | `CategoryStats[]`              | core         |
| GET    | `/admin/marketplace/no-offer`          | `noOfferQuerySchema`                                         | `Paginated<NoOfferRequestRow>` | core         |
| GET    | `/admin/service-requests/:id/dispatch` |                                                              | `AdminDispatchTimeline`        | core         |
| GET    | `/admin/marketplace/match-preview`     | `matchPreviewQuerySchema` (`requestId`)                      | `AdminMatchPreview`            | core         |

## Mobil yönlendirme (deep link)

- `message.*` bildirimleri → `/messages/:conversationId`
- Diğerleri Faz 4 ile aynı (`/job/:id`, `/request/:id`, `/opportunity/:id`, ...).
