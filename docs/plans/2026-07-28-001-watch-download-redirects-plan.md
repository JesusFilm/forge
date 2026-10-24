---
status: complete
created: "2026-07-28"
completed: "2026-07-28"
origin: "User request to remove Web streaming proxy because of significant egress cost"
roadmap: "docs/roadmap/platform/feat-321-watch-download-redirects.md"
---

# Watch Download Redirects Plan

## Problem

`GET /watch/api/download` streamed large Watch media files through the Web
service. That doubled bandwidth across Web for every video download and kept a
route handler alive for the duration of each transfer.

## Scope

Replace media and subtitle streaming with redirects while preserving
server-side download target resolution, auth gating, SSRF defenses, and event
recording.

## Requirements Trace

- Stop proxying or buffering large video/audio files through Web.
- Keep raw CDN URLs out of client-rendered markup.
- Preserve opaque `downloadId`/`variantId`/`videoSlug` lookup.
- Preserve account-gate behavior when `forge.watch.downloadAccountGate` is on.
- Keep SSRF protections before releasing the target URL.
- Redirect allowlisted inline VTT subtitle requests instead of proxying them.
- Accept that filename control shifts to the upstream CDN/browser once Web
  redirects instead of setting `Content-Disposition`.

## Implementation Units

### Unit 1 - Redirect Media Downloads

Files:

- `apps/web/src/app/api/download/route.ts`
- `apps/web/src/app/api/download/route.test.ts`
- `apps/web/src/app/api/download/route.auth.test.ts`

Approach:

- Keep `resolveRequestedTarget` and `validateTarget` as the authoritative
  server-side gates.
- Return `302 Location: <validated target>` without fetching the upstream body
  for attachment downloads, inline subtitles, or HEAD requests.
- Await best-effort signed-in download event recording before returning the
  redirect so the route lifecycle does not drop the event work.

Test Scenarios:

- Attachment downloads, inline VTT subtitles, and HEAD requests redirect and do
  not call upstream `fetch`.
- Opaque ID downloads still resolve through Admin before redirect.
- Account-gated signed-out downloads still return `401` before DNS/fetch.
- Non-allowlisted URLs and private DNS results still fail.
- Anonymous inline raw URLs are limited to allowlisted `.vtt` targets.

### Unit 2 - Preserve Caller Contracts

Files:

- `apps/web/src/components/watch/download-link.ts`
- `apps/web/src/components/watch/DownloadModal.tsx`
- `apps/web/src/components/watch/collection-download-queue.test.ts`
- `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx`
- `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`

Approach:

- Keep the same same-origin route URL builder so client markup remains opaque.
- Update comments to describe the route as a resolver that redirects media
  downloads rather than a streaming proxy.
- Trigger collection downloads with normal anchor clicks instead of `fetch()` so
  the browser follows the redirect as a download/navigation, not as a CORS-gated
  body read.
- Remove the folder-save path from the collection modal because the browser
  download handoff no longer writes response bodies through Web code.
- Confirm existing caller tests still pass with the route contract.

Test Scenarios:

- Single-video modal still creates an opaque `/watch/api/download` anchor.
- Watch page lazy modal boundary still renders the opaque fallback download URL.
- Collection queue tests continue to cover sequential behavior.
- Collection queue tests assert it does not call `fetch()`.

### Unit 3 - Roadmap Documentation

Files:

- `docs/roadmap/platform/feat-321-watch-download-redirects.md`
- `docs/roadmap/topic-experiences/feat-251-watch-collection-sequential-downloads.md`

Approach:

- Track the cost-driven redirect work in a dedicated platform roadmap ticket.
- Update active collection-download roadmap wording so it no longer depends on
  an authenticated streaming proxy.

## Risks and Tradeoffs

- Filename control no longer comes from Web `Content-Disposition`; it depends
  on browser/CDN behavior after redirect.
- Redirect releases the signed media URL to the browser after the server-side
  resolver validates it. This is necessary to avoid Web egress.
- Web no longer probes or follows upstream redirects, so downstream redirect
  behavior is owned by the browser/CDN after the validated handoff.

## Verification

- `pnpm --filter @forge/web test -- src/app/api/download/route.test.ts src/app/api/download/route.auth.test.ts`
- `pnpm --filter @forge/web test -- src/components/watch/collection-download-queue.test.ts src/components/watch/__tests__/DownloadModal.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser route smoke with `agent-browser` against a local dev server when
  environment data is available.

## Review Fixes

- Fixed anonymous `disposition=inline` media URLs so only the explicit anonymous
  VTT subtitle path may use a raw URL when the account gate is disabled, and
  that path now redirects without fetching upstream.
- Replaced collection download body fetching with anchor-triggered downloads.
