---
date: 2026-05-20
topic: manager-admin-lookup-tail-latency
---

# Manager Admin Lookup Tail Latency Recovery

## Summary

Recover the manager enrichment dispatch path by identifying and removing the admin `videosByCoreIds` tail latency that causes manager 502s during transcript retries. The recovery should preserve the existing enrichment contract while making the slow phase visible enough to operate safely in production.

---

## Problem Frame

Production transcript enrichment retries are paused because manager returned Cloudflare 502s from `POST /api/admin-trigger/transcript`. The manager route itself is alive: unauthenticated requests return 401, and one authorized single-item probe returned 200 and started a transcript job.

The fragile part is the authorized route's dependency on admin GraphQL `videosByCoreIds`. That lookup now returns successfully but takes seconds even for small inputs, while direct SQL for the same projection completes in milliseconds. Admin HTTP logs also showed a request abort near 15 seconds, matching the manager/admin timeout envelope. The failure is therefore not missing subtitle/mux data and not a slow SQL scan; it is request-path tail latency above the database query.

---

## Actors

- A1. Operator: triggers and monitors production enrichment recovery.
- A2. Admin service: resolves dispatch metadata and reports lookup latency.
- A3. Manager service: validates dispatch fields and schedules transcript or scene-analysis pipelines.
- A4. Implementing agent: instruments, fixes, verifies, and documents the recovery path without leaking secrets.

---

## Key Flows

- F1. Diagnose lookup latency
  - **Trigger:** Enrichment retries are paused after manager 502s.
  - **Actors:** A2, A3, A4
  - **Steps:** Add scoped timing around admin GraphQL context, auth/rate-limit, resolver, service, transaction, and response path; deploy; inspect production-safe logs.
  - **Outcome:** The dominant latency phase is known from production evidence, not inferred from wall-clock totals.
  - **Covered by:** R1, R2, R5

- F2. Recover dispatch
  - **Trigger:** The latency source is identified and a fix is deployed.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Run a small manager lookup probe, then a 10-item transcript retry batch, then resume larger paced batches only if outcomes are healthy.
  - **Outcome:** Manager dispatch no longer returns Cloudflare 502 for the retry path.
  - **Covered by:** R3, R4, R6

---

## Requirements

**Observability**

- R1. The admin `videosByCoreIds` path must emit production-visible timing breadcrumbs for the major request phases needed to distinguish GraphQL/runtime overhead from database work.
- R2. Runtime logs must avoid secrets and use Railway-visible plain-string `event=name key=value` format.

**Recovery Behavior**

- R3. The manager/admin trigger contract must remain backward-compatible: manager continues to return per-item outcomes, and admin continues to classify `STARTED`, `ALREADY_IN_FLIGHT`, `VALIDATION_FAILED`, `NOT_FOUND`, and `DISPATCH_FAILED`.
- R4. Missing subtitle, mux, or primary-language data must remain `VALIDATION_FAILED`, not be reclassified as retryable transport failure.
- R5. Timeout budgets must fail in the inner lookup path before the outer admin-to-manager caller aborts, so failures are typed JSON envelopes rather than Cloudflare HTML 502s.
- R6. Transcript enrichment retries must resume only after a small smoke batch proves the dispatch path no longer returns `remote_5xx`.

**Scope Control**

- R7. The fix must stay focused on manager/admin dispatch lookup latency, not the separate scene embedding Prisma/OpenRouter backfill failures.
- R8. The fix must not reintroduce manager coupling to CMS for the admin-trigger path.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a manager-triggered `videosByCoreIds` request, when it completes, production logs include bounded timing fields for the relevant admin request phases and no raw secrets or core ID lists.
- AE2. **Covers R3, R4.** Given a video with missing dispatch fields, when manager processes the admin lookup result, the item returns `VALIDATION_FAILED` with the missing field reason and does not become a retryable transport failure.
- AE3. **Covers R5.** Given admin lookup latency exceeds the inner budget, when manager handles the lookup failure, admin receives a typed manager JSON response before its outer timeout wins.
- AE4. **Covers R6.** Given the fix is deployed, when a 10-item transcript retry batch runs, it produces no `DISPATCH_FAILED remote_5xx` outcomes before broader retries resume.

---

## Success Criteria

- Operators can tell whether `videosByCoreIds` time is spent in admin request setup, rate limiting, resolver/service code, Prisma/DB acquisition, SQL execution, or response handling.
- A small production retry batch proves manager dispatch is healthy before any remaining transcript enrichment retries continue.
- The handoff is concrete enough for `ce:work` to implement without re-deciding the scope or conflating this with scene embedding recovery.

---

## Scope Boundaries

- Do not build the full-catalog admin enrichment dashboard in this recovery fix.
- Do not change manager pipeline semantics or artifact formats.
- Do not backfill or repair videos missing mux/subtitle/primary-language dispatch data.
- Do not resume full retry batches inside this planning/brainstorming work.
- Do not modify scene embedding retry/backfill behavior.

---

## Key Decisions

- Treat the current issue as request-path tail latency above SQL, because direct prod SQL completes quickly while GraphQL requests take seconds and sometimes abort near the timeout budget.
- Instrument before replacing the boundary, because the remaining slow phase is not proven and a blind REST bypass could hide rather than solve the underlying runtime problem.
- Keep a REST bypass as an acceptable follow-up shape if instrumentation shows GraphQL middleware/runtime overhead is the bottleneck.

---

## Dependencies / Assumptions

- PR #985 is already merged and deployed to admin production.
- Manager's current successful deployment predates the admin lookup fix but is reachable and can process authorized requests.
- Railway request-path logs are sufficient to confirm high-level HTTP status and duration, but app logs need plain-string formatting to be reliable.
- The single authorized probe for assetId `662` already started one transcript job and should be considered when choosing future retry inputs.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Which timing boundaries can be captured with minimal code and without widening public API surface?
- [Affects R5][Technical] Should the first fix preserve GraphQL and adjust the slow phase, or add a narrow REST lookup after instrumentation proves GraphQL overhead dominates?
