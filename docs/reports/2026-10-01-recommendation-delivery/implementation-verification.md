# Recommendation delivery repair verification

Date: 2026-10-01 NZDT. Work starts from main `3748973331e8ab78187de3c67bfbaf890bae37a4`; the older investigation checkout and original evidence are preserved. This report qualifies the implementation; the adjacent `report.md` describes the earlier production diagnosis.

## Post-deployment disposition — October 2

[PR #2527](https://github.com/JesusFilm/forge/pull/2527) merged and deployed on
October 1; [production verification](https://github.com/JesusFilm/forge/pull/2527#issuecomment-5923920742)
confirmed both services, migrations, live cards and player availability. The
owner accepted the remaining [coverage limitations](../2026-10-02-recommendation-coverage-acceptance.md)
as intended behavior and approved proceeding. Server failures and timeouts
remain actionable; row shortfalls or absent co-watch contribution alone do not
reopen this repair. The implementation-time measurements and rollout procedure
below are retained as historical evidence.

## Behavior and decisions

- Exact playable audio is eligible before each 48-neighbor limit. A materialized set of playable dubs for the requested audio is built once, used for ANN membership and final playback selection. Eight probes, custom planning, strict iterative scan, 20,000 approximate tuple cap and the immutable 1,500 ms complete-service budget remain unchanged.
- Transcript, presentation and exact audio have separate identities. Chinese transcripts remain `zh`; the owner's October 1 answer defaults generic `zh` to `zh-hans`. Explicit Hans/Hant requests preserve that script. Profile, co-watch, curated and cached eligibility follow the same transcript mapping. No translation or audio substitution is allowed.
- Empty requests now retain bounded versioned context and observed stage facts on their existing request root. The additive nullable JSON column is capped at 2,048 bytes; no viewer/history IDs, vectors or credentials are included, and existing expiry applies. Historical empty-request audio remains unknown. `compatible_embedding_unavailable` includes absent/NULL chunks and incompatible contracts; it does not falsely diagnose every such seed as incompatible.
- Availability booleans describe observed published text/playable audio anywhere in the catalog, not a guarantee that a particular seed has sufficient eligible targets. ANN counts describe bounded search only. Interrupted/unattempted stages remain null. An approved but exhausted curated context is distinct from a missing context.
- Web retains Admin's empty/unavailable result instead of running legacy recovery that could select wrong audio, translated fallback text or excluded family cards. This may remove previously visible but ineligible cards; it also removes two extra upstream recovery requests. Player startup remains independent.
- The owner approved semantic partial-row top-up on October 1: fill remaining slots from the existing eligible bounded semantic pool, preserving existing cards; serve the existing row unchanged when no eligible additions exist. Curated fallback retains its empty-only rule. This repair neither expands inventory nor establishes a global fill-rate improvement. Existing feat-497 owns pool coverage and feat-199 owns transcript sourcing.

## Architecture reconciliation

The August architecture plan was read and reconciled with current main and subsequent recorded owner decisions. No matching original August chat was recovered from the available session search, so this report does not claim that chat was read. Later exact-requested-translation policy (feat-487), September 10 analytics policy, September 14 accepted 51-context coverage, September 29 historical-evidence dispositions, and September 30 direct co-watch/MMR owner activation remain authoritative. This repair introduces no consent prerequisite or new activation/trial gate. Source-free curated composition policy does not imply seeded partial-row top-up.

No public GraphQL arguments/types changed; the existing `locale` carries requested presentation and transcript identity is derived internally. Schema/client regeneration is therefore unnecessary.

## Semantic partial-row policy verification

The October 1 owner decision is already implemented by the bounded composer. Ordinary semantic and hybrid composition scan the eligible ordered pool, using recent-history candidates as reserves where needed, until the six-card limit or pool exhaustion. Owner and trial MMR also compose from their bounded eligible pools. A nonempty exhausted row is served unchanged; curated fallback runs only when no cards survive. No extra retrieval or runtime change was needed to satisfy this policy.

Two parameterized service regressions exercise eight and nine nominations containing a duplicate canonical identity, wrong audio, unplayable media and a recent semantic reserve. They verify five-card exhaustion versus six-card fill, preserve the fresh selected prefix and order, check served/composed evidence and semantic provenance, require one retrieval, and prohibit curated fallback. The existing four-card exhausted-supply regression remains. All 34 tests in `delivery.service.test.ts` pass. The combined delivery, owner delivery, trial composition, composition policy and curated fallback run passes all 77 tests. Admin typecheck and scoped zero-warning ESLint pass, and independent focused review found no actionable defects. These regressions do not remeasure latency; runtime code and the previously measured deadline are unchanged by this policy-verification follow-up.

## Representative complete-service measurement

The owned local PostgreSQL 18.6 / pgvector 0.8.6 database contains the approved September 8 content-only archive: 1,175 videos, 212,171 dubs, 164,700 transcripts and 280,107 embedded chunks. The source archive SHA-256 is `e4ffbc71d9d0c38065774c90a312e58d030977bdd5bcf42d93b5a24c958e4530`. It contains no production viewers, history, profiles or request items. Synthetic request writes are isolated in a temporary test schema, removed after the test.

`delivery-multilingual.db.test.ts` exercises real retrieval, candidate orchestration/deduplication, exact playback verification, signing, ledger persistence and serialization. Admission and serving-manifest authority are fixture substitutes. Cold means cleared application pools, not flushed database/OS caches. Warm means a repeated same-process request (fresh retrieval is still attempted). Concurrent means three requests in one context; these measurements are not production HTTP p95s or fleet-capacity proof.

All 55 deliveries in 11 contexts passed: 209.65–1,182.99 ms, no timeout/unavailable responses. Each issued capability was verified, every card matched the requested audio, and source/direct-family/canonical duplicates were excluded.

| Seed           | Presentation / exact audio         | Candidates | Cards | Cold ms | Warm ms | Max of 3 concurrent ms |
| -------------- | ---------------------------------- | ---------: | ----: | ------: | ------: | ---------------------: |
| birth-of-jesus | en / gbii                          |         36 |     6 |     462 |     301 |                    404 |
| the-beginning  | en / kwanyama                      |         36 |     6 |     312 |     294 |                    378 |
| creation       | en / idioma-wanca                  |         31 |     6 |     213 |     210 |                    238 |
| jesus          | en / gbii                          |          2 |     2 |     771 |     749 |                    799 |
| birth-of-jesus | en / english                       |         36 |     6 |     245 |     239 |                    321 |
| jesus          | fr / french                        |         36 |     6 |     344 |     338 |                    399 |
| jesus          | es / spanish-latin-american        |         36 |     6 |     292 |     258 |                    363 |
| jesus          | pt / portuguese-brazil             |         36 |     6 |     918 |     882 |                   1022 |
| jesus          | zh → zh-hans / mandarin-china      |         36 |     6 |     956 |     950 |                   1085 |
| jesus          | zh-Hans → zh-hans / mandarin-china |         36 |     6 |     953 |     913 |                   1183 |
| jesus          | zh-Hant → zh-hant / mandarin-china |         36 |     6 |     960 |     910 |                   1086 |

Full JESUS/Gbii honestly remains a two-card row. The snapshot is historical: these counts do not establish current production supply. See `implementation-service-measurements.json` for all samples, payload sizes and persisted stage diagnostics.

## Query performance failure and repair

The first audio-prefilter implementation retained HNSW but repeatedly joined the requested-language dubs for every vector. Nine of ten original snapshot contexts timed out; the small deterministic fixture alone missed this failure. A diagnostic `EXPLAIN (ANALYZE, BUFFERS)` for Birth/Gbii took 1,519.215 ms, with 4,477 dub scans and 340,307 mux lookups. Building the exact-audio set once reduced that sample to 195.478 ms, one dub scan and 79 mux lookups while preserving the HNSW index. Final English and Wanca SQL samples took 143.029 and 80.392 ms. Diagnostic SQL used a longer safety timeout and is not the service acceptance gate; the 55 full-service samples above are the separate gate. See `implementation-query-plan-summary.json`.

## Validation

Admin and Web typechecks pass. All 341 Web recommendation tests pass. Scoped TypeScript ESLint passes with zero warnings, and regenerated Admin GraphQL SDL has no diff. The real-PostgreSQL diagnostic/retrieval/locale subset passed 29 tests (one optional Redis test skipped); the 11-context snapshot suite passed separately. The final affected Admin run passed 89 tests with one optional Redis skip; native owner-release delivery passed two tests on its required owned `forge_test` database. The broader exploratory run passed 1,017 tests but is not an all-suite pass: 18 files refused mismatched dedicated-fixture requirements, and two unchanged fixtures failed (a fixed September 17 expiry and viewing-mode schema predating `owner_release_id`). These two pre-existing fixture issues are tracked in feat-612; named-database safety guards were preserved. The deterministic PostgreSQL regression includes more than 48 nearer wrong-audio chunks, inactive provenance, exact scripts, missing chosen text, deleted/unplayable audio, parent/child exclusions, sparse two/zero-card supply, prepared-query reuse and transaction-local setting cleanup. New no-chunk/NULL-embedding cases verify truthful diagnostic classification. The separate Web lifecycle test switches script during an in-flight request and verifies cancelled Simplified cards never appear or emit evidence.

Browser checks passed empty, Admin timeout, GraphQL error and transport timeout scenarios through the real Web Route Handler. The synthetic player shell preceded every delivery and remained visible, with no browser errors and no legacy fallback calls. A warm reload measured TTFB 249 ms, FCP/LCP 468 ms and CLS 0. Rendering/initialization code is unchanged; these local fixture measurements verify isolation, not actual media playback or a production before/after percentile. See [browser verification](browser-verification.md) for screenshots, exact method and limits.

## Rollout and rollback

No production data, inventory, embedding generation, activation settings or deployments were changed by this task. Read-only Railway verification at 2026-09-30 20:10 UTC recorded Admin SUCCESS `3748973331e8ab78187de3c67bfbaf890bae37a4` and Web SUCCESS `2cada63166aabfa2d9214009c6515a4c7576e880`.

1. Merge through the normal PR-to-main flow. Admin's migration 0126 adds a nullable column, so older binaries remain compatible. Its CHECK is `NOT VALID` to avoid scanning the historical ledger under the deployment DDL lock; it enforces new writes immediately. All pre-existing rows remain NULL. Confirm migration success before the new Admin starts.
2. Confirm the deployed revisions and ready serving state. Verify ordinary new requests retain exact audio/script, diagnostics fit the bound, and existing players continue to start through empty/error/timeout states. Web has no additive GraphQL deployment dependency; deploying Admin first makes the repair available before retiring unsafe Web recovery.
3. Use adjacent `rollout-verification.sql` for a bounded new-request cohort. Compare matched seed/presentation/audio, strategy and traffic mix; count full, partial, empty and timeout outcomes separately. Historical English empties lack audio and cannot support an exact-audio before/after claim. Null stages do not prove catalog absence. Check live latency/error monitors as well: fixture timings are not fleet capacity or production percentile evidence.
4. Preserve accepted missing-translation/pool contexts and the full-JESUS/Gbii shortfall. Follow existing feat-497/199 coverage work, not new blanket embedding spend. Apply bounded semantic top-up where eligible supply exists; exhausted supply must retain the existing cards, and curated fallback remains empty-only.
5. Roll back application changes by a normal revert PR if exact-identity, latency or player availability regresses. The nullable column can remain; do not drop diagnostics or rewrite historical requests during rollback. A rollback restores prior retrieval limitations and prior Web recovery behavior and must be evaluated accordingly.

## Reproducible local commands

Run from the repository root with the owned fixture ports from this session, or substitute equivalent owned local databases:

```sh
pnpm --filter @forge/admin exec vitest run src/services/recommendations/delivery.service.test.ts src/services/recommendations/delivery-owner.test.ts src/services/recommendations/delivery-trial-composition.test.ts src/services/recommendations/composition/policy.test.ts src/services/recommendations/curated-fallback.test.ts --no-file-parallelism
DATABASE_URL=postgresql://forge:forge@127.0.0.1:32806/forge_feat589_snapshot RECOMMENDATION_DB_TEST=1 RECOMMENDATION_DELIVERY_DB_FIXTURE=production_snapshot pnpm --filter @forge/admin exec vitest run src/services/recommendations/delivery-multilingual.db.test.ts
DATABASE_URL=postgresql://forge:forge@127.0.0.1:32805/forge_feat589_deterministic RECOMMENDATION_DB_TEST=1 RECOMMENDATION_DELIVERY_DB_FIXTURE=deterministic RECOMMENDATION_PROFILE_DB_FIXTURE=deterministic pnpm --filter @forge/admin exec vitest run src/services/recommendations/delivery-retriever.db.test.ts src/services/recommendations/curated-pools.service.db.test.ts src/services/recommendations/admin-ops/detail.db.test.ts src/services/recommendations/candidates/profile-candidate.db.test.ts src/services/recommendations/curated-fallback.test.ts src/services/recommendations/delivery.service.persistence.test.ts src/services/recommendations/delivery-diagnostics.test.ts src/services/recommendations/locale-identity.test.ts src/app/dashboard/recommendations/request-detail-panel.test.tsx --no-file-parallelism
DATABASE_URL=postgresql://forge:forge@127.0.0.1:32805/forge_test RECOMMENDATION_DB_TEST=1 pnpm --filter @forge/admin exec vitest run src/services/recommendations/delivery-owner.db.test.ts
pnpm --filter @forge/web exec vitest run src/components/recommendations src/app/api/recommendations src/lib/recommendation-contracts.test.ts src/lib/recommendations.profile.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web check:ui-locales
pnpm --filter @forge/admin schema:print
git diff --exit-code -- apps/admin/schema.graphql
pnpm run format:check
python3 docs/reports/2026-10-01-recommendation-delivery/verify_results.py
```

Scoped `pnpm exec eslint --max-warnings=0` covered all changed/new TypeScript files. The focused independent review found no remaining actionable defects after the documented fixes. The earlier failing correlated-audio implementation was rejected rather than widening timeouts. Both new wrong-audio and Chinese retrieval regressions were also executed against the unchanged main retriever in temporary test copies: both failed with empty candidate arrays, while the repaired implementation passes. The temporary copies were removed. Full repository formatting and the original diagnostic evidence verifier pass.
