---
title: "fix: Isolate crawler delivery and preserve legacy evidence efficiently"
type: fix
status: active
date: 2026-09-28
---

## Problem and authorization

The user approved contextual recommendations without tracking for recognized
crawlers, deferred persistence for speculative browsing, bounded aggregate
observability, and selective legacy cleanup preserving useful development data.
The previous experiment eligibility boolean never prevented delivery persistence.
The evidence guard protects engagement ingestion but not delivery or automatic
profile bootstrap. The September 28 audit demonstrated a crawler-declared
production request committing recommendation records.

## Requirements and decisions

- R1: Classify requests at the Web origin, before recommendation/profile work.
  Use bounded declared-crawler, speculative-prefetch, speculative-prerender,
  ordinary-browser and unknown categories. Missing or ordinary UA is not proof
  of humanity. Do not trust unverified Cloudflare headers or accept classification
  from the public JSON request body.
- R2: Crawlers receive public contextual cards without request/run/item/detail,
  profile-link, decision, experiment or evidence writes and without signed
  capabilities. Use the existing inert contextual sentinel where a non-null
  transport field requires it. Preserve private/no-store responses and origin,
  caller, input-size and rate-limit controls.
- R3: Speculative requests return a deferred non-attributed envelope. Prerendered
  clients defer delivery and automatic profile bootstrap until activation.
  Actual navigation must fetch an ordinary delivery, even after reuse of a
  speculative response. Preserve StrictMode, cancellation, BFCache and normal
  keyboard/screen-reader navigation; no click or consent prerequisite.
- R4: Enforce exclusion in Web and before the first potentially mutating Admin
  service call. Both seeded and For You delivery participate. Existing
  `eligibleHuman=false` also excludes persistence; it cannot be overridden by a
  contradictory ordinary category. Add optional `trafficCategory` to the trusted
  Web GraphQL contract; omitted values preserve older callers. Reject invalid
  explicit categories and do not let fleet clients assert Web provenance.
- R5: Add bounded aggregate observation categories for attempted, avoided and
  committed delivery. No raw UA, IP, cookies, capabilities, viewer identities or
  new database ledger. A public route success is not proof of a committed trace.
- R6: Selective cleanup first converts representable older legacy traces into
  existing version-1 compact payloads, validates full parity, then deletes only
  redundant stage rows atomically. Preserve complete diagnostic information,
  root/run/items/outcomes/versions/counters and original expiry. Skip any row
  whose precision or shape cannot roundtrip exactly.
- R7: Freeze the 64 quality-audit run IDs before changing the legacy population,
  keep them and active investigations out of the initial manifest. Also exclude
  incomplete, empty/unavailable, curated fallback and directly linked
  experiment/shadow/promotion/conflict/access cases initially. No historical bot
  inference from absent engagement. Holds do not extend existing privacy expiry.

## Intended behavior

| Origin request                       | Delivery                    | Recommendation persistence     |
| ------------------------------------ | --------------------------- | ------------------------------ |
| Declared crawler                     | Public contextual cards     | None                           |
| Prefetch/prerender                   | Deferred envelope           | None until ordinary navigation |
| Ordinary browser/unknown             | Existing behavior           | Existing bounded traces        |
| Legacy caller with false eligibility | Read-only contextual branch | None                           |

Cloudflare verification and broad unknown-bot detection are separate work.
Existing product analytics and privacy withdrawal/deletion remain available.
Selective conversion is not evidence pruning, changes no ranking, and provides
no guarantee that DELETE returns filesystem space. Empty-table reclamation
remains the separate feat-555 operation; no live table rewrite or blanket delete.

## Implementation units

### U1. Web classification, untracked delivery and activation

**Files:** `apps/web/src/lib/recommendation-human-admission.ts`,
`recommendation-delivery-observability.ts`, `recommendations.ts`,
`user-recommendations.ts`, `recommendation-browser.ts`, a shared activation helper,
`apps/web/src/app/api/recommendations/route.ts`, `for-you/route.ts`,
`profile/route.ts`, Watch semantic/For You components and recommendation profile
bootstrap shell; colocated tests for each changed behavior.

**Approach:** Origin classification precedes session/profile handling. Excluded
delivery never sets a session cookie or passes profile credentials. If the
required legacy seeded input needs an inert digest placeholder, it is confined
to the explicitly excluded trusted service branch and never used as identity.
Mark speculative responses explicitly so null request IDs alone do not trigger
retries. Profile status/grant/reset automatic paths reject excluded origins;
withdrawal/deletion remain accessible. Keep serving outside SSR/player startup.

**Tests:** Crawler and minimal Meta tokens, ordinary vendor browsers, missing UA,
prefetch/prerender classification; no cookie/profile/upstream measured work for
excluded paths; public contextual cards; activation exactly once, abort/unmount,
StrictMode, repeated events, BFCache, cached deferred response recovery and later
human attribution. Capture request-count/timing performance evidence.

**Dependencies:** U2 contract. Execution posture: regression first.

