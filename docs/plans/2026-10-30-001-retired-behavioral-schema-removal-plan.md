---
title: "Remove drained behavioral recommendation code and schema"
type: refactor
status: active
date: 2026-10-30
ticket: feat-905
---

# Remove drained behavioral recommendation code and schema

## Scope and accepted baseline

The owner requested continuation of the physical profile/co-watch cleanup.
Feat-902 is independently complete: production source
`786902d4d3a0288bf86b2661e63f6c2ccd1e9195`, 3,088,917 direct deletions,
19 exactly empty retired tables, and three detached retained-reference
categories. The accepted receipts and their limits are in
`docs/reports/2026-10-29-behavioral-recommendation-retirement.md`.

This work removes the remaining obsolete implementation and the exact 19-table
set in `RETIREMENT_PHASES` in
`apps/admin/src/services/recommendations/behavioral-retirement-cleanup.ts`.
Preserve historical migrations and reports. Preserve native viewer/push
identity, request and playback evidence, eligibility, Watch exposures,
semantic/metadata retrieval, curated fallback, content profiles, and current
precomputed A/B models. A video content profile is retained metadata, not a
retired viewer profile. Legacy experiment, shadow, composition, promotion,
study and owner-release data are outside the delete set.

Retain `recommendation_behavioral_retirement_batch` as the durable reconciliation
record for the completed operation. Remove its operational writer together
with the retired drain CLI; do not delete the receipts or rewrite committed
history. Keep detached historical reference values/columns interpretable even
when their foreign-key relations to removed tables disappear.

## Release order

Migrations execute before replacement applications start. Dropping tables in
the first code-removal release would break older HTTP/worker replicas that
still use them for ordinary retention, health, privacy or trigger paths.
Use two reviewed releases. This is a deployment compatibility boundary, not a
deferral of the requested cleanup.

### U1: Remove application dependencies while keeping the schema compatible

Inventory all application, job replay, manual route, CLI, test and contract
references to the 19 models/tables. Remove obsolete learner/profile/co-watch
implementations and their dedicated tests. Preserve required public tombstones
without database access; do not resurrect retired behavior or silently change
the retained product's API. Remove ordinary cleanup and health probes for the
retired families, and update their health contract and tests coherently.
Keep historical counters interpretable. Remove the completed drain operator
and update live runbook instructions so it cannot be accidentally restarted.

Keep the Prisma models and physical tables for this release. Any remaining
schema-generated types or compatibility declarations must be listed explicitly
for U2. If Pothos changes, regenerate both SDL and consumer introspection using
the normal commands. Do not hand-edit generated outputs.

Verification: focused retained-serving, native identity, playback, privacy,
ordinary retention/health and workflow replay tests; real PostgreSQL tests for
the changed persistence boundaries; Admin typecheck/lint/format and required
CI. Independently review the exact final head, merge normally and verify every
actual HTTP and worker replica has the compatible source before U2 merges.

### U2: Remove the exact drained schema with a forward migration

Inventory database dependencies, including functions and triggers attached to
retained tables, foreign keys and constraints, not just Prisma relation fields.
Remove only dependencies of the retired mechanism. Keep other historical
families and their integrity behavior. Remove the 19 Prisma models and unused
types, then generate clients normally. Append a migration with explicit object
names and no broad `CASCADE`. Require empty retired tables and detached
retained references at migration admission; unexpected rows must fail safely
and receive a separately coordinated bounded drain, not be discarded by DDL.
Bound lock/statement waits and preserve atomicity. Do not alter old migrations.

Verification: populated native PostgreSQL migration tests reject nonempty or
attached input, preserve all retained fixtures and their FK/trigger behavior,
and exercise ordinary retention after the drop. Audit all runtime SQL and
generated-model references. Run scope-specific format/typecheck/lint and CI;
independently review the final head before the normal PR-to-main release.

### U3: Verify the actual release and close out

Before U2, make a bounded read-only census of exact retired-table emptiness,
detached references, current deployments, relation allocation and PGDATA/WAL.
Keep original raw observations privately, including nonzero/timeout outcomes.
After normal deployment verify actual HTTP/worker revisions, the migration
checksum, absence of precisely the retired catalog objects, preserved retained
data/contracts and naturally occurring serving/cleanup evidence.

Measure relation allocation and PGDATA/WAL separately. Do not equate removed
rows, dropped allocation or reusable pages with filesystem bytes recovered.
Update feat-905, the consolidated report, applicable runbooks and the existing
daily observer to understand the changed health inventory. Preserve historical
26-family receipts. Do not mark feat-554/756 complete from this schema removal:
the October 29 ordinary cycle had eight genuine failures whose latency cause
is still unproved. Do not claim this cleanup fixes those failures without
separate evidence.

## Execution ownership and limits

The existing storage owner implements U1 in an isolated worktree. The parent
owns this plan/ticket, U2 schema integration, merge order and shared production
coordination. The existing independent reviewer audits dependencies and then
reviews each exact release head. No child delegates further. Do not edit the
dirty `/home/nisal/forge` checkout.

No direct deploy/redeploy, production fault injection, timeout widening,
manual ordinary-expiry run or `VACUUM FULL` is part of this work. A provider
failure is preserved and reported; it does not permit bypassing release or
catalog checks. Existing daily expiry remains enabled.
