---
id: "feat-736"
title: "Import shared-reading results for private Admin review"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-19"
duration: 2
depends_on:
  - "feat-733"
blocks: []
tags: [recommendations, admin, evidence]
---

## Problem

Shared-reading-v1 preserves long explanations, both evidence sides and frozen subtitle references. Legacy private import assumes short target-only DB evidence and older generation provenance. Allow an explicitly declared completed pilot or full catalog to use existing authenticated storage and private Admin review without changing public eligibility or historical results.

## Entry points

- `apps/mastra/src/services/precomputed-recommendations/shared-reading-import.ts`: read-only verification/export of declared completed runs and linked physical origins.
- `apps/mastra/src/scripts/import-shared-reading-recommendations.ts`: local dry run by default; explicit operator submission to the existing authenticated ingest endpoint.
- `apps/admin/src/services/recommendations/precomputed/shared-reading-import-contract.ts` and `shared-reading-import.ts`: reserved version, immutable private manifests/source/call artifacts, protocol-1 JSON-array storage, idempotent completion commitments.
- `apps/admin/src/app/dashboard/recommendations/precomputed/view.tsx`: both evidence sides, exact values/references and pilot/catalog scope.
- [Brief design](../../plans/2026-10-19-shared-reading-private-import.md) and [operator instructions](../../solutions/integration-issues/shared-reading-private-import-review.md).

## Boundaries

No schema migration, generation, transcript truncation, invented DB chunk IDs, profile/pair calls, analytics qualification, public activation or control changes. The frozen corpus and original manifests/receipts/results stay untouched. Distinct chapters, siblings and parent films remain eligible; reject self and identical nonempty core/slug identities only. Unknown usage blocks export/completion rather than becoming zero. A working partial catalog is not a completed import; zero-choice sources require explained shortfall.

Existing protocol 1, `content_only`, `shared-reading-v1` discriminator and private object storage preserve full results. `preflight_failed` records that current DB text freshness/public qualification is not asserted; it does not describe the verified frozen-corpus evidence as a fixture. Existing public gates remain closed. Normal reviewed PR-to-main delivery is allowed; production import waits for independent review and merge.

## Verification

Focused synthetic transport and authenticated import tests cover immutable evidence/receipt binding, full source/target coverage, parent-origin deduplication, zero/shortfall handling, invalid identity/evidence/ranks, unknown consumption, idempotent source/call replay and completion commitments. Real accepted four-source pilot dry run must match32 results and23 physical calls without writes to inspected artifacts. Independent review accepted the stable private-import scope:54 focused tests pass, plus11 native PostgreSQL lifecycle/replay/locking/rollback tests. Authenticated local Next/browser review accepted the private view with explicit dev/runtime seams; deployed network/S3 and production-build latency remain unmeasured. Earlier supported Admin/Mastra typechecks passed. Code work is complete; generation feat-733 stays in-progress, and no production import or full-catalog completion is claimed.
