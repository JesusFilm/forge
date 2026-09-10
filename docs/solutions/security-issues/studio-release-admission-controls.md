---
module: Studio
problem_type: security_issue
tags: [studio, release, admission, publication, idempotency, concurrency]
---

# Disable new Studio work without losing accepted outcomes

The native agent switch and Manager Mux dispatcher switch did not cover manual
canonical production or a scheduler's stored publication envelope. Disabling a
preparation URL also cannot revoke a submission already prepared. Release control
must live at canonical admission and dispatch boundaries.

Admin validates two independent process-start flags, both default false:
`STUDIO_PRODUCTION_ENABLED` and `STUDIO_PUBLICATION_ENABLED`.
`services/studio-authoring/release-controls.ts` centralizes their typed denials.
This adds no role registry and does not replace current authorization.

| Canonical source under `apps/admin/src/services/studio-authoring/` | Enforcement                                                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`, `experiments.ts`, `execution.ts`                       | New production attempt, experiment and run after exact prior receipt/outcome lookup                                           |
| `execution.ts`                                                     | NEW paid-call claim before budget reservation; consumed same-call replay returns `execute: false` first                       |
| `render-jobs.ts`, `mux-jobs.ts`                                    | NEW execution claim before lease, generation, dispatch count or retry-budget consumption                                      |
| `publication.ts`                                                   | Every NEW manual/scheduled publish after receipt/hash lookup, before schedule consumption/visibility; final decision rechecks |
| `calendar-dispatch.ts`                                             | `PUBLICATION_DISABLED` retries the original stored command/window; expiry remains terminal                                    |

Never gate late upload/finish/retention, cancellation, unpublish or delivery
reconciliation. Preserve manual editing, source/asset reads, retained proposals and
calendar title/theme planning. Accepted publication retry after unpublish is an
observation of history; it cannot reactivate visibility. Production disable leaves
unclaimed queued work eligible within its original validity rules.

## Lock-wait regression

Fetching an attempt before waiting for its project lock can observe QUEUED and then
admit a paid claim after a concurrent holder terminalizes the attempt. The two-DB-
connection regression reproduced an erroneous `execute: true`. Read only immutable
identity before the lock. Under the acquired project/run locks, check the existing
call first, then reread mutable attempt state before NEW dispatch. This preserves
exact consumed-call replay even when the attempt is terminal or production disabled.

The owned Postgres tests prove no reservation/lease/dispatch consumption under
rejection, stored-envelope denial and expiry, historical accepted retry after
unpublish, late result retention, and persisted revocation delivery with a local
acknowledgement double. Manager's boundary test proves claim denial invokes no
provider or settlement callback. These are not provider or deployed fleet tests.

See [local evidence](../../validation/studio-462-release/README.md) and the
[operator runbook](../../runbooks/studio-release-canary-and-rollback.md). Every Admin
HTTP, workflow and step process must receive consistent configuration and restart
or drain; already admitted calls can finish. Startup flags do not promise an
instantaneous fleet-wide stop. Actual activation/revocation/canary acceptance remains
open and requires the authorized target environment.
