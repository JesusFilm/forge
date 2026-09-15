---
id: "feat-428"
title: "Watch infinite feed shared cache"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-25"
duration: 1
depends_on:
  - "feat-405"
blocks: []
tags:
  - "web"
  - "performance"
  - "redis"
  - "cloudflare"
---

## Problem

The public Watch infinite collection feed returns the same deterministic batches
to every viewer, but its Railway Redis entry expires after 60 seconds and the
browser route explicitly prevents shared Cloudflare caching. Drafts can also
serialize irrelevant child slugs into the exclusion query, making the request
large enough to fail before it reaches the bounded Admin query.

## Entry Points — Read These First

1. `apps/web/src/lib/featured-collection-references.ts` — authored collection
   and child exclusion projection.
2. `apps/web/src/lib/dynamic-collection-feed.ts` — shared Next Data Cache entry.
3. `apps/web/src/app/api/dynamic-collections/route.ts` — public feed transport
   and response cache policy.
4. `apps/web/src/app/api/revalidate/route.ts` — semantic cache invalidation.
5. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` and
   `apps/web/src/components/sections/DynamicMediaCollection.tsx` — live versus
   draft preview request scope.

## What To Build

1. Send only child media IDs and parent collection slugs as authored exclusions.
2. Cache deterministic live feed batches in the shared Railway Redis-backed
   Next Data Cache for 24 hours while retaining tag-driven immediate invalidation.
3. Mark draft preview requests explicitly and keep them out of Cloudflare's
   shared edge cache.
4. Emit Cloudflare-only shared cache headers for live successful responses when
   cache-tag purging is configured; keep browser caching disabled.
5. Purge the feed's Cloudflare cache tag best-effort when experience, video, or
   watch-setting revalidation invalidates the underlying feed content.
6. Require a server-issued signature for long-lived Redis admission and exact
   canonical query serialization for Cloudflare admission so arbitrary public
   query combinations cannot amplify shared-cache cardinality.

## Constraints

- Do not personalize feed results or include cookies, account identity, IP,
  geography, or user-agent state in the cache key.
- Keep locale, language, responsive profile, cursor, and canonical exclusions
  as cache variants.
- Keep the Admin feed as one bounded fixed-query batch; do not create per-card
  or per-carousel cache fan-out.
- Do not enable Cloudflare caching unless both purge credentials are configured.
- Do not fail an otherwise valid content webhook when Cloudflare purge fails.
- Do not deploy local worktree code directly to production.

## Verification

- Focused exclusion, client, route, feed cache, preview, and revalidation tests.
- Web typecheck, changed-file lint, formatting, and `git diff --check`.
- Production rollout must configure the Cloudflare zone/token and a cache rule
  that makes `/watch/api/dynamic-collections` eligible while respecting origin
  cache headers, then verify `CF-Cache-Status` transitions from `MISS` to `HIT`.

## Outcome

- Live and preview batches now use separate shared Next Data Cache namespaces
  with 24-hour and 15-minute retention respectively.
- Successful live responses can opt into Cloudflare caching only when tag purge
  is fully configured and the signed URL is canonical; preview, unsigned,
  manipulated, and failure responses remain edge-ineligible.
- Unsigned or invalid requests bypass the long-lived Redis wrappers, while
  valid callers receive the next cursor signature outside the strict JSON DTO.
- Relevant Web revalidation events expire Next tags and attempt one bounded,
  failure-isolated Cloudflare tag purge.
- Featured child slugs no longer inflate the parent exclusion query.
- Focused tests, Web typecheck, lint, formatting, and diff checks pass. The full
  Web suite still has unrelated existing jsdom `localStorage` harness failures.
