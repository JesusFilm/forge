# Production usage inventory and collector recovery

> Historical database-write audit only. Later on 2026-09-29, Jaco removed the
> coverage/inventory design as a mistake. Recorded counts must be shown for the
> unchanged date range regardless of interruptions. Inventory maintenance,
> collector recovery and narrower dates are no longer reporting requirements.
> [Fix PR #2472](https://github.com/JesusFilm/forge/pull/2472) implements that correction.
> Past writes and receipts below remain unchanged.

## Symptom and read-only diagnosis

On 2026-09-29 Jaco reported successful RAGBot retrievals but dashes in the portal
Usage table. The selected window was 22 September 05:17 UTC through 29 September
05:17 UTC. Replaying that window through the merged report adapter with the
restricted aggregate reader returned **5 requests, 5 successes**, last activity
`2026-09-29T03:41:32.611Z`, and `coverageStatus: unavailable`.

A one-minute reproduction, `[03:41,03:42)` UTC on 29 September, returned the same
counts and unavailable coverage. The read-only probe exited 1 because its exact
acceptance condition, complete coverage for that request minute, failed.
No personal consumer key or portal cookie was needed or accessed.

Metadata inspection found empty deployment inventory, two replaced deployments
whose collectors remained open, and one fresh live collector. There were zero
pending attempts and zero recorded gaps. Railway independently confirmed both
old deployments and every listed instance were removed; the current deployment
was successful with one running instance. Each deployment's configured region
and replica settings expected one replica.

The root cause was incomplete inventory/recovery configuration, not lost request
accounting. The UI deliberately suppresses totals when coverage is unavailable.
The seven-day window also contains time before collection began, so that window
cannot be made complete by registering today's deployments.

## Applied inventory writes

Jaco had authorized accurate production deployment inventory as part of
feat-529 setup. The operator announced the exact three intervals and stopped
collector recovery before applying them. One transaction, using only the
verified independent inventory login, inserted these rows and terminally closed
the first two through the existing guarded inventory adapter:

| Deployment                             | Declared UTC start  | Declared UTC end        | Expected replicas |
| -------------------------------------- | ------------------- | ----------------------- | ----------------- |
| `3c7abf21-c6f9-46a7-90be-3b32e2d3fbf7` | 2026-09-29 03:34:00 | 2026-09-29 04:45:52.727 | 1                 |
| `c7992d7c-00a5-4f10-a35f-6a463ef09868` | 2026-09-29 04:46:00 | 2026-09-29 04:58:26.354 | 1                 |
| `d4192ef8-9638-40d3-ac00-73f4ec6e959d` | 2026-09-29 04:59:00 | open                    | 1                 |

Starts are conservative first whole-minute boundaries after independently
observed container startup/healthy handoff, not application self-registration.
They intentionally leave startup and rolling-transition uncertainty uncovered.
End bounds come from Railway's removal metadata/control-plane stop events.
The receipt retains those independent observations and configured replica
settings, without logs containing credentials or corpus data.

Before writing, the operator rechecked Railway status/replicas, verified the
inventory role's privileges, refused existing inventory rows, and confirmed the
two exact collectors were still open and stale. The transaction acknowledgment
was captured at `2026-09-29T05:26:38.384Z`; this is an operator timestamp, not an
invented PostgreSQL commit timestamp.

Immediately after this transaction, the request-minute report changed from
unavailable to **complete**, while its request/success counts remained **5/5**.
This independently isolates missing inventory as the blocker for that minute.

## Applied collector reconciliation

The operator rechecked Railway's stop proof immediately before each call to the
existing `PostgresUsageStore.reconcile` operation:

| Collector                              | Reconciliation UTC time | Previously acknowledged through |
| -------------------------------------- | ----------------------- | ------------------------------- |
| `9afb9b03-b356-46d8-82a0-2a50ee77688e` | 2026-09-29 05:26:40.429 | 2026-09-29 04:45:50.009         |
| `695c954c-0f86-40cd-8f57-3a63ff033642` | 2026-09-29 05:26:43.511 | 2026-09-29 04:58:20.323         |

Each transaction selected/locked its stale open collector, issued a bounded
pending-state delete (there were no pending rows), inserted one durable gap from
the last acknowledgment through reconciliation time, and set that collector's
`complete_through`, `heartbeat_at` and `stopped_at` to reconciliation time.
Those timestamps mark conservative operator recovery, **not** a claim that the
old process remained live until then. Historical uncertainty remains recorded.

No `minutes`/success totals, consumer records, corpus rows, roles, schemas,
Railway variables or credentials were changed by the operator. The inventory
account remained outside the serving environment and RAGBot. No service deploy
or external message was triggered by this operation.

## Verification and limits

The original minimized read-only probe subsequently exited 0. Its report showed
5 requests, 5 successes, complete-through 03:42 UTC and complete coverage.
The original seven-day window still returned unavailable coverage, as required.
A fresh closed minute, `[05:27,05:28)` UTC, returned complete coverage with zero
requests and zero successes at `2026-09-29T05:29:27.325Z`, proving that current
coverage can be reported after recovery.
Receipts:

- [Read-only diagnosis before writes](production-usage-report-before.json)
- [Exact inventory/reconciliation and before/after receipt](production-usage-inventory-recovery.json)
- [Fresh completed-minute verification](production-usage-fresh-minute-verification.json)

Retained operator source:
`/home/jacobuntu/Ops/config/ragbot/operator/complete-usage-inventory.mts`;
SHA-256 `08e4d92c8c24c28255b9cbe06d6b73595bcd03897a9dd1c5b4be75226a32b47e`.
It refuses existing inventory; do not rerun it. The probe uses the existing
read-only report adapter, so no serving-code patch or invented coverage result
was introduced. Merging this audit does not replay any operation.

Use From `2026-09-29T03:41:00Z`, To `2026-09-29T03:42:00Z` in the portal to
inspect the recorded five retrievals. A window crossing unknown startup or
unflushed shutdown periods remains unavailable rather than claiming complete
totals.

No automation was installed by this historical operation. The later product
correction removes independent inventory and collector-stop recovery from current
reporting, so there is no deployment-upkeep requirement to carry forward.
Feat-529's staged +3/+2, lifecycle, isolation and seven-day/cutoff acceptance
remain separately tracked; aggregate 5/5 is not proof of the full ticket.
