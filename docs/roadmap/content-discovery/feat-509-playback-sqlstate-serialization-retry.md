---
id: "feat-509"
title: "Retry raw SQL playback serialization conflicts without terminal input errors"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 2
depends_on: []
blocks: []
tags: [admin, web, recommendations, playback, reliability]
---

## Problem

During the September 16 recommendation release verification, one production
playback facts request failed with PostgreSQL SQLSTATE `40001` at
2026-09-15 22:15:51 UTC. Admin observed an unknown/retryable failure, but Web
returned HTTP 400 `invalid_request` with a terminal disposition. Valid evidence
can therefore be dropped instead of retried. This predates PR #2309: the bounded
24-hour comparison found the same SQLSTATE on ten older Admin revisions and
terminal facts-400 observations on six older Web revisions.

This is a concrete remaining retry/mapping gap within the broader
[feat-464 transport work](feat-464-recommendation-evidence-transport-crawler-integrity.md).
It does not change the unknown meaning of immediate departures, and it does not
invalidate the successful retained-fact/browser checks for feat-503/504.

## Entry Points — Read These First

1. `apps/admin/src/services/recommendations/transaction-retry.ts` —
   `prismaErrorCode` and `withRecommendationSerializableRetry` recognize `P2034`
   but not raw-query SQLSTATE `40001`; verify the suspected `P2010` wrapper.
2. `apps/admin/src/services/recommendations/transaction-retry.test.ts` — bounded
   retry, lock contention and exhaustion fixtures.
3. `apps/admin/src/services/recommendations/playback.service.ts` —
   `recordOnce`, raw SQL inside serializable transactions and error observation.
4. `apps/admin/src/services/recommendations/errors.ts` and the GraphQL mutation
   boundary — domain classification after retry exhaustion.
5. `apps/web/src/lib/recommendations.ts`,
   `apps/web/src/lib/recommendation-route-response.ts` and
   `apps/web/src/app/api/recommendations/playback/route.test.ts` — exact Apollo
   response-shape mapping and public retry disposition.
6. `docs/operations/recommendation-production-verification-2026-09-16.md` —
   bounded production evidence and remaining rollout gates.

## Grep These

`P2010|P2034|40001|withRecommendationSerializableRetry|prismaErrorCode|invalid_request|transaction_exhausted`

## What To Build

- Reproduce the actual wrapped error shape without retaining production SQL,
  identifiers or capabilities. Confirm whether the SQLSTATE is in `meta`,
  `cause`, or both before defining the classifier.
- Recognize proven serialization conflicts and retry the whole transaction with
  a fresh snapshot using the existing bounded attempt budget. Keep episode-lock
  contention accounting separate.
- Convert exhausted transient conflicts to a typed retryable server response.
  Do not map them to terminal invalid input, and do not make genuine invalid
  input or binding errors retryable.
- Preserve exact-event replay, payload-conflict detection, capability fences,
  immutable facts, navigation fail-open behavior and bounded observability.

## Constraints

Do not match arbitrary message text broadly or retry every `P2010` error.
Keep authorization/privacy generations, evidence contracts and recommendation
delivery deadlines unchanged. Coordinate with the feat-464 owner before editing
shared retry/mapping code. Keep raw SQL, profile/session/episode identifiers and
credentials out of logs and evidence artifacts.

## Verification

Cover direct and wrapped `P2034`, `P2010` plus `40001`, unrelated raw-query
errors, cause nesting, success after retry and exhausted budgets. Add a real
PostgreSQL concurrent playback fixture and a Web boundary assertion for the
actual GraphQL error shape. Prove bounded retries preserve one durable fact and
receipt, and genuine invalid input still receives its terminal response.

Run touched Admin/Web tests, typechecks, lint and required PR checks. Deploy by
normal PR-to-main flow, then reconcile a fixed production window's primary HTTP
requests, retry logs and durable receipts. A short clean window does not close
feat-464's separate two-hour integrity and monitoring gates.
