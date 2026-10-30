---
module: recommendations
problem_type: integration_issue
title: "Review shared-reading results privately without legacy evidence loss"
date: 2026-10-19
tags: [recommendations, shared-reading, private-import, evidence, provenance]
---

Shared-reading-v1 results use complete explanations, both evidence sides and frozen subtitle/metadata references. Legacy caps and DB-chunk-only assumptions cannot represent them faithfully. The private bridge reserves `shared-reading-v1` within existing protocol1 and `content_only` storage; no migration or public activation is involved.

## Validate first

Run from the repository root with existing dependencies. This command reads local artifacts and prints a summary; it does not access model/account/tokenizer services or write inspected runs:

```sh
pnpm exec tsx apps/mastra/src/scripts/import-shared-reading-recommendations.ts --config /private/shared-reading/import-config.json
```

Minimal config (replace paths, hashes and source IDs with reviewed values):

```json
{
  "generationId": "shared-reading-private-pilot-20261019",
  "scope": "private_pilot",
  "corpusPath": "/private/shared-reading/complete-export.json",
  "corpusSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "sourceIds": ["admitted-source-video-id"],
  "runs": [
    {
      "directory": "/private/shared-reading/completed/run",
      "manifestSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "resultSha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ]
}
```

`sourceIds` must exactly match the disjoint union of complete declared runs. A private pilot explicitly covers only those sources. `full_catalog` additionally requires every frozen corpus source (currently1031), complete target coverage for each and all physical receipt reconciliation. Active partial runs and isolated group checkpoints are refused. A valid zero-choice source still has a saved source result and substantive shortfall explanation.

Optional `--export /new/private/bundle.json` saves the verified bundle with exclusive creation and private permissions, outside inspected runs. It contains private evidence/witnesses: do not commit or publish it. Existing ingest requests remain bounded to2MiB; oversized requests stop rather than dropping text. The manifest commits canonical object-key-sorted wire digests; original generator request/file hashes retain their original rules.

The corpus uses the generator's complete selected-per-edition transcript policy, including explicitly metadata-only videos; this does not assert that every uploaded language was selected. Counts cover declared runs and linked parents, not all historical AI usage.

The exporter checks the corpus/reference hashes, full reading trees and exact acknowledgments, partial-parent discoveries, all-discovery ranking transfer, final selection/rejection, evidence expansion and saved result equality. It validates origin/request/reservation/receipt/response/result bindings and actual usage/context limits, then rechecks inspected bytes. Linked parent origins are aggregated once; derived usage summaries are not added. Known failed physical calls keep exact usage and original receipts. Unreserved local preparation is a separate nonphysical observation. Missing/unknown reserved usage blocks export; no zero estimate or automatic retry is substituted. Parent artifacts are neither copied into new physical calls nor relabeled.

## Submit and review after merge

Coordinator operates import only after independent review and normal PR-to-main merge. Use the existing HTTPS `ADMIN_RECOMMENDATION_INGEST_URL` and `ADMIN_MASTRA_RECOMMENDATION_API_KEY` securely, then append `--submit` to the validated command. The script makes no network requests without that flag. It sends start, physical calls, individual sources and complete in order through the existing bearer-authenticated endpoint. On interruption investigate, then rerun the identical config for idempotent replay. Changed input requires a new generation ID. Do not erase records or alter frozen artifacts to make replay pass.

Admin stores content-addressed private manifest/source/call objects under `recommendations/private/shared-reading-v1/`, full JSON-array source payloads and one model-call row per unique physical origin. Each call has one canonical participating source attribution; membership, reasoning subset and raw receipt details remain in its private artifact. Failed calls use the existing DB failed-row shape; their original response digest/code remain in the raw private receipt. Missing input/output/cached usage or unknown consumption cannot complete. Optional unreported reasoning stays a known subset, not an inferred zero. Counts from multiple imported generations must not be summed as unique campaign usage without origin reconciliation.

Authenticated producer verification attests the frozen witnesses; Admin checks their exact content/ownership, current video core/slug identity and manifest commitments. Supplemental subtitle chunk/transcript IDs remain private source refs, **not DB chunk IDs**. Neither current DB transcript freshness nor GA/profile/pairwise qualification is fabricated. Existing `preflight_failed` snapshot status records that live freshness/public qualification is unasserted, while the private frozen evidence is verified.

Authorized Admin reviewers (aggregate and trace permissions) open:

```text
/dashboard/recommendations/precomputed?generation=<generationId>&source=<sourceVideoId>
```

The page shows declared pilot/catalog scope, all saved playable choices (up to8), full connection/watching value, both exact evidence sides, metadata values, original transcript IDs and private provenance keys. Current playback/language eligibility may create presentation gaps; saved results remain intact. This does not enable a public experiment, qualify CTR policy or change public serving. Public activation remains a separate owner decision. Subscription-only generation provenance remains Astra via guarded ChatGPT included authentication; this adapter never generates or spends credits.

## Verified private-import scope

Independent review accepted54 focused tests,11 native PostgreSQL lifecycle/replay/lock/rollback tests and authenticated local Next/browser evidence. The local dev performance proof excludes production-build, remote S3/network and deployed contention guarantees. External content-addressed object writes cannot roll back with SQL; an aborted transaction can leave private orphan objects while database completion remains guarded.

The accepted four-source pilot dry run preserves32 choices and23 unique physical origins. This proves the declared pilot bridge, not full-catalog completion. Synthetic start capacity measured1,822,499 bytes for4,680 reads plus two ranking calls per1,031 sources, below2MiB; extra splits, failures, provenance or long shortfalls can exceed it. Every actual manifest/source/call action is still checked and refused if oversized, without truncation. Code acceptance does not perform an import or grant public qualification; normal reviewed merge precedes coordinator-operated import.
