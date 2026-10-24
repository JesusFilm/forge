---
title: "Retry raw Prisma serialization conflicts without turning storage faults into invalid tokens"
date: "2026-09-16"
module: "Recommendation playback evidence"
problem_type: "database_issue"
component: "service_object"
symptoms:
  - "Raw playback SQLSTATE 40001 bypasses P2034-only retry"
  - "A failed token revocation lookup becomes terminal invalid input"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
tags:
  [
    recommendations,
    playback,
    prisma,
    postgres,
    serialization,
    token-verification,
  ]
---

# Preserve retryable evidence failures

## Problem and reproduction

The production playback audit observed a raw serialization conflict. Reproducing
a concurrent update in disposable PostgreSQL with the installed Prisma 6.19.3
`PrismaPg` adapter proves the structured error is `P2010` with
`meta.code = "40001"`. The prior helper recognized only `P2034` and did not retry
this transaction. A real fixture first reads a serializable snapshot, commits an
update on another connection, then attempts the original transaction's update.

Investigation also found `token.service.ts::verify` caught revocation-store
failures in the same block as malformed tokens and signature failures. It mapped
all of them to `RecommendationTokenInvalidError`, which the GraphQL boundary
correctly treats as terminal input. This is a separately reproduced failure mode;
the original production trace does not prove it caused that particular HTTP 400.

## Solution

- Recognize structured `P2034`, PostgreSQL `40001`, and the proven
  `P2010.meta.code` wrapper, with bounded/cycle-safe cause traversal. Do not match
  message text or retry unrelated raw-query errors.
- Retry the entire transaction with a new snapshot at most three times. Preserve
  the separate bounded nonblocking episode-lock budget. Exhaustion throws the
  existing internal-state error, keeping private database detail out of responses.
- Verify token syntax/signature/claims inside the invalid-token boundary, then
  require the fresh revocation lookup outside it. A revoked key is still invalid;
  an unavailable store still rejects access, but remains a retryable server fault.
- Verify the actual Yoga masking boundary and Web Apollo error envelope: storage
  errors become internal GraphQL failures and HTTP 503; genuine input remains
  `BAD_USER_INPUT` and HTTP 400.

## Verification

The focused suites cover 80 tests, including real-adapter concurrent updates,
playback replays/finalizers, one-time receipt semantics, unrelated raw-query
errors, cause cycles, retry exhaustion, revocation failures and Web mapping.
The source-neutral episode database suite now uses the same adapter as production.
Run it against an explicitly disposable database with `RECOMMENDATION_DB_TEST=1`.

Entry points:

- `apps/admin/src/services/recommendations/transaction-retry.db.test.ts`
- `apps/admin/src/services/recommendations/playback-episode.db.test.ts`
- `apps/admin/src/graphql/recommendation-errors.test.ts`
- `apps/web/src/app/api/recommendations/playback/route.test.ts`

## Test harness pitfalls

`PrismaPg`'s schema option qualifies ORM operations but does not set the raw SQL
search path. Isolated raw-query fixtures also need connection `options` with the
fixture schema's search path. Without it, a missing-relation `42P01` masks the
intended reproduction.

Vitest's transformed GraphQL instance can differ from Yoga's Node-loaded instance.
A masking test can falsely pass because the schema itself fails realm validation.
Share Yoga's Node GraphQL instance in the fixture and include a valid domain-error
control proving the resolver ran; masking-only assertions are insufficient.

## Prevention and operational limits

Use production adapters for concurrency regressions, keep operational dependency
failures outside client-input catch blocks, and assert both retryable and terminal
transport outcomes. A local fix establishes bounded recovery, not production
error frequency or improved recommendation satisfaction. Release through the
normal PR flow and reconcile fixed post-deploy windows before closing feat-509.
