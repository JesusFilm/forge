---
title: "fix: Harden Watch SEO manifest fetch misses"
type: "fix"
status: "completed"
date: "2026-06-12"
origin: "production validation follow-up after Watch sitemap-only hreflang launch"
roadmap: "docs/roadmap/platform/feat-185-watch-seo-manifest-fetch-hardening.md"
---

# fix: Harden Watch SEO Manifest Fetch Misses

## Summary

Raise the Web timeout for cold Watch SEO manifest fetches and avoid caching an
initial failed fetch as a full-length miss. The sitemap routes should still use
the Admin-owned SEO manifest snapshot, keep serving a stale manifest after
refresh failures when one exists, and return a controlled 503 only when Web has
no valid manifest available.

## Problem Frame

Production seeding proved the persisted Watch SEO manifest is healthy, but the
first Web request after cache revalidation can cold-fetch roughly 3.9 MB from
Admin. One cold Admin response took slightly longer than the current 3 second
Web fetch timeout. When that first request times out, `getWatchSeoManifest`
caches `null` for the same 60 second TTL used for successful manifests, turning
a transient cold-fetch miss into a minute-long sitemap outage window.

## Requirements

- R1. Increase the Watch SEO manifest fetch timeout enough to cover observed
  cold Admin responses with margin.
- R2. Preserve the existing successful-manifest cache TTL and stale reuse
  behavior on refresh failures.
- R3. Cache only initial `null` misses for a short retry TTL so sitemap routes
  can recover quickly after transient cold-fetch failures.
- R4. Keep the Admin endpoint, bearer selection, ETag behavior, and sitemap
  route contract unchanged.
- R5. Add focused tests for the fetch timeout and initial-miss retry behavior.

## Implementation Units

### Unit 1: Web SEO Manifest Client Hardening

Files:

- `apps/web/src/lib/watch-seo-manifest.ts`
- `apps/web/src/lib/watch-seo-manifest.test.ts`

Approach:

- Change `WATCH_SEO_MANIFEST_TIMEOUT_MS` from 3 seconds to 10 seconds.
- Add a separate short miss cache TTL used only when no manifest was fetched.
- Keep the 60 second TTL for successful manifests and for stale manifest reuse.
- Assert the configured abort signal reaches `fetch`.

Test Scenarios:

- `getWatchSeoManifest` calls `AbortSignal.timeout` with the longer timeout
  and passes that signal to the Admin fetch.
- A first fetch error returns `null`, expires after the short miss TTL, and the
  next call refetches successfully.
- Existing 304 and failed-refresh behavior continues to reuse the cached stale
  manifest.

## Risks And Boundaries

- Do not change the sitemap XML shape, manifest schema, Admin generation script,
  or revalidation payload model.
- A longer timeout can hold one sitemap request open longer during Admin
  slowness, but avoids the larger operational risk of caching an avoidable
  initial miss for 60 seconds.
- This patch does not change production Railway env vars; those were handled
  operationally before this follow-up.

## Verification

- `pnpm --filter @forge/web test -- src/lib/watch-seo-manifest.test.ts src/app/sitemap.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
