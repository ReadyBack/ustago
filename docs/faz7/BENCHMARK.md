<!-- Üretildi: apps/api/scripts/bench-faz7.ts (boş, migrate + seed edilmiş bir "bench" veritabanında). Tek bir yerel makine ölçümüdür; üretim kapasitesi değildir. -->
<!-- Yeniden üretmek: bench adlı yeni bir veritabanı oluştur, `pnpm db:deploy`, `DEMO_SEED=false pnpm db:seed`, sonra apps/api içinde `DATABASE_URL=... pnpm bench:faz7 --out ../../docs/faz7/BENCHMARK.md` -->

# Faz 7 benchmark

Tarih: 2026-09-30T18:35:38.227Z · Node 22.22.2 · 20 ölçüm (p50/p95), ısınma turu hariç.

| Sağlayıcı | Aday (uygun) | rank() p50 | rank() p95 | opportunities p50 | discovery p50 |
| --------- | ------------ | ---------- | ---------- | ----------------- | ------------- |
| 100       | 21           | 14.3 ms    | 30.4 ms    | 8.0 ms            | 17.0 ms       |
| 1000      | 218          | 23.8 ms    | 27.6 ms    | 6.7 ms            | 40.5 ms       |

| Sohbet (1000 mesaj)             | p50    | p95     |
| ------------------------------- | ------ | ------- |
| Son 50 mesaj                    | 5.9 ms | 16.5 ms |
| Ortadan eski sayfa (before)     | 6.3 ms | 10.4 ms |
| Yoklama, yeni mesaj yok (after) | 6.2 ms | 17.0 ms |

## EXPLAIN (ANALYZE, BUFFERS): eşleştirme aday sorgusu, 1000 usta

