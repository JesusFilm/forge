---
title: "Bound behavioral retirement admission queries"
type: bugfix
status: active
date: 2026-10-29
---

# Bound behavioral retirement admission queries

## Observed failure

After release B, the reviewed pre-cleanup projection fence timed out before
mutation. A nonexecuting production `EXPLAIN` showed its active runtime check
scanning about 1.27 million `workflow.workflow_runs` rows (121,682 pages) under
`status IS NULL OR status NOT IN ('completed','failed','cancelled')`. The B
operator's `assertAdmission` repeats that shape and its broad retired CTE also
plans scans of the wrapper ledger. The 32 pending projection business rows,
zero new fences and zero retirement deletes were independently preserved. This
is a query-plan defect; it is not evidence that the five-second safety limit
should be widened.

## Repair

1. Validate the actual runtime `status` column is NOT NULL and its enum has
   exactly `pending`, `running`, `completed`, `failed`, `cancelled`. Refuse if
   the type, labels or nullability differ. Keep all other schema guard checks.
2. Under that closed-world catalog proof, use positive active states
   `status IN ('pending','running')`, and restrict each retired workflow name or
   key before joining. Preserve orphan, missing link, mismatched name and
   nonterminal-runtime refusal. Do not change a historical terminal runtime's
   business-ledger state.
3. Export a read-only preflight seam for the operational fence to call the same
   deployed admission guard rather than duplicate the slow runtime predicate.
   This does not grant operator dispatch or bypass the fence's exact cohort
   checks.
4. Model the real enum and useful indexes in the owned PostgreSQL fixture.
   Test active orphan refusal, historical terminal acceptance, missing or
   mismatched joins, unknown/future enum or nullability drift, and nonmutation
   on refusal. Compare actual local `EXPLAIN` shape with the old plan, while
   treating the parent's separate production plan check as the production
   evidence.

## Boundaries and verification

Keep the five-second statement budget, existing source-bound cutover proof,
advisory lock, batch/transaction caps, exact 19-table scope and fail-closed
error handling. No schema migration or production index is assumed. Run focused
unit/native PostgreSQL tests, Admin typecheck/lint/format and normal hooks;
stage for independent review before commit/push. The parent owns all production
mutation, normal deployment and final acceptance.
