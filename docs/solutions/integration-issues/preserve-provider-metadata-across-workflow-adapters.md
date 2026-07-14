---
title: "Preserve Provider Metadata Across Workflow Adapters"
date: 2026-07-14
category: integration-issues
module: Mastra Instagram discovery
problem_type: integration_issue
component: service_object
symptoms:
  - "Distinct Instagram posts reached the inspiration review queue with the same fallback thumbnail"
  - "Successful Studio runs did not expose review-site inserted and skipped counts with a correlating run identifier"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - "Firecrawl search client"
  - "Instagram discovery workflow"
  - "Inspiration review ingest endpoint"
tags:
  - firecrawl
  - instagram
  - metadata
  - thumbnails
  - mastra
  - review-queue
---

# Preserve Provider Metadata Across Workflow Adapters

## Problem

The Instagram discovery workflow requested Firecrawl search results, parsed
qualified posts, and submitted them to the inspiration review site. Firecrawl
could return thumbnail-capable metadata such as `og:image`, but the normalized
search result dropped the metadata before the workflow adapter called
`parseInstagramPost`. Every submitted post therefore lacked `thumbnailUrl`, so
the review site correctly rendered its shared fallback poster.

The same handoff was difficult to diagnose from Mastra Studio because the final
step did not return the review site's `inserted` and `skipped` counts or attach
them to the workflow `runId` in logs.

## Symptoms

- Review cards for unrelated Instagram shortcodes displayed the same fallback
  poster even though upstream search metadata contained distinct image URLs.
- Unit tests for metadata parsing and thumbnail-bearing submitted posts passed
  independently, while the real adapter between those layers still lost the
  metadata.
- Operators could see a successful workflow result without being able to tell
  whether the review site inserted a candidate or skipped an existing one.

## What Didn't Work

- Testing `parseInstagramPost` with synthetic metadata only proved the parser.
  It did not prove the shared Firecrawl DTO and workflow adapter preserved that
  metadata.
- Testing submission with an already-populated `thumbnailUrl` only proved the
  final payload mapping. It bypassed the broken upstream connection.
- Replacing or varying the review site's fallback image would hide the symptom,
  not restore the missing per-post thumbnail data.
- Treating a malformed HTTP 200 ingest response as zero inserted and zero
  skipped would create false observability. Best-effort delivery still requires
  strict validation before a result is reported as successful.

## Solution

Preserve provider metadata in the internal Firecrawl result contract, then pass
only the keys the Instagram workflow recognizes across its strict boundary:

```ts
export type FirecrawlSearchResult = {
  url: string
  title: string | null
  description: string | null
  markdown: string | null
  markdownTruncated: boolean
  metadata: Record<string, unknown> | null
}

const sanitized: Record<string, unknown> = {}
for (const key of INSTAGRAM_DISCOVERY_METADATA_KEYS) {
  const value = metadata[key]
  if (typeof value === "string" && value.trim().length > 0) {
    sanitized[key] = boundedText(value)
  }
}
```

Enable bounded search hydration by default for this workflow so Firecrawl is
asked for thumbnail-capable metadata. Keep `scrapeMetadata: false` as the
explicit lower-latency, lower-credit opt-out.

Return a nullable, strictly validated review-site summary from both the direct
runner and the Studio report step:

```ts
const SiteIngestSummarySchema = z
  .object({
    runId: z.string(),
    inserted: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .strict()
```

Log the same three values on successful ingest. On configuration absence,
transport failure, or an invalid response, keep discovery successful and
return `siteIngest: null`; best-effort means the dependency cannot fail the
workflow, not that an unverified result should look successful.

Protect the cross-service behavior with tests at the ownership boundaries:

1. Feed a real Firecrawl response containing `metadata["og:image"]` through
   the shared client and actual workflow adapter, then assert the submitted
   post carries that value as `thumbnailUrl`.
2. Assert the workflow output and log both carry the same `runId`, `inserted`,
   and `skipped` values.
3. At the review-site ingest route, assert shortcodes already in Approved and
   Denied states remain skipped and no insert executes. Deduplication belongs
   to the persistence owner and must not depend on review status.

## Why This Works

The fix closes the exact lossy boundary instead of compensating downstream.
The internal Firecrawl DTO retains the provider response, while the workflow
allowlist keeps its strict public contract bounded and prevents arbitrary
metadata from leaking into Studio output or persisted artifacts.

The end-to-end adapter test crosses every layer that previously had isolated
mock coverage: provider response validation, normalized result construction,
workflow adaptation, Instagram parsing, and review-site payload creation. A
future field drop in any of those layers now fails one focused regression.

The nullable ingest summary preserves the existing availability contract while
making confirmed writes observable. Strict count validation prevents a false
zero/zero success from masking a response-contract regression.

## Prevention

- For data that must survive multiple adapters, test one representative value
  through the real chain rather than only testing each endpoint with unrelated
  fixtures.
- Keep provider-rich internal DTOs separate from bounded public workflow/tool
  schemas; explicitly project the latter instead of accidentally widening them.
- Treat best-effort integrations as nullable outcomes with validated success
  payloads, and include a stable run identifier in both output and logs.
- Test idempotency where it is owned. For the review site, cover existing
  records in every terminal review state and assert the write path is not
  invoked.

## Related Issues

- `docs/roadmap/media-generation/feat-253-instagram-discovery-thumbnail-ingest-observability.md`
- `docs/plans/2026-07-14-002-fix-instagram-discovery-thumbnail-ingest-observability-plan.md`
- Forge PR #1567
- Embers PR #18