```
Limit  (cost=124.59..664.91 rows=64 width=137) (actual time=6.027..6.385 rows=218 loops=1)
  Buffers: shared hit=1687
  ->  Result  (cost=124.59..664.91 rows=64 width=137) (actual time=6.025..6.366 rows=218 loops=1)
        Buffers: shared hit=1687
        ->  Sort  (cost=124.59..124.75 rows=64 width=153) (actual time=5.382..5.411 rows=218 loops=1)
              Sort Key: ps.score DESC NULLS LAST, pr.id
              Sort Method: quicksort  Memory: 81kB
              Buffers: shared hit=1670
              ->  Nested Loop Anti Join  (cost=104.58..122.67 rows=64 width=153) (actual time=3.740..5.227 rows=218 loops=1)
                    Join Filter: (t.provider_id = pr.id)
                    Buffers: shared hit=1670
                    ->  Nested Loop Anti Join  (cost=104.58..117.71 rows=64 width=130) (actual time=3.711..4.277 rows=218 loops=1)
                          Join Filter: ((da.subject_id = pr.user_id) AND ((da.type = 'JOB_RESTRICTION'::"DisciplinaryActionType") OR ((da.type = 'NOW_SUSPENSION'::"DisciplinaryActionType") AND (sr.type = 'NOW'::"ServiceRequestType"))))
                          Buffers: shared hit=1670
                          ->  Nested Loop Anti Join  (cost=104.58..116.43 rows=64 width=134) (actual time=3.708..4.160 rows=218 loops=1)
                                Join Filter: ((NOT (SubPlan 22)) AND ((r.category_id = sr.category_id) OR (r.category_id = c.parent_id)))
                                Buffers: shared hit=1670
                                ->  Nested Loop Anti Join  (cost=104.58..115.47 rows=64 width=166) (actual time=3.705..4.040 rows=218 loops=1)
                                      Join Filter: (((ub.blocker_id = u.id) AND (ub.blocked_id = pr.user_id)) OR ((ub.blocker_id = pr.user_id) AND (ub.blocked_id = u.id)))
                                      Buffers: shared hit=1670
                                      ->  Nested Loop Left Join  (cost=104.58..114.19 rows=64 width=182) (actual time=3.698..3.931 rows=218 loops=1)
                                            Join Filter: (ps.provider_id = pr.id)
                                            Buffers: shared hit=1670
                                            ->  Merge Right Join  (cost=104.58..113.39 rows=64 width=169) (actual time=3.693..3.793 rows=218 loops=1)
                                                  Merge Cond: (scd.id = pr.service_center_district_id)
                                                  Filter: ((pr.max_travel_km IS NULL) OR (scd.latitude IS NULL) OR (COALESCE(sr.approx_latitude, d.latitude) IS NULL) OR (('12742.0176'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((COALESCE(sr.approx_latitude, d.latitude))::double precision - (scd.latitude)::double precision)) / '2'::double precision)), '2'::double precision) + ((cos(radians((scd.latitude)::double precision)) * cos(radians((COALESCE(sr.approx_latitude, d.latitude))::double precision))) * power(sin((radians(((COALESCE(sr.approx_longitude, d.longitude))::double precision - (scd.longitude)::double precision)) / '2'::double precision)), '2'::double precision))))))) <= (pr.max_travel_km)::double precision))
                                                  Rows Removed by Filter: 67
                                                  Buffers: shared hit=1670
                                                  ->  Index Scan using districts_pkey on districts scd  (cost=0.28..103.59 rows=973 width=29) (actual time=0.009..0.019 rows=16 loops=1)
                                                        Buffers: shared hit=34
                                                  ->  Sort  (cost=104.31..104.51 rows=82 width=174) (actual time=3.585..3.614 rows=285 loops=1)
                                                        Sort Key: pr.service_center_district_id
                                                        Sort Method: quicksort  Memory: 78kB
                                                        Buffers: shared hit=1636
                                                        ->  Hash Join  (cost=77.37..101.70 rows=82 width=174) (actual time=1.454..3.376 rows=285 loops=1)
                                                              Hash Cond: (ps_1.provider_id = pr.id)
                                                              Join Filter: (((NOT sr.preferred_only) OR (sr.preferred_provider_id IS NULL) OR (sr.preferred_provider_id = pr.id)) AND (u.id <> pr.user_id) AND (((sr.type = 'QUOTE'::"ServiceRequestType") AND c.supports_quote) OR ((sr.type = 'NOW'::"ServiceRequestType") AND c.supports_now AND pr.now_enabled AND pr.is_available_now AND (pr.account_status = 'ACTIVE'::"ProviderAccountStatus") AND (SubPlan 16) AND ((ov.province_id IS NULL) OR ov.now_enabled))) AND ((sr.type <> 'NOW'::"ServiceRequestType") OR (NOT (hashed SubPlan 19)) OR (hashed SubPlan 21)) AND ((hashed SubPlan 12) OR (hashed SubPlan 14) OR (SubPlan 15)))
                                                              Rows Removed by Join Filter: 715
                                                              Buffers: shared hit=1636
                                                              ->  Hash Join  (cost=23.87..47.87 rows=125 width=135) (actual time=0.072..0.444 rows=1000 loops=1)
                                                                    Hash Cond: (ps_1.category_id = c.id)
                                                                    Buffers: shared hit=21
                                                                    ->  Seq Scan on provider_services ps_1  (cost=0.00..19.00 rows=1000 width=32) (actual time=0.005..0.086 rows=1000 loops=1)
                                                                          Buffers: shared hit=9
                                                                    ->  Hash  (cost=23.86..23.86 rows=1 width=135) (actual time=0.052..0.059 rows=1 loops=1)
                                                                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                                                          Buffers: shared hit=12
                                                                          ->  Nested Loop Left Join  (cost=0.55..23.86 rows=1 width=135) (actual time=0.047..0.054 rows=1 loops=1)
                                                                                Join Filter: ((ov.province_id = sr.province_id) AND (ov.category_id = sr.category_id))
                                                                                Filter: ((ov.province_id IS NULL) OR ov.is_active)
                                                                                Buffers: shared hit=12
                                                                                ->  Nested Loop  (cost=0.55..23.85 rows=1 width=132) (actual time=0.045..0.051 rows=1 loops=1)
                                                                                      Buffers: shared hit=12
                                                                                      ->  Nested Loop  (cost=0.28..15.54 rows=1 width=132) (actual time=0.034..0.039 rows=1 loops=1)
                                                                                            Join Filter: (sr.customer_id = cp.id)
                                                                                            Buffers: shared hit=9
                                                                                            ->  Nested Loop  (cost=0.28..14.51 rows=1 width=132) (actual time=0.029..0.033 rows=1 loops=1)
                                                                                                  Buffers: shared hit=8
                                                                                                  ->  Nested Loop  (cost=0.00..6.20 rows=1 width=119) (actual time=0.021..0.024 rows=1 loops=1)
                                                                                                        Join Filter: (sr.province_id = p.id)
                                                                                                        Buffers: shared hit=4
                                                                                                        ->  Nested Loop Left Join  (cost=0.00..3.38 rows=1 width=119) (actual time=0.017..0.019 rows=1 loops=1)
                                                                                                              Join Filter: (pc.id = c.parent_id)
                                                                                                              Rows Removed by Join Filter: 8
                                                                                                              Filter: ((pc.id IS NULL) OR pc.is_active)
                                                                                                              Buffers: shared hit=3
                                                                                                              ->  Nested Loop  (cost=0.00..2.20 rows=1 width=119) (actual time=0.013..0.014 rows=1 loops=1)
                                                                                                                    Join Filter: (sr.category_id = c.id)
                                                                                                                    Buffers: shared hit=2
                                                                                                                    ->  Seq Scan on service_requests sr  (cost=0.00..1.02 rows=1 width=85) (actual time=0.007..0.007 rows=1 loops=1)
                                                                                                                          Filter: ((id = '01a0f399-cd70-71ef-bfba-9d6b0487e0ab'::uuid) AND (status = ANY ('{PUBLISHED,MATCHING,QUOTED}'::"ServiceRequestStatus"[])) AND ((expires_at IS NULL) OR (expires_at > now())))
                                                                                                                          Buffers: shared hit=1
                                                                                                                    ->  Seq Scan on service_categories c  (cost=0.00..1.08 rows=8 width=34) (actual time=0.005..0.005 rows=1 loops=1)
                                                                                                                          Filter: is_active
                                                                                                                          Buffers: shared hit=1
                                                                                                              ->  Seq Scan on service_categories pc  (cost=0.00..1.08 rows=8 width=17) (actual time=0.001..0.002 rows=8 loops=1)
                                                                                                                    Buffers: shared hit=1
                                                                                                        ->  Seq Scan on provinces p  (cost=0.00..2.81 rows=1 width=2) (actual time=0.004..0.004 rows=1 loops=1)
                                                                                                              Filter: is_active
                                                                                                              Rows Removed by Filter: 15
                                                                                                              Buffers: shared hit=1
                                                                                                  ->  Index Scan using districts_pkey on districts d  (cost=0.28..8.29 rows=1 width=29) (actual time=0.006..0.006 rows=1 loops=1)
                                                                                                        Index Cond: (id = sr.district_id)
                                                                                                        Filter: is_active
                                                                                                        Buffers: shared hit=4
                                                                                            ->  Seq Scan on customer_profiles cp  (cost=0.00..1.01 rows=1 width=32) (actual time=0.004..0.004 rows=1 loops=1)
                                                                                                  Buffers: shared hit=1
                                                                                      ->  Index Scan using users_pkey on users u  (cost=0.28..8.29 rows=1 width=16) (actual time=0.011..0.011 rows=1 loops=1)
                                                                                            Index Cond: (id = cp.user_id)
                                                                                            Filter: ((deleted_at IS NULL) AND (status = 'ACTIVE'::"UserStatus"))
                                                                                            Buffers: shared hit=3
                                                                                ->  Seq Scan on province_categories ov  (cost=0.00..0.00 rows=1 width=20) (actual time=0.001..0.001 rows=0 loops=1)
                                                              ->  Hash  (cost=41.00..41.00 rows=1000 width=81) (actual time=0.461..0.462 rows=1000 loops=1)
                                                                    Buckets: 1024  Batches: 1  Memory Usage: 124kB
                                                                    Buffers: shared hit=21
                                                                    ->  Seq Scan on provider_profiles pr  (cost=0.00..41.00 rows=1000 width=81) (actual time=0.004..0.214 rows=1000 loops=1)
                                                                          Filter: ((deleted_at IS NULL) AND accepting_new_jobs AND (account_status = ANY ('{ACTIVE,LIMITED}'::"ProviderAccountStatus"[])) AND (status = 'ACTIVE'::"ProviderStatus") AND ((unavailable_until IS NULL) OR (unavailable_until <= now())))
                                                                          Buffers: shared hit=21
                                                              SubPlan 16
                                                                ->  Seq Scan on provider_verification_cases vc_1  (cost=0.00..0.00 rows=1 width=0) (never executed)
                                                                      Filter: ((provider_id = pr.id) AND (status = 'VERIFIED'::"ProviderVerificationStatus"))
                                                              SubPlan 19
                                                                ->  Seq Scan on provider_weekly_hours wh  (cost=0.00..59.00 rows=3000 width=16) (never executed)
                                                              SubPlan 21
                                                                ->  Bitmap Heap Scan on provider_weekly_hours wh_1  (cost=118.31..183.56 rows=1 width=16) (never executed)
                                                                      Recheck Cond: ((weekday = (EXTRACT(isodow FROM (now() AT TIME ZONE 'Europe/Istanbul'::text)))::integer) AND (start_minute <= (((EXTRACT(hour FROM (now() AT TIME ZONE 'Europe/Istanbul'::text)) * '60'::numeric) + EXTRACT(minute FROM (now() AT TIME ZONE 'Europe/Istanbul'::text))))::integer))
                                                                      Filter: (end_minute > (((EXTRACT(hour FROM (now() AT TIME ZONE 'Europe/Istanbul'::text)) * '60'::numeric) + EXTRACT(minute FROM (now() AT TIME ZONE 'Europe/Istanbul'::text))))::integer)
                                                                      ->  Bitmap Index Scan on provider_weekly_hours_provider_id_weekday_start_minute_key  (cost=0.00..118.31 rows=500 width=0) (never executed)
                                                                            Index Cond: ((weekday = (EXTRACT(isodow FROM (now() AT TIME ZONE 'Europe/Istanbul'::text)))::integer) AND (start_minute <= (((EXTRACT(hour FROM (now() AT TIME ZONE 'Europe/Istanbul'::text)) * '60'::numeric) + EXTRACT(minute FROM (now() AT TIME ZONE 'Europe/Istanbul'::text))))::integer))
                                                              SubPlan 12
                                                                ->  Seq Scan on provider_service_areas pa_1  (cost=0.00..37.00 rows=2000 width=32) (actual time=0.003..0.180 rows=2000 loops=1)
                                                                      Buffers: shared hit=17
                                                              SubPlan 14
                                                                ->  Seq Scan on provider_service_regions rg  (cost=0.00..7.94 rows=200 width=18) (actual time=0.047..0.085 rows=200 loops=1)
                                                                      Filter: (active AND (kind = 'PROVINCE'::"ProviderRegionKind"))
                                                                      Rows Removed by Filter: 115
                                                                      Buffers: shared hit=4
                                                              SubPlan 15
                                                                ->  Result  (cost=0.27..8.37 rows=1 width=0) (actual time=0.001..0.001 rows=0 loops=734)
                                                                      One-Time Filter: (COALESCE(sr.approx_latitude, d.latitude) IS NOT NULL)
                                                                      Buffers: shared hit=1573
                                                                      ->  Index Scan using provider_service_regions_provider_id_active_idx on provider_service_regions rg_1  (cost=0.27..8.37 rows=1 width=0) (actual time=0.001..0.001 rows=0 loops=734)
                                                                            Index Cond: ((provider_id = pr.id) AND (active = true))
                                                                            Filter: ((kind = 'RADIUS'::"ProviderRegionKind") AND (('12742.0176'::double precision * asin(LEAST('1'::double precision, sqrt((power(sin((radians(((COALESCE(sr.approx_latitude, d.latitude))::double precision - (center_lat)::double precision)) / '2'::double precision)), '2'::double precision) + ((cos(radians((center_lat)::double precision)) * cos(radians((COALESCE(sr.approx_latitude, d.latitude))::double precision))) * power(sin((radians(((COALESCE(sr.approx_longitude, d.longitude))::double precision - (center_lng)::double precision)) / '2'::double precision)), '2'::double precision))))))) <= (radius_km)::double precision))
                                                                            Rows Removed by Filter: 0
                                                                            Buffers: shared hit=1573
                                            ->  Seq Scan on provider_scores ps  (cost=0.00..0.00 rows=1 width=29) (actual time=0.000..0.000 rows=0 loops=218)
                                      ->  Seq Scan on user_blocks ub  (cost=0.00..0.00 rows=1 width=32) (actual time=0.000..0.000 rows=0 loops=218)
                                ->  Seq Scan on category_provider_requirements r  (cost=0.00..0.00 rows=1 width=20) (actual time=0.000..0.000 rows=0 loops=218)
                                      Filter: (deactivated_at IS NULL)
                                SubPlan 22
                                  ->  Seq Scan on provider_verifications v  (cost=0.00..0.00 rows=1 width=0) (never executed)
                                        Filter: ((provider_id = pr.id) AND (type = r.document_type) AND (status = 'APPROVED'::"VerificationStatus"))
                          ->  Seq Scan on disciplinary_actions da  (cost=0.00..0.00 rows=1 width=20) (actual time=0.000..0.000 rows=0 loops=218)
                                Filter: ((status = ANY ('{ACTIVE,UNDER_APPEAL}'::"DisciplinaryActionStatus"[])) AND (subject_role = 'PROVIDER'::"TrustSubjectRole") AND (starts_at <= now()) AND ((ends_at IS NULL) OR (ends_at > now())) AND ((type = 'JOB_RESTRICTION'::"DisciplinaryActionType") OR (type = 'NOW_SUSPENSION'::"DisciplinaryActionType")))
                    ->  Seq Scan on provider_time_off t  (cost=0.00..0.00 rows=1 width=16) (actual time=0.000..0.000 rows=0 loops=218)
                          Filter: ((cancelled_at IS NULL) AND (starts_at <= now()) AND (ends_at > now()))
                    SubPlan 3
                      ->  Aggregate  (cost=0.00..0.01 rows=1 width=8) (actual time=0.000..0.000 rows=1 loops=218)
                            ->  Seq Scan on jobs j  (cost=0.00..0.00 rows=1 width=0) (actual time=0.000..0.000 rows=0 loops=218)
                                  Filter: ((provider_id = pr.id) AND (status = 'COMPLETED'::"JobStatus"))
                    SubPlan 4
                      ->  Aggregate  (cost=0.00..0.01 rows=1 width=8) (actual time=0.000..0.000 rows=1 loops=218)
                            ->  Seq Scan on jobs j_1  (cost=0.00..0.00 rows=1 width=0) (actual time=0.000..0.000 rows=0 loops=218)
                                  Filter: ((provider_id = pr.id) AND (cancellation_actor = 'PROVIDER'::"JobActor") AND (created_at > (now() - '90 days'::interval)))
                    SubPlan 5
                      ->  Aggregate  (cost=0.00..0.01 rows=1 width=8) (actual time=0.000..0.000 rows=1 loops=218)
                            ->  Seq Scan on jobs j_2  (cost=0.00..0.00 rows=1 width=0) (actual time=0.000..0.000 rows=0 loops=218)
                                  Filter: (((cancellation_actor IS NULL) OR (cancellation_actor = 'PROVIDER'::"JobActor")) AND (provider_id = pr.id) AND (created_at > (now() - '90 days'::interval)))
                    SubPlan 6
                      ->  Seq Scan on provider_verification_cases vc  (cost=0.00..0.00 rows=1 width=0) (actual time=0.000..0.000 rows=0 loops=218)
                            Filter: ((provider_id = pr.id) AND (status = 'VERIFIED'::"ProviderVerificationStatus"))
                    SubPlan 8
                      ->  Seq Scan on disciplinary_actions da_1  (cost=0.00..0.00 rows=1 width=0) (actual time=0.000..0.000 rows=0 loops=218)
                            Filter: ((status = ANY ('{ACTIVE,UNDER_APPEAL}'::"DisciplinaryActionStatus"[])) AND (subject_id = pr.user_id) AND (subject_role = 'PROVIDER'::"TrustSubjectRole") AND (type = 'VISIBILITY_REDUCTION'::"DisciplinaryActionType") AND (starts_at <= now()) AND ((ends_at IS NULL) OR (ends_at > now())))
                    SubPlan 10
                      ->  Aggregate  (cost=0.00..0.01 rows=1 width=8) (actual time=0.000..0.000 rows=1 loops=218)
                            ->  Seq Scan on disciplinary_actions da_2  (cost=0.00..0.00 rows=1 width=0) (actual time=0.000..0.000 rows=0 loops=218)
                                  Filter: ((status = ANY ('{ACTIVE,UNDER_APPEAL}'::"DisciplinaryActionStatus"[])) AND (subject_id = pr.user_id) AND (subject_role = 'PROVIDER'::"TrustSubjectRole") AND (type = 'WARNING'::"DisciplinaryActionType") AND (starts_at <= now()) AND ((ends_at IS NULL) OR (ends_at > now())))
        SubPlan 2
          ->  Seq Scan on provider_service_areas pa  (cost=0.00..37.00 rows=2000 width=32) (actual time=0.004..0.181 rows=2000 loops=1)
                Buffers: shared hit=17
Planning:
  Buffers: shared hit=649
Planning Time: 8.621 ms
Execution Time: 6.781 ms
```
