---
id: "feat-253"
title: "Instagram discovery thumbnails and ingest observability"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on:
  - "feat-240"
blocks: []
tags:
  - "mastra"
  - "instagram"
  - "firecrawl"
  - "ai-pipeline"
---

## Problem

Instagram discovery reaches the website review queue, but the Mastra Firecrawl
adapter drops search-result metadata before parsing. Qualified posts therefore
arrive without `thumbnailUrl`, and the review website correctly renders its
shared fallback poster. The Studio report step also logs only aggregate ingest
counts without a run identifier and omits those counts from step output, which
makes a specific workflow run difficult to correlate with review-queue writes.

The website already deduplicates by locale, content type, and shortcode across
all review states, but its Approved and Denied behavior is not protected by a
route regression test.

## Entry Points - Read These First

1. `apps/mastra/src/services/firecrawl-client.ts` - shared Firecrawl response
   validation and normalized search DTO.
2. `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts` -
   real search adapter, Studio steps, and best-effort site submission.
3. `apps/mastra/src/services/instagram-discovery/post-parser.ts` - recognized
   thumbnail metadata keys.
4. `apps/mastra/src/services/instagram-discovery/site-ingest-client.ts` -
   review-site payload and response contract.
5. Embers `apps/aimedialab/src/app/api/inspiration-candidates/route.ts` -
   persisted review-state dedupe owner.

## Grep These

- `scrapeMetadata` and `includeMarkdown` - Firecrawl result hydration switch.
- `FirecrawlSearchResult` and `SearchResultSchema` - metadata loss boundary.
- `requestInstagramDiscoverySearch` - workflow adapter into post parsing.
- `submitToReviewQueue` and `site_ingest` - run diagnostics.
- `on conflict (locale, type, slug) do nothing` - website dedupe fallback.

## What To Build

- [x] Request scraped Firecrawl metadata by default for Instagram discovery.
- [x] Preserve bounded search-result metadata through `FirecrawlSearchResult`
      and the real workflow adapter so `metadata["og:image"]` reaches
      `parseInstagramPost` and the review-site `thumbnailUrl` payload.
- [x] Add `runId`, `inserted`, and `skipped` to successful site-ingest logs and
      expose the same correlation data in Studio report-step output.
- [x] Keep website submission best-effort and additive for route consumers.
- [x] Add a real-adapter regression test from Firecrawl response metadata to
      the submitted review-site post.
- [x] Add an Embers route regression test proving previously Approved
      (`published`) and Denied (`archived`) shortcodes remain skipped.

## Constraints

- Do not add a second Firecrawl client or move Firecrawl access out of Mastra.
- Do not make website availability a discovery success dependency.
- Do not log credentials, request bodies, or raw post captions.
- Do not change the review website fallback-image behavior.
- Do not re-queue a shortcode merely because its review status changed.
- Production deploys continue through normal PR-to-main flows only.

## Verification

- Focused Mastra tests for the Firecrawl client, Instagram workflow, parser,
  and site-ingest client.
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- Embers focused route test for `published` and `archived` existing rows.
- Browser smoke of the review page and Studio/report contract when a local or
  safely authenticated test surface is available; no production mutations.

## Plan

Implementation plan:
`docs/plans/2026-07-14-002-fix-instagram-discovery-thumbnail-ingest-observability-plan.md`
