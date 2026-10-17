---
title: "Investigate remaining intermittent recommendation evidence failures"
type: fix
status: active
date: 2026-09-23
origin: docs/roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md
---

# Investigate remaining intermittent recommendation evidence failures

## Summary

Reconcile feat-464's remaining transport failures with current production and code,
reproduce a supported failure in an isolated local environment, and propose a narrow
fix with explicit verification gates. This is a diagnosis mandate, not permission
to merge, deploy, change production configuration, install alerts, or repair data.

This continuation preserves the historical September 9 implementation plan. The
starting default-branch revision is `77eb63fbb325f6279955f34cffd1f8994f9281dd`.

---

## Problem Frame

The open ticket combines historical defects already repaired, occasional genuine
transport failures, valid terminal input rejections, and incomplete operational
acceptance. Low aggregate HTTP failure rates cannot distinguish these classes or
prove that a browser stops retrying after a definitive failure. HTTP 200 can also
hide recommendation delivery fallback; delivery latency remains a separate scope.

---

## Requirements

- R1. Identify which reported failure classes remain possible in current code,
  separating evidence from hypotheses and historical defects from live behavior.
- R2. Reconcile fixed UTC production windows using primary HTTP counts, semantic
  delivery outcomes, Web/Admin evidence outcomes, and bounded durable aggregates.
  Report missing telemetry, sample limits, exclusions, and deployment overlap.
- R3. Reproduce a supported defect with negative controls, trace the full causal
  chain, and propose the smallest correction with named regression tests.
- R4. Preserve exact-payload idempotency, terminal versus retryable responses,
  authorization, privacy generations, recognized-machine exclusion, source-neutral
  playback, unchanged recommendation deadlines, and fail-open watching/navigation.
- R5. Keep the ticket in progress until its existing production, browser, authorized
  integrity, and installed-monitoring acceptance gates each have their own proof.

## Scope Boundaries

- All changes and test output belong to this task's isolated worktree. Do not edit
  other agents' checkouts or use their databases, ports, or generated build output.
- Production diagnostics are read-only, bounded, and aggregate by default. Never
  retain raw tokens, cookies, viewer/session/episode IDs, histories, or SQL values.
- Do not weaken timestamp or token validation merely to reduce rejection counts.
- Do not retry an ambiguous mutation with a new payload or invent human provenance.
- Use repository learnings and this task's handoff, not prior Codex task history.

### Deferred to Follow-Up Work

- Feat-496's delivery persistence, database-wait attribution, and selection deadline
  investigation remain owned by the separate latency task.
- Alert installation remains subject to organization write policy and explicit
  authorization. This task may document gaps, not bypass that policy.
- Any production-safe browser canary, fix implementation, release, and subsequent
  sustained acceptance require the appropriate next-stage scope decision.

---

## Context and Decisions

The existing code already includes Apollo error normalization, terminal HTTP 409
handling, a 3-second upstream / 5-second browser evidence budget, bounded database
conflict retries, short Meta crawler-token recognition, and network error-code
telemetry. Do not reimplement those from the stale opening section of the ticket.

Investigate three populations independently:

| Population                          | Evidence needed                                                                | Invalid inference to avoid                   |
| ----------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| Fast upstream failure / HTTP 503    | Network code, upstream status, deployment interval, final mutation disposition | Deployment overlap alone proves the cause    |
| Timestamp / invalid-input rejection | Exact validation predicate, client lifecycle, clock/expiry controls            | Every HTTP 400 is a server fault             |
| Browser retry / receipt ambiguity   | Same-payload attempts, acknowledgement boundary, terminal disposition          | A terminal log label proves browser behavior |

The primary request denominator is `trace.web.request.hits`, not sampled spans or
retry log counts. Compare Web/Admin outcomes independently and use bounded Railway
logs to investigate indexed gaps. Check response semantics independently of status.

No external architectural research is needed initially: the relevant contracts,
past production incidents, implementation, and tests are in this repository.

---

## Investigation Units

### U1. Establish the current failure ledger

**Requirements:** R1, R2, R5. **Dependencies:** None.

**Files:** Read the origin ticket; `docs/operations/watch-budget-followup-2026-09-22.md`,
`docs/operations/watch-production-verification-2026-09-22.md`,
`docs/operations/watch-transport-cause-release-2026-09-21.md`, and
`docs/operations/watch-persistence-followup-2026-09-23.md`. Record this task's findings
in `docs/operations/watch-intermittent-evidence-investigation-2026-09-23.md`.

**Approach:** Verify deployed revisions and inspect bounded, settled UTC windows.
Classify primary HTTP errors, semantic delivery fallbacks, normalized transport
reasons, retries, and missing observations separately. Retain historical unresolved
incidents even if they do not recur. Keep collector caps and small cohorts explicit.

**Verification:** Counts reconcile or the exact unmatched population is recorded;
no failure class is labeled fixed solely because a short interval was quiet.
**Test expectation:** None; this unit collects read-only diagnostic evidence.

### U2. Reproduce the highest-supported failure

**Requirements:** R1, R3, R4. **Dependencies:** U1 and current code inspection.

