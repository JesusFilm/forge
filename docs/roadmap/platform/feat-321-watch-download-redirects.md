---
id: "feat-321"
title: "Redirect Watch downloads off Web"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-07-27"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "download"
  - "cost"
---

## Problem

`GET /watch/api/download` currently streams full media files through the Web
service. Large Watch downloads therefore consume Web ingress and egress, and
each active transfer keeps a Web route handler alive for the duration of the
download.

## Entry Points - Read These First

1. `apps/web/src/app/api/download/route.ts` - current resolver, auth gate, URL
   allowlist, DNS preflight, and redirect response.
2. `apps/web/src/app/api/download/route.test.ts` - route security and response
   behavior tests.
3. `apps/web/src/app/api/download/route.auth.test.ts` - account-gate and
   opaque-ID lookup behavior.
4. `apps/web/src/components/watch/DownloadModal.tsx` - single-video download
   trigger.
5. `apps/web/src/components/watch/collection-download-queue.ts` - collection
   download sequencing.
6. `apps/web/src/components/watch/download-link.ts` - opaque route URL builder.

## Grep These

- `buildDownloadProxyUrl`
- `runCollectionDownloadQueue`
- `recordWatchEventWithAccessToken`
- `DOWNLOAD_AUTH_REQUIRED`
- `redirect: "manual"`

## What To Build

1. Preserve the `/watch/api/download` opaque-ID and auth-gated route contract.
2. Keep target allowlisting and DNS preflight before releasing a target URL.
3. Replace successful `GET` streaming with an HTTP redirect to the validated
   upstream URL.
4. Keep signed-in download event recording best-effort before the redirect when
   opaque IDs resolve event metadata.
5. Redirect anonymous inline VTT handling too; no successful route path should
   fetch, stream, proxy, or buffer upstream bytes through Web.
6. Update collection download sequencing so browser downloads are triggered via
   normal navigation/anchor behavior instead of fetching full blobs through the
   Web route.

## Constraints

- Do not expose raw CDN download URLs in client-rendered markup.
- Do not weaken the account-gate rollout behavior.
- Do not remove target lookup validation for `downloadId`/`variantId`/`videoSlug`.
- Do not proxy or buffer media or subtitle files in Web.
- Accept that browser filename control depends on the upstream CDN once the
  route redirects.

## Verification

- Route tests:
  `pnpm --filter @forge/web test -- src/app/api/download/route.test.ts src/app/api/download/route.auth.test.ts`
- Component tests:
  `pnpm --filter @forge/web test -- src/components/watch/collection-download-queue.test.ts src/components/watch/__tests__/DownloadModal.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`

## Completion Notes

- `GET /watch/api/download` now resolves, validates, and redirects downloads
  and inline VTT subtitle requests to the upstream URL instead of fetching and
  streaming through Web.
- `HEAD /watch/api/download` also redirects after validation and no longer
  performs an upstream metadata fetch.
- Signed-in opaque-ID download events are recorded before redirecting so the
  immediate redirect does not drop the best-effort event work.
- Collection downloads now trigger browser download anchors instead of
  `fetch()`ing the redirected response body; the folder-save path was removed
  from that flow because Web no longer owns the response stream.
- Focused route, caller, typecheck, and lint verification passed locally.
