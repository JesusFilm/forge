---
title: Watch surface exposure evidence slice
status: active
feature: feat-373
---

## Scope

Instrument the two signed recommendation surfaces and eight anonymous Watch
surface/presentation entries with one half-visible, one-second exposure primitive. Persist
rendered, eligible, and selected facts and inspect position-level CTR in the
authorized Admin Recommendations page. This remains an incremental slice:
anonymous surfaces cannot reconcile a server-issued served count, so feat-373
stays in progress.

## Decisions

- Signed below-player and For You facts remain request-owned under the existing
  29-day retention. Store bounded visibility capability with impression facts.
- Anonymous home hero, rail/grid collections and authored sections, search
  modal, video editorial and chapters, and series episodes use a finite
  surface registry. The browser
  emits random event and block-window UUIDs and public Watch item paths; it
  sends no viewer, account, session, or cookie identifiers in the payload.
- The anonymous record exists only for exposure measurement and debugging.
  Admin service access is through the Web proxy, Admin inspection requires
  existing recommendation dashboard authorization, and deletion occurs by
  bounded 29-day expiry sweep. Records have no viewer linkage for a
  per-viewer deletion path.
- Web ingestion is best effort with bounded batches and a strict origin, path,
  time, registry, and size contract. Replay of an event ID increments audit
  duplicate count; a new event ID for the same card and kind remains a repeat.
  Failure or timeout does not delay Watch navigation or player startup.
- Eligible CTR counts only selections after a prior eligible impression in
  the same exposure window. An early selection remains a separate anomaly.
  Served counts for anonymous authored content are unknown, not zero; Admin
  explicitly shows incomplete registry coverage and aggregate truncation.
- IntersectionObserver V2 supplies occlusion-aware eligibility when supported.
  The V1 fallback labels occlusion unknown. Neither path promotes CTR to a
  ranking objective.

## Verification

- Unit and service tests cover threshold, hidden tab, occlusion, replay,
  early selection, responsive changes, reordering, size and count batching,
  ingress bounds, and Admin mapping.
- Disposable PostgreSQL test covers cross-window eligibility and repeat
  reconciliation against the actual SQL query.
- Browser fixture probes below-fold dwell, hidden-tab resume, overlay
  occlusion, early selection, and a 70-card page-loading comparison. The
  fixture mocks the telemetry response; it is evidence of client behavior,
  not a production serving benchmark.
- Run affected Web and Admin tests, lint, typecheck, schema validation, and
  roadmap lint. Keep any baseline failures explicit in the PR.
