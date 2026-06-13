---
id: "feat-186"
title: "Watch download target lookup hardening"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-12"
completed_date: "2026-06-12"
duration: 1
depends_on:
  - "feat-179"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "download"
  - "reliability"
  - "performance"
---

## Problem

QA reported a `503` when selecting `Download` on the Pilate Watch page. The
current production endpoint did not reproduce the failure during follow-up
checks, but the lookup path before streaming is expensive and brittle: Web
resolves one download click by querying `videoBySlug` and projecting every Dub
and download row for the video. For Pilate, that means thousands of Dubs and
downloads before the proxy can stream one selected MP4.

The same target can be resolved through the existing public `videoDub(id:)`
query, which fetches one Dub and its downloads. Narrowing this path should
reduce intermittent `503` risk without changing the rendered Download CTA, the
same-origin proxy, the account gate, or SSRF defenses.

## Entry Points - Read These First

1. `docs/plans/2026-06-12-005-fix-watch-download-target-lookup-plan.md` -
   implementation plan for this hardening slice.
2. `apps/web/src/lib/download-target.ts` - current server-side lookup by
   `videoBySlug`.
3. `apps/web/src/app/api/download/route.ts` - same-origin proxy and status
   mapping for resolver failures.
4. `apps/web/src/components/watch/WatchPageClient.tsx` - rendered opaque
   Download href.
5. `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`
   - rendered href regression surface.
6. `docs/solutions/design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md`
   - existing per-Dub lazy fetch pattern.
7. `docs/solutions/security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md`
   - streaming proxy security boundary.

## Grep These

- `resolveWatchDownloadTarget`
- `getWatchDownloadTargetOperation`
- `videoBySlug(slug: $videoSlug)`
- `videoDub(id:`
- `buildDownloadProxyUrl`
- `Download lookup unavailable`
- `downloadId`
- `variantId`

## What To Build

1. Change the Web download target resolver to query `videoDub(id:)` by
   `variantId` instead of loading every Dub through `videoBySlug`.
2. Preserve the opaque `downloadId`, `variantId`, and `videoSlug` binding by
   validating that the returned Dub is published, downloadable, belongs to the
   requested video slug, and contains the requested download.
3. Keep route status behavior stable: missing params `400`, mismatched target
   `404`, Admin lookup failure or empty upstream URL `503`.
4. Add sanitized diagnostics for lookup failures without logging raw CDN URLs.
5. Add focused resolver, route, and rendered-href regressions, including a
   Pilate-shaped default Download href fixture.
6. Retest with a `HEAD` and one-byte range request against the rendered
   same-origin Download href.

## Constraints

- Do not expose raw CDN download URLs in client-rendered markup.
- Do not bypass the existing Download modal, Terms of Use flow, or account
  gate for normal hydrated clicks.
- Do not change the `/watch/api/download` same-origin route shape.
- Do not weaken SSRF allowlist, DNS pre-flight, redirect, timeout, or bounded
  header behavior.
- Do not change Admin schema unless the existing `videoDub(id:)` field proves
  unusable for Web.

## Verification

- `pnpm --filter @forge/web test -- src/lib/download-target.test.ts`
- `pnpm --filter @forge/web test -- src/app/api/download/route.test.ts src/app/api/download/route.auth.test.ts`
- `pnpm --filter @forge/web test -- src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Helium smoke on the Pilate Watch page confirms the rendered Download href is
  same-origin and returns a successful one-byte range response.

## Plan

Implementation plan:
`docs/plans/2026-06-12-005-fix-watch-download-target-lookup-plan.md`
