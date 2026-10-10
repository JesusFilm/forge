---
title: Fix recommendation audio selection and locale identity
type: fix
status: complete
date: 2026-10-01
origin: docs/roadmap/content-discovery/feat-589-recommendation-audio-aware-retrieval-locale-identity.md
---

# Fix recommendation audio selection and locale identity

## Summary

Repair bounded semantic retrieval so nearer wrong-audio chunks cannot consume its neighbor allowance. Separate transcript retrieval from published presentation identity, record bounded delivery context on the existing request ledger, and verify final service behavior within its existing 1,500 ms deadline.

## Evidence and requirements

The October 1 delivery report reconciles 5,958 requests, including 930 empty and 395 partial rows. The SQL comparisons establish candidate-selection and Chinese identity defects, not final-card or latency improvements. Implementation starts at current main `374897333`; the original investigation checkout and its unrelated work remain intact.

- R1. Apply exact playable audio eligibility before the 48-neighbor limit, preserving active embedding provenance, source/direct-family exclusions, publication, Watch visibility, and canonical deduplication.
- R2. Represent transcript, presentation, and exact audio separately. Chinese script choice must be deliberate; unavailable requested translations must not select another script or audio.
- R3. Retain bounded context and honest stage shortfalls even for empty requests, without viewer history, credentials, vectors, a new telemetry store, or longer retention.
- R4. Preserve the complete-service deadline and independent player availability. Exercise cold/warm and concurrent real PostgreSQL delivery, not just isolated diagnostic SQL.
- R5. Preserve later owner decisions and accepted coverage limitations. Regenerate public GraphQL artifacts if the contract changes; validate and open a focused PR with rollout evidence.
- R6. Fill partial rows with additional eligible semantic candidates from the existing bounded pool where possible. Preserve existing cards and order; when supply is exhausted, serve the partial row unchanged.

## Scope and decisions

Use the existing scalar parent lookup to retain ordered ANN access. Keep transaction-local custom plans and bounded iterative scans. Final eligibility remains authoritative. Existing local query and delivery patterns are sufficient for the repair; execution measurements will determine whether the proposed SQL shape meets performance acceptance.

Chinese `zh-hans`/`zh-hant` presentation uses `zh` transcript retrieval. Reuse the existing public `locale` as the requested presentation identity; derive transcript identity internally and include both in candidate cache keys. No independent non-Chinese transcript choice is required, so no GraphQL contract or generated-client change is needed. On 2026-10-01 the owner chose “Default generic zh to Simplified”: generic `zh` resolves to `zh-hans`. Explicit Traditional requests stay `zh-hant`; missing requested translations cannot fall through to another script or audio.

On 2026-10-01 the owner chose “top it up with a semantic result if possible, if none exist then serve the cards as is”. Use eligible semantic reserves from the existing bounded pool without replacing existing cards, expanding retrieval or extending the deadline. Curated fallback retains the empty-only rule; this decision does not authorize curated partial-row top-up. No inventory is published or expanded here. Feat-497 owns curated context expansion, feat-199 transcript-source operations, and feat-573 co-watch continuity. Feat-545/566 historical-evidence dispositions and feat-565 direct owner activation remain intact.

## Implementation units

### U1. Audio-aware bounded retrieval

**Requirements:** R1, R4. **Dependencies:** none.

**Files:** `apps/admin/src/services/recommendations/delivery-retriever.ts`, `delivery-retriever.db.test.ts`, and existing delivery runtime tests.

**Approach:** Put the same exact-audio playable-dub predicate inside the scalar parent eligibility check before limiting neighbors. Preserve the final join and bounded query shape. Add regressions before changing retrieval.

**Test scenarios:** At least 48 nearer chunks with the wrong audio and six farther eligible distinct videos; near inactive-contract chunks; source/parent/child exclusion; unpublished display and missing/deleted/unplayable dub; genuinely two-card and zero-card supply. Indexed prepared reuse must retain the ANN safeguards. Verify final delivery and exact audio, not only candidate counts.

### U2. Explicit language identities

**Requirements:** R2, R4, R5. **Dependencies:** U1 for combined tests. Chinese policy resolved by owner.

**Files:** Admin `delivery.types.ts`, `delivery.service.ts`, `delivery.factory.ts`, `delivery-retriever.ts`, their tests, and co-watch/profile/curated transcript consumers; Web `src/app/api/recommendations/route.ts`, `src/lib/recommendations.ts`, `src/components/recommendations/WatchSemanticRecommendations.tsx`, locale/request construction and their colocated tests. Existing GraphQL operations, SDL and client remain compatible.

**Approach:** Carry the resolved transcript and presentation identities through retrieval, eligibility, fallback and cache keys. Existing `locale` used for presentation downstream must consistently represent the chosen published locale. Do not change exact requested audio. Preserve old-client compatibility using the unchanged existing arguments. Legacy scene recovery cannot enforce exact audio and collection recovery permits English text substitution: recovery must prove both selected identities or stay unavailable. Include presentation identity in browser request keys, effect dependencies and stale-response fences.