### U2. Admin exclusion before mutation

**Files:** `apps/admin/src/services/recommendations/delivery.service.ts`,
`delivery.types.ts`, `user-delivery.service.ts`, shared traffic/read-only helpers,
`apps/admin/src/graphql/queries/recommendation-delivery.ts`,
`user-recommendations.ts`, corresponding tests, `apps/admin/schema.graphql`,
`packages/admin-graphql/src/admin-graphql-env.d.ts`.

**Approach:** Authenticate the caller, validate disposition, then branch before
identity authorization/profile linkage, serving observations, experiment
assignment and persistence. Reuse bounded public curated/contextual retrieval.
Speculation returns deferred empty data. Omitted categories remain compatible;
legacy false cannot accidentally reach a write. Keep normal serving policy.
Regenerate SDL and introspection rather than editing generated outputs.

**Tests:** Actual disposable PostgreSQL proves zero protected-table writes for
both excluded delivery surfaces, including profile-backed input. Normal delivery
still persists. Check legacy false, contradictory/invalid categories, caller
authorization, retrieval failure, response size and expiry, parser compatibility,
bounded metric contents. Mock-only tests are insufficient for the no-write claim.

**Dependencies:** None. Execution posture: regression first.

### U3. Selective lossless legacy conversion

**Files:** New
`apps/admin/src/services/recommendations/legacy-candidate-trace-conversion.service.ts`
and tests, a dry-run-first CLI under `apps/admin/src/scripts/`, and an operator
runbook under `docs/operations/`. Reuse `candidate-trace.ts`, the version-1 SQL
validator, mixed-format detail reader and retention lock conventions.

**Approach:** Bound and freeze a private candidate/hold manifest with target
database identity and selector digest. Use SQL construction and typed roundtrip
comparison to retain numeric/JSON/timestamp precision. Reconcile all seven stage
counts and inherited expiry. Under consistent root/run locks and retention
coordination, write payload and delete only equivalent stage rows in one short
transaction; any mismatch aborts. Version 1 is the idempotent checkpoint.
Dry run is default; explicit execution and target confirmation are required by
the CLI. Initially bound each transaction to 10 runs/4,000 rows with encoded-byte
limits, 1-second lock and 10-second statement budgets; measure before increasing.

**Tests:** Disposable-DB full reader parity; nested JSON/null/numeric/timestamps;
unrepresentable precision/expiry/shape/counter cases skip safely; quality holds;
rollback between update/delete; rerun; retention race; ownership boundaries and
original expiry. Measure peak added compact allocation/WAL and deletion latency.

**Dependencies:** Existing compact reader/validator, independent of U1/U2. No
production execution until the exact manifest, current headroom, fleet state,
real-DB proof and operator stop conditions have been reviewed. Initial production
execution is a small bounded pilot; further batches depend on measured margin.
No assumption of cheap selective restore or immediate physical savings.

### U4. Integration, review and rollout evidence

**Files:** Roadmap feat-559/560, validation report/runbook, durable learning.

**Approach:** Root orchestrates disjoint file ownership; agents do not stage or
commit in the shared worktree. Serialize test/codegen work. Coordinate current
main with the separate recommendation batch task. Review API, security, async
lifecycle and database invariants independently. Normal PR-to-main deployment
only. Verify actual active processes and fresh aggregate production observations.

Release Admin exclusion and additive SDL first, keeping the deployed Web/shared
operation documents unchanged. Verify every active Admin HTTP process and worker
supports the additive contract, then release Web classification, profile guards,
activation and shared operation documents in a second normal PR-to-main release.
Test old Web against new Admin before the first release; do not send new Web
operations to old Admin. The first release alone does not close For You/profile
bootstrap writes. Declare exclusion effective only after both fleets converge.
Keep cleanup tooling/execution independently reviewable; it must not force Web
to deploy ahead of the Admin compatibility barrier.

**Tests:** Focused tests then touched-app checks, generated drift, formatting,
frontend request timing/performance, real DB suites, clean PR CI. Verify no
recognized excluded commits after rollout and ordinary navigation remains
functional. Report indexed observations as samples, not complete traffic rates.

**Dependencies:** U1/U2/U3 implementation. Crawler release need not wait for a
large legacy conversion; treat serving rollout and cleanup execution separately.

## Risks and deferred implementation facts

- Mixed Web/Admin deployments require additive schema first and compatible
  fallback until both roles converge. Do not claim enforcement before convergence.
- A crawler can spoof a browser UA; this work guarantees exclusion for recognized
  inputs, not universal bot detection.
- Conversion temporarily adds payloads and WAL while legacy files remain
  allocated. Refresh the previous 11.2 GB filesystem reading; stop on pressure,
  lock waits, errors, retention contention or unexpected legacy writers.
- The quality selector depends on legacy format. Materialize its initial IDs
  before conversion, never rediscover the same sample from a changed population.
- Existing expiry still applies to preserved evidence. An indefinite archive or
  changed retention is outside this scope.
