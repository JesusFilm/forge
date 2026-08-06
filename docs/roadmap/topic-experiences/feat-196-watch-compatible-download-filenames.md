---
id: "feat-196"
title: "Watch compatible download filenames"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-17"
duration: 2
depends_on: []
blocks:
  - "feat-251"
  - "feat-337"
tags:
  - "web"
  - "watch"
  - "download"
  - "ux"
---

## Problem

Watch downloads currently save with filenames that identify the film title and
quality tier too weakly for field teams preparing microSD cards and devices.
Teams download hundreds of films, often across many languages for one region,
then manually rename files to include language, language code, and resolution so
helpers do not load the wrong media.

Same-name languages and regional versions make title-only or tier-only naming
unsafe. The filename should be portable across common filesystems and older
media-player browsers while carrying enough identity to avoid manual renaming in
the common case.

## Entry Points - Read These First

1. `docs/brainstorms/2026-06-17-watch-compatible-download-filenames-requirements.md` -
   product requirements, accepted filename convention, and scope boundaries.
2. `apps/web/src/components/watch/download-link.ts` - current
   `buildDownloadFilename` helper and proxy URL builder.
3. `apps/web/src/components/watch/DownloadModal.tsx` - modal download click
   path and programmatic anchor creation.
4. `apps/web/src/components/watch/WatchPageClient.tsx` - selected Dub and
   download metadata mapped into the modal.
5. `apps/web/src/lib/fragments/watch-video.ts` - selected Dub detail fragment.
6. `apps/admin/schema.graphql` - `Language.iso3` and
   `VideoDubDownload.height`/`width` availability.
7. `apps/web/src/app/api/download/route.ts` - filename sanitization and
   `Content-Disposition` behavior.

## Grep These

- `buildDownloadFilename`
- `DownloadProxyParams`
- `watchVideoDubDetailFragment`
- `downloadsForModal`
- `languageName`
- `iso3`
- `height`
- `Content-Disposition`

## What To Build

1. Generate default Watch download filenames in the compatible format
   `Title-Like-This_Language_iso3_360p.mp4`.
2. Use the selected audio language, not the UI locale, as the language segment.
3. Prefer ISO 639-3 for the language code, with a safe fallback when missing.
4. Prefer actual rendition height such as `360p`; fall back to the existing
   tier label when height is unavailable.
5. Keep the filename character set limited to ASCII letters, ASCII digits,
   hyphen, underscore, and period.
6. Keep raw CDN URLs server-only and preserve the existing same-origin proxy,
   account gate, Terms of Use flow, range behavior, and SSRF defenses.
7. Do not include subtitle language text unless the downloaded media file truly
   contains subtitle tracks.

## Constraints

- Do not expose `VideoDubDownload.url` to client-rendered markup.
- Do not weaken filename sanitization in `/watch/api/download`.
- Do not change Watch public route shapes.
- Do not change the Download modal's core flow unless a filename preview is
  explicitly needed.
- Do not hand-edit generated GraphQL env/type outputs without the matching
  generation command.
- If Admin GraphQL selection changes require generated artifacts, include those
  generated outputs in the same implementation PR.

## Verification

- Focused tests for `buildDownloadFilename`, including exact examples:
  `Jesus-Film_English_eng_360p.mp4`, missing ISO fallback, missing height
  fallback, same-name language disambiguation, and unsafe character stripping.
- Update Watch download modal tests to assert the proxy URL `filename` parameter
  and anchor `download` attribute use the compatible filename.
- Update fragment/normalization tests for any added language or rendition fields.
- `pnpm --filter @forge/web test -- src/components/watch/__tests__/DownloadModal.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx src/lib/fragments/__tests__/watch-video.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on a Watch page confirms the saved/proxy filename is compatible
  and the rendered href remains same-origin.
