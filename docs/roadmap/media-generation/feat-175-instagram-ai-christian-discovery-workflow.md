---
id: "feat-175"
title: "Instagram AI Christian discovery workflow"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-06-10"
duration: 1
depends_on: []
blocks:
  - "feat-194"
  - "feat-240"
tags:
  - "mastra"
  - "firecrawl"
  - "instagram"
  - "ai-pipeline"
---

## Problem

Creative and media teams need a repeatable way to discover AI-generated
Christian video examples on Instagram without relying on manual browsing or a
one-off script. Mastra already owns Firecrawl web data access, so the discovery
workflow should live there and reuse the shared Firecrawl runtime controls.

## What To Build

- [x] Add a Mastra workflow that searches Instagram-targeted queries through
      the shared Firecrawl client.
- [x] Parse Instagram post, reel, and tv permalinks into normalized post data.
- [x] Filter candidates with simple AI-generation and Christian keyword
      signals, dedupe by shortcode, and cap results.
- [x] Return results through a service-bearer-protected
      `/forge-instagram-discovery` route.
- [x] Persist a validated JSON report artifact under Mastra storage by default.

## Entry Points - Read These First

1. `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts`
2. `apps/mastra/src/services/instagram-discovery/post-parser.ts`
3. `apps/mastra/src/services/instagram-discovery/classifier.ts`
4. `apps/mastra/src/services/instagram-discovery/artifacts.ts`
5. `apps/mastra/src/services/firecrawl-client.ts`

## Grep These

- `instagram-ai-christian-discovery` - workflow id and tests.
- `/forge-instagram-discovery` - service route registration.
- `INSTAGRAM_DISCOVERY_ARTIFACT_DIR` - optional artifact root override.
- `searchFirecrawl` - shared bounded Firecrawl search client.

## Constraints

- Keep Firecrawl credentials and egress controls centralized in `apps/mastra`.
- Do not add a second Firecrawl HTTP client or alternate env surface.
- Keyword classification is an intentionally noisy first pass, not proof that a
  post is AI-generated or Christian.
- Keep persisted report fields bounded so one oversized search result cannot
  fail artifact serialization unexpectedly.

## Verification

- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`

## Plan

Implementation plan:
`docs/plans/2026-06-08-003-feat-instagram-ai-christian-discovery-plan.md`