**Files:** Inspect `apps/web/src/lib/recommendations.ts`,
`apps/web/src/lib/recommendation-errors.ts`,
`apps/web/src/lib/recommendation-evidence-response.ts`,
`apps/web/src/components/recommendations/WatchSemanticRecommendations.tsx`,
`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`, and
`apps/admin/src/services/recommendations/evidence.service.ts` / `token.service.ts`.
For dependency-readiness failures, inspect `apps/admin/src/infra/redis.ts`,
`apps/admin/src/graphql/plugins/rate-limit.ts`, and
`apps/admin/src/app/api/health/route.ts`; characterize their boundary in
`apps/admin/src/graphql/plugins/rate-limit-availability.test.ts` without changing
production startup behavior during diagnosis.
Use or extend their colocated tests, particularly
`apps/web/src/components/recommendations/WatchSemanticRecommendations.lifecycle.test.tsx`,
`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.claim.test.tsx`,
`apps/web/src/app/api/recommendations/playback/route.test.ts`, and
`apps/admin/src/services/recommendations/evidence.service.test.ts`.

**Approach:** Write down verified versus assumed premises. Trace the point where
valid input becomes invalid, then run a bounded characterization/reproduction test.
Prioritize observed defects over speculative cleanup. No production failure injection.

**Test scenarios:**

1. Accepted evidence within the signed capability interval remains accepted;
   clock skew and events after expiry produce the documented terminal response.
2. A slate first rendered or re-exposed near/after expiry reveals whether browser
   lifecycle state can manufacture avoidable invalid timestamps.
3. Lost acknowledgement replays the identical payload; it does not create a fresh
   event or duplicate durable fact. A genuine binding failure stops retries.
4. Fast fetch refusal/socket closure stays distinct from timeout and typed input
   failure; known crawler input never reaches an Admin mutation.
5. If a database race becomes the leading hypothesis, use only an owned disposable
   PostgreSQL fixture with the installed adapter and negative error controls.

**Verification:** A reproduction distinguishes the proposed causal mechanism from
at least one plausible alternative. If not, document the missing evidence instead
of patching symptoms. Existing tests pass independently of any new reproduction.

### U3. Present diagnosis and a bounded fix decision

**Requirements:** R3, R4, R5. **Dependencies:** U1, U2.

**Files:** The investigation report above and, where useful, the existing roadmap
ticket. Leave historical evidence intact and retain `status: "in-progress"`.

**Approach:** Report ranked causes, confidence, precise code references, disproved
alternatives, remaining unknowns, proposed changes and named tests. Ask whether to
implement the supported fix. Do not claim the full ticket closes from diagnosis.

**Verification:** The user can distinguish a confirmed defect from an expected
rejection, observability gap, or separately owned latency problem. Any proposed
release preserves normal PR-to-main deployment and contains rollback/acceptance
criteria without implying current deployment authorization.
**Test expectation:** None; this unit is a diagnostic handoff.

---

## Risks and Deferred Questions

- Rejected timestamps do not retain client clock provenance; aggregate production
  counts cannot establish whether an out-of-window client timestamp came from clock
  skew or other invalid client input. Test ordinary capability expiry separately
  and avoid attributing the historical cohort without evidence.
- A fast fetch failure may have committed before the response was lost. Neither a
  missing retained Admin span nor a local socket test proves production disposition.
- Read-only database guards can expire on a complete integrity audit. A partial
  audit or scheduler heartbeat is not a substitute for the canonical predicate.
- Determine the leading failure class from fresh evidence. Any priority question
  that changes the investigation's scope should go to the user rather than be guessed.

## Authorized Recovery Experiment

The owner subsequently requested the controlled restart experiment and a root-cause
report. This authorizes local fault injection and diagnostic tests, not an application
fix, production fault injection, merge, or deployment.

- Use owned disposable Docker Redis 8.10.2 and PostgreSQL, with loopback-only ports.
  Keep the Redis host port stable across restarts and remove containers/volumes.
- Exercise real Yoga HTTP, the unchanged production limiter and ioredis singleton,
  signed episode capabilities, and real playback service/storage. A minimal schema
  isolates this boundary; it is not a complete Next/Web/authentication deployment.
- Compare healthy control, three restarts, a short silent stall, caller timeout
  during a silent stall, and a post-commit socket loss. Measure resolver entry,
  durable fact count, replay receipts, and automatic reconnect.
- Independently exercise the real browser recorder's retry schedule with fast 503s
  and recovery. Distinguish permanent retirement of a batch from later healthy traffic.
- Preserve exact payloads, fail-closed limits, fixed request deadlines, and terminal
  response behavior. Do not experiment with enabling the global offline queue.
- Require both existing `RECOMMENDATION_DB_TEST=1` and `RECOMMENDATION_REDIS_TEST=1`
  to run the Docker fixture; ordinary unit and single-dependency suites skip it.

## References

- `docs/plans/2026-09-09-001-fix-recommendation-evidence-transport-plan.md`
- `docs/solutions/database-issues/prisma-raw-serialization-retry-and-token-error-boundaries-20260916.md`
- `docs/solutions/security-issues/recognize-crawler-product-tokens-without-documentation-urls.md`
- `docs/roadmap/content-discovery/feat-459-recommendation-profile-eligibility-reconciliation.md`
- `docs/roadmap/content-discovery/feat-509-playback-sqlstate-serialization-retry.md`
