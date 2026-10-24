---
id: "feat-341"
title: "Watch Alternate Subtitle Track Loading"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-06"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "i18n"
---

## Problem

On the Mandarin China JESUS Watch page, selecting the available Chinese Simplified subtitle creates the Forge-owned native text track, but the browser reports `readyState=3` with no cues. The same proxied VTT URL returns `200 text/vtt` and valid `WEBVTT` content to a normal request, so the failure is at the native `<track>` loading boundary rather than subtitle discovery or missing data. This work tracks Linear issue `FGE-67`.

## Entry Points - Read These First

1. `apps/web/src/components/watch/HeroPlayer.tsx` - creates the Forge-owned `<track>` element and activates its `TextTrack`.
2. `apps/web/src/components/watch/WatchPageClient.tsx` - builds the selected alternate-language subtitle URL through the Watch download proxy.
3. `apps/web/src/app/api/download/route.ts` - returns proxied inline VTT responses and defines the browser-visible response contract.
4. `apps/web/src/app/api/download/route.test.ts` - owns focused route coverage for inline subtitle responses.
5. `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx` - owns selected subtitle proxy URL coverage.

## Grep These

- `subtitleVttSrc` in `apps/web/src/components/watch/`
- `data-subtitle-track` in `apps/web/src/components/watch/HeroPlayer.tsx`
- `disposition=inline` in `apps/web/src/`
- `Content-Disposition` and `text/vtt` in `apps/web/src/app/api/download/`

## What To Build

1. Reproduce or characterize the native text-track failure and identify the first boundary where the working VTT response becomes browser-invalid.
2. Correct the smallest response or player integration contract responsible for alternate-language subtitle failure.
3. Add a regression test that exercises an alternate-language VTT URL proxied through `/watch/api/download` and asserts the browser-required response behavior.
4. Preserve existing same-language subtitle, transcript, opaque-download, account-gate, redirect, and SSRF behavior.

## Constraints

- Do not change Admin subtitle rows, GraphQL payload shape, subtitle preference persistence, audio routing, or language-picker product behavior.
- Do not weaken `/watch/api/download` URL allowlisting, DNS pre-flight, redirect validation, timeout, response-media validation, or account gating.
- Do not re-enable Mux-generated subtitle tracks as Forge subtitle choices.
- Do not hand-edit generated GraphQL outputs.

## Verification

- `pnpm --filter @forge/web test -- src/app/api/download/route.test.ts`
- Run the focused Watch player/client tests covering Forge subtitle selection and overlay behavior.
- In Chromium and Firefox, select Chinese Simplified on `/watch/jesus.html/mandarin-china.html`, verify the Forge track reaches `readyState=2` with cues, and confirm cues render at matching timestamps.
- Confirm the changed frontend/media path does not regress Watch page-loading performance.

## Completion

- Root cause: the same-origin subtitle endpoint redirected the native `<track>` request to a cross-origin VTT response whose upstream server did not provide CORS permission.
- Restored same-origin streaming only for auth-exempt, allowlisted, inline `.vtt` requests. Normal media downloads still redirect.
- Retained DNS pre-flight, manual redirect rejection, `text/vtt` validation, bounded request/body streaming, and credential isolation.
- Verified the real Chinese Simplified VTT through the local Watch route: HTTP 200, `text/vtt`, inline disposition, 92,159 bytes, and `WEBVTT` content.
- Focused Watch regression suite: 170 passed, 1 todo. Web typecheck and lint pass.
- Production Chromium/Firefox cue verification remains a post-deploy check because the production route still serves the pre-fix redirect behavior until this change ships.
