---
id: "feat-777"
title: "Keep Watch films playable where crypto.randomUUID is missing"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
---

## Problem

`crypto.randomUUID()` only exists in a secure context and in Firefox 95 or
later. The Watch film page called it during render in four places
(`getViewerId`, `WatchExposureBoundary` window, attempt and event ids, and the
`WatchSemanticRecommendations` visit id). Where it is missing, the call throws
and the route error boundary replaces the film with "Failed to load
experience". `getViewerId` even called it again in its `catch` fallback.

Field evidence (Datadog RUM, 30 days to 2026-10-20): 4 views, 1 session,
Firefox 93 on `/watch/jesus.html`. The field impact is small. The same crash
blocks every plain-HTTP preview (for example a tailnet origin), which is not a
secure context. Found in the 2026-10-20 website audit follow-up, round 01.

## Entry Points — Read These First

1. `apps/web/src/lib/random-uuid.ts` — the shared v4 UUID helper.
2. `apps/web/src/lib/viewer-id.ts` — the Mux Data viewer label.
3. `apps/web/src/components/recommendations/WatchExposureBoundary.tsx` and
   `WatchSemanticRecommendations.tsx` — ids the recommendation routes
   validate with `z.string().uuid()`.

## Grep These

- `crypto.randomUUID` under `apps/web/src` (client code should call
  `randomUuid()` instead)
- `randomUuid`, `RandomUuidUnavailableError`

## What To Build

- `randomUuid()` uses `crypto.randomUUID()` when present, otherwise builds an
  RFC 9562 v4 UUID from `crypto.getRandomValues()`. That API is not secure-
  context gated and is the same CSPRNG, so ids keep 122 random bits and the
  routes' UUID validation. There is no `Math.random` fallback; with no
  cryptographic source it throws `RandomUuidUnavailableError`.
- `getViewerId()` is a non-secret analytics label: it fails open to `""` when
  no cryptographic source exists, and keeps one in-memory id per page when
  storage is blocked.
- The visit, window, attempt and event ids are unguessable correlation ids
  checked by the recommendation routes, so they never fall back to a weaker
  source.

## Constraints

- Do not change GA, Datadog RUM, Mux Data or recommendation policy.
- Do not use `Math.random` for any id the server treats as unguessable.
- Out of scope: the already guarded `Math.random` fallbacks in
  `FloatingSearchController` (search request id) and `whats-new-votes`
  (placement id), and the separate crash when `sessionStorage` throws.

## Verification

- `pnpm --filter @forge/web exec vitest run src/lib/random-uuid.test.ts src/lib/viewer-id.test.ts`
- `next start`, then load `/watch/jesus.html/english.html` over a plain-HTTP
  non-loopback origin in Chromium and Firefox: `isSecureContext` is false,
  `crypto.randomUUID` is undefined, the film renders and the viewer id is a
  v4 UUID.
