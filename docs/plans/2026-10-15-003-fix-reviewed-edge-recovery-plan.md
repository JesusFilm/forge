---
title: "fix: Recover the seven reviewed interrupted comparison calls"
type: fix
status: active
date: 2026-10-15
---

# Recover the seven reviewed interrupted comparison calls

Seven dispatched calls in the current catalog have no usage receipt. Their ten
source videos remain held. Extend the existing explicit operator recovery to
these exact reviewed calls, preserving the original unknown records and reusing
the complete profiles, frozen catalog and sealed historical import.

## Requirements

- R1: Admit only the existing reviewed v4 incident and the seven sealed v6 calls.
  Bind each to generation/input, original attempt, physical request and frozen
  members/pages. Reject altered scope, unreviewed calls and existing replacement IDs.
- R2: Preserve null original usage and immutable acknowledged records. Allow one
  replacement per original call, with a unique replacement ID. Do not invent a
  receipt or automatically retry a dispatched call.
- R3: Require an explicit serial resume, the old attempt closed, no live leases,
  no pending profile calls, current account/capacity admission and ready profiles.
  Reconstruct the exact original candidate page. Continue normal work only after
  replacement receipt/application is verified.
- R4: Qualify each exception only after its same-content replacement succeeds,
  saves known usage, applies every original member and closes its attempt. Retain
  unresolved/unknown counts separately from this qualification.
- R5: Test the migration, multiple acknowledgements, tamper rejection, original
  immutability and exact replacement through native Admin. Ship via normal main
  deployment; recover the held pages before the final full-generation completion.

## Implementation

1. Add an explicit reviewed recovery manifest to Admin and parameterize the
   existing recovery checks. Keep v4 behavior compatible and v6 authority narrow.
2. Replace the one-acknowledgement-per-generation index with replacement uniqueness
   and a database check restricted to the reviewed generation/call pairs. Preserve
   existing immutable-call/member triggers; do not rewrite incident records.
3. Extend the local manual runner's reviewed scopes and existing serial recovery
   path to the original v6 page boundaries. No new profile/model format or GA query.
4. Run targeted/native tests, type checks, lint, review and CI. Reconcile each
   replacement after production deployment and then finish the remaining sources.

## References

- `apps/admin/src/services/recommendations/precomputed/edge-ledger.ts`
- `apps/admin/prisma/migrations/0146_precomputed_one_time_edge_recovery/migration.sql`
- `apps/mastra/src/services/precomputed-recommendations/manual-subscription-catalog.ts`
- `docs/operations/precomputed-catalog-build.md`
