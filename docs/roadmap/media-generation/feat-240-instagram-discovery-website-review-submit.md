---
id: "feat-240"
title: "Instagram discovery website review submission"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-09"
duration: 1
depends_on:
  - "feat-175"
  - "feat-194"
blocks:
  - "feat-252"
tags:
  - "mastra"
  - "instagram"
  - "ai-pipeline"
---

## Problem

The Instagram AI Christian discovery workflow can find and report qualified
posts, but the handoff to the public inspiration website review queue is still
manual. Operators need Mastra to submit qualified posts to the website ingest
endpoint when that cross-repo connection is configured, without making discovery
depend on website availability.

## Entry Points - Read These First

1. `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts` -
   discovery orchestration, report persistence, and website submit hook.
2. `apps/mastra/src/services/instagram-discovery/site-ingest-client.ts` -
   website ingest payload mapping and HTTP failure handling.
3. `apps/mastra/src/config/env.ts` - optional site ingest env parsing and helper.
4. `apps/mastra/CLAUDE.md` - operator docs for the optional website link.

## Grep These

- `INSTAGRAM_DISCOVERY_SITE_INGEST_URL` - optional website ingest endpoint.
- `INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN` - bearer token shared with the website.
- `submitPostsToSite` - HTTP client for the website review queue.
- `site_ingest_failed` - best-effort failure log emitted by discovery.

## What To Build

- [x] Add optional Mastra env vars for the website review queue ingest URL and
      bearer token.
- [x] Submit only qualified Instagram posts to the website review queue when
      both env vars are configured.
- [x] Keep submission best-effort: website outages, auth failures, or invalid
      responses must be logged but must not fail discovery.
- [x] Enforce HTTPS for the ingest endpoint before sending the bearer token.
- [x] Document the deploy-time env relationship to the website
      `ADMIN_REVIEW_TOKEN`.

## Constraints

- Do not make the new website env vars required at production boot.
- Do not submit unqualified, non-Instagram, or commentary-excluded posts.
- Do not retry or persist a second queue inside Mastra; the website remains the
  dedupe and review-state owner.
- Do not send the bearer token to non-HTTPS ingest URLs.

## Verification

- `node_modules/.bin/vitest run src/services/instagram-discovery/site-ingest-client.test.ts src/mastra/workflows/instagram-ai-christian-discovery.test.ts`
- `apps/mastra/node_modules/.bin/tsc --noEmit -p apps/mastra/tsconfig.json`
- `apps/mastra/node_modules/.bin/eslint apps/mastra/src/services/instagram-discovery/site-ingest-client.ts apps/mastra/src/services/instagram-discovery/site-ingest-client.test.ts apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.test.ts apps/mastra/src/config/env.ts`
