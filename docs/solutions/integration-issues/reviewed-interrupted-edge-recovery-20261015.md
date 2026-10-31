---
title: "Recover multiple reviewed comparison calls without rewriting unknown usage"
date: "2026-10-15"
category: integration-issues
module: "Precomputed recommendation generation"
problem_type: integration_issue
component: service_object
symptoms:
  - "Seven interrupted calls hold ten source videos"
  - "The recovery path and readiness gate allow only one older incident"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [precomputed, recommendations, recovery, receipts, subscription]
---

# Recover multiple reviewed comparison calls

The first recovery implementation bound one older generation and one interrupted
call. A later generation accumulated seven interrupted calls. Repeating that
single-call path could not finish the held sources, and its database index
allowed only one acknowledgement per generation.

Keep reviewed exceptions explicit. Admin pins each original generation, attempt,
request and frozen candidate page. Migration 0152 permits one unique replacement
per reviewed call, while retaining the immutable acknowledgement triggers. The
manual runner admits recovery only with the same exact source/end-rank scope,
concurrency one, a closed original attempt and no live leases. Each replacement
must save known usage, apply every member and close before the next recovery.

The original usage remains unknown. Qualify exceptions separately by verifying
the saved replacement; never turn an uncertain invocation into zero tokens or
reuse its call ID. Preserve the original single-exception digest for compatibility
and combine digests only when multiple exceptions qualify. Readiness must compare
the total unknown count with the qualified count rather than assuming one.

Native PostgreSQL coverage runs two recoveries through the real Admin API in one
generation, checks unique replacement IDs and immutable originals, rejects changed
request seals/live leases, and requires the replacement attempt to close. The
fixture contains only incident identities, candidate IDs and span hashes. Prior
pages and replacement outputs are synthetic; no test invokes a model or claims
production recommendation quality.

The first live v6 recovery exposed a second producer boundary: `runEdgeBatch`
still required two sources on page zero with four candidates each. Extending the
Admin allowlist and the manual command did not exercise that executor guard.
Keep page index and starting rank in the producer's reviewed manifest, and run
every reviewed shape through the actual executor with fake model/ingest ports.
The seven v6 cases must reserve once, preserve the exact candidate ranges and
store known usage. Reject altered generation, source, page, rank and replacement
IDs before reservation. Preserve the legacy v4 prompt bytes while current v6
recoveries use the same lossless representation as their ordinary calls.

An acknowledged replacement blocks other new calls until its receipt applies.
If the runner stops before reserving that replacement, resume the same approved
replacement ID in a fresh attempt after proving no replacement row exists and
all prior attempts and leases have closed. Do not launch unrelated work while
that acknowledgement is unresolved, and never clear the original unknown usage.

References: `docs/operations/precomputed-catalog-build.md`,
`tests/integration/precomputed-reviewed-edge-recovery.db.test.ts`,
`apps/mastra/src/services/precomputed-recommendations/reviewed-edge-execution.test.ts`,
`apps/admin/src/services/recommendations/precomputed/reviewed-edge-recoveries.ts`.
