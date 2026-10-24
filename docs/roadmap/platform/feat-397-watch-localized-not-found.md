---
id: "feat-397"
title: "Preserve Watch locale on true not-found pages"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-08-18"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "i18n"
  - "seo"
---

## Problem

When a structurally valid Watch URL names a recognized public language but the
content does not exist, Proxy discards the resolved locale and rewrites every
miss to the English `/en/en/404` sentinel. The original URL, final HTTP 404,
and `noindex` are correct, but the visible error page does not retain the
viewer's language.

The localized ordinary 404 must remain a bounded, server-rendered failure path.
It must not adopt the client-side recovery lookup used when known content is
missing only the requested playable language.

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` — `buildNotFound()`, manifest admission, and marked
   internal rewrite re-entry.
2. `apps/web/src/proxy.test.ts` — ordinary 404, unavailable-language sentinel,
   and internal-prefix security coverage.
3. `apps/web/src/app/[locale]/[htmlLang]/404/page.tsx` — fixed ordinary 404
   sentinel that supplies localized metadata and calls `notFound()`.
4. `apps/web/src/components/WatchNotFound.tsx` — server-rendered localized 404
   body with local artwork.
5. `docs/solutions/integration-issues/nextjs-proxy-not-found-sentinel-preserves-app-router-navigation.md`
   — fixed-sentinel, App Router, cache-cardinality, and SEO constraints.
6. `docs/roadmap/content-discovery/feat-361-watch-search-unavailable-language-recovery.md`
   — separate known-content/missing-language recovery contract.

## Grep These

- `buildNotFound`
- `WATCH_INTERNAL_REWRITE_HEADER`
- `isAdmittedInternalRewrite`
- `classifyManifestAdmission`
- `known-content-language-gap`
- `WatchNotFound`

## What To Build

1. Preserve the locale and HTML language already resolved from a valid public
   Watch language slug when manifest admission proves the content is unknown.
2. Keep a fixed `/404` internal suffix and admit its second Proxy pass only
   when the internal prefix is a valid locale and HTML-language pair resolving
   exactly to `/404`; do not carry the missing content slug into the sentinel.
3. Keep malformed paths and unrecognized language identities on the existing
   default-English fallback.
4. Cover Simplified Chinese, Russian, Arabic RTL, manifest-inconclusive misses,
   and forged internal rewrite claims.
5. Verify the first server response contains localized metadata/body without a
   client request, loading state, or content replacement.

## Constraints

- Preserve the original public URL, final HTTP 404, `noindex`, and lack of a
  canonical or video structured data.
- Do not admit arbitrary invalid paths to page resolution or create one
  internal route/cache key per missing content slug.
- Do not change the known-content/missing-language recovery page, search
  behavior, route manifest contract, translations, or valid Watch routes.
- Do not add a client component, API call, remote image, loading page, or new
  dependency to the ordinary 404 path.

## Verification

- `pnpm --filter @forge/web test -- src/proxy.test.ts src/components/WatchNotFound.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`
- Production-mode local HTTP checks for Chinese, Russian, Arabic, malformed,
  and known-language-gap URLs prove status, `noindex`, language, and body.
- Browser hard-navigation checks confirm localized copy is present on the
  first rendered response with no recovery-data request or visual replacement.