**Test scenarios:** `zh` transcripts with both display scripts, explicit Simplified and Traditional, ambiguous Mandarin according to the owner answer, unavailable chosen translation, case normalization, cache separation by script and exact audio, old callers, and inactive contracts. Browser requests must retain player availability and correct identity. Switch Simplified to Traditional during an in-flight response; late Simplified cards must not populate the Traditional row. Exercise primary timeout/error, schema lag, unavailable chosen translation and recovery cache reuse across audio identities.

### U3. Bounded delivery evidence

**Requirements:** R3, R4. **Dependencies:** U2 identity contract.

**Files:** `apps/admin/prisma/schema.prisma`, a new additive migration if needed, `delivery-retriever.ts`, `delivery.service.ts`, `curated-fallback.ts`, `admin-ops/` readers and their colocated tests, and the recommendation current-schema test fixture.

**Approach:** Store a versioned, bounded context on the existing request root, independent of packed/legacy served-item formats. Obtain small stage counts and availability facts from bounded existing retrieval work. Distinguish observed missing compatible seed, unavailable presentation, exact-audio availability, empty bounded search, downstream eligibility/dedup shortfall, and absent curated context. Unknown or interrupted stages remain unknown; an ANN shortfall must never claim exhaustive catalog absence. Reuse the immutable request expiry and authorized detail-read boundary.

**Test scenarios:** Empty, partial and full rows; retrieval/fallback timeout; missing transcript versus inactive embedding; context present with no served items; packed and legacy snapshots; malformed/legacy diagnostics; no viewer identifiers or vectors; bounded serialized size. The complete-service tests include persistence.

### U4. Verification and delivery

**Requirements:** R1–R6. **Dependencies:** U1–U3 and U5.

**Files:** A focused verification report under `docs/reports/`, the feat-589 ticket, and a durable learning under `docs/solutions/`.

**Approach:** Use owned disposable PostgreSQL databases and available approved content-only snapshots. Measure representative short/long multilingual sources with exact minority audio, Chinese scripts, and sparse supply; cold application pools, repeated warm requests, and concurrent requests. Record final served counts, candidate counts, timeouts and elapsed service times separately. Label snapshot age and cold-cache limitations. No production writes or direct deploys.

**Verification:** Affected Admin/Web/shared-client tests, real PostgreSQL regressions, lint, typecheck, formatting, required schema/client generation, browser behavior and page-load evidence for touched Web initialization, code review, and PR CI. Regressions must fail against pre-fix behavior. A timing failure is investigated rather than hidden by widening the deadline.

### U5. Bounded semantic partial-row completion

**Requirements:** R1, R2, R4, R6. **Dependencies:** U1–U3.

**Files:** Admin recommendation orchestration, composition and delivery service with colocated tests.

**Approach:** Verify existing bounded semantic reserve behavior before adding code. Any required fill preserves the selected prefix and all live eligibility, exact language, family-exclusion and canonical-deduplication rules. Keep composition and served-item provenance consistent. Do not retrieve another unbounded pool or invoke curated fallback for a nonempty row.

**Test scenarios:** A partial row with eligible semantic reserves fills available slots; exhausted supply leaves the existing cards unchanged; duplicate or ineligible reserves cannot fill slots; full rows remain unchanged; all work uses the existing complete-service deadline.

## Risks and rollout

Selective filters can increase HNSW scan work; the same tuple cap and deadline remain binding. Separate cache identities prevent cross-script reuse, and live rechecks prevent stale publication/playback issuance. Existing GraphQL arguments avoid an additive-field deployment dependency. Diagnostic persistence must not create an extra unbounded hot-path query or imply catalog exhaustion from approximate search.

The PR follows the normal PR-to-main deployment path. Document current deployment revisions, migration compatibility, exact-context natural-traffic recheck queries, and rollback by reverting the application change through a PR. Do not change owner activation or fallback inventory. Post-deployment analysis must use new context-bearing requests and compare like locale/audio/seed contexts; no global fill-rate claim before measurement.

## Sources

- `docs/reports/2026-10-01-recommendation-delivery/report.md` and adjacent SQL, JSON, metadata, and verifier.
- `docs/reports/2026-10-01-recommendation-health/report.md`.
- `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` (original architecture, subject to later owner decisions).
- `docs/solutions/performance-issues/semantic-recommendation-retrieval-bounded-pgvector-fanout.md`.
- `docs/solutions/performance-issues/contextual-recommendations-repeat-catalog-work-20260915.md`.

## Completion

Implemented and verified in the isolated feat-589 branch. See `docs/reports/2026-10-01-recommendation-delivery/implementation-verification.md` for timings, commands, browser evidence and rollout limits. Focused regressions and independent review confirm that the existing bounded composer already satisfies the owner-approved semantic partial-row policy; curated fallback remains empty-only. Stale unrelated PostgreSQL test fixtures discovered during the broader run are tracked by feat-590.
