---
id: "feat-361"
title: "Recover unavailable-language Watch search results"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-08-13"
duration: 4
depends_on: []
blocks: []
tags:
  - "watch"
  - "search"
  - "i18n"
  - "web"
  - "seo"
---

## Problem

Admin can correctly return a relevant Watch search result as `UNAVAILABLE` when the selected language has no playable audio or subtitle action. Web currently fills the result's null action language with the resolved search language and builds a public playback-shaped URL. Exact route admission rejects that nonexistent content-and-audio pair, so the viewer reaches the generic Watch 404.

The failure applies to every Watch language. PR #1867 fixed the separate `TARGET_SUBTITLE` case by keeping requested subtitle language distinct from playable audio language; this work must preserve that contract.

## Entry Points - Read These First

1. `docs/plans/2026-08-13-001-fix-watch-search-unavailable-language-recovery-plan.md` — product, technical, risk, and verification contracts.
2. `apps/web/src/lib/watch-search-client.ts` — browser-direct search mapping that currently fills the unavailable language.
3. `apps/web/src/components/search/VideoCard.tsx` — search destination and Next.js prefetch behavior.
4. `apps/web/src/lib/watch-route-manifest.ts` — exact content-and-audio admission data.
5. `apps/web/src/proxy.ts` — public route classification and fixed not-found sentinel.
6. `apps/web/src/app/[locale]/[htmlLang]/404/page.tsx` — current statusless-rewrite-to-`notFound()` precedent.
7. `docs/solutions/logic-errors/watch-search-subtitle-playback-contract.md` — availability, action, and evidence language separation.
8. `docs/solutions/integration-issues/nextjs-proxy-not-found-sentinel-preserves-app-router-navigation.md` — final 404 and soft-navigation contract.

## Grep These

- `withResolvedLanguageSlug`
- `availabilityKind === "target_subtitle"`
- `isWatchRouteAdmittedByManifest`
- `buildNotFound`
- `WATCH_INTERNAL_REWRITE_HEADER`
- `sessionStorage`
- `GLOBAL_CLIENT_MESSAGE_NAMESPACES`

## What To Build

1. Keep unavailable search results visible while preserving null playable/action language identity in all Web mappings.
2. Carry the requested recovery language separately and build an explicit unavailable-result destination.
3. Store only a bounded, query-free recovery snapshot that remains readable for five minutes within the originating tab, including after refresh.
4. Classify a specialized recovery only when the exact route manifest proves that content exists and the requested audio language does not.
5. Rewrite verified gaps through a second fixed, statusless App Router sentinel whose nearest not-found boundary renders the localized recovery experience.
6. Replace same-search related cards with an initially unselected Watch-style selector containing only directly admitted audio versions of the same video.
7. Remove the standalone English and choose-language actions; hide the selector when no version exists, while preserving browse-current-language and contextual back exits.
8. Keep recovery storage target-only with no same-search candidate results, and exclude subtitle-only languages from the selector.
9. Reuse the Watch cinematic design, omit the oversized generic `404`, and support desktop, phone, keyboard, CJK, RTL, and Latin layouts.
10. Record local final-status, SEO-head, route, network, performance, and Chrome evidence before review or PR work.

## Constraints

- Do not change Admin GraphQL, search ranking, result relevance, or availability classification.
- Do not replace null action language with the selected search language.
- Do not weaken public audio-route admission, preselect a fallback language, or automatically redirect to English.
- Do not restore query-driven Watch search URLs or store the exact query, snippets, evidence, hrefs, playback URLs, or analytics identifiers.
- Keep ordinary unknown and malformed routes on the existing generic 404.
- Keep proxy rewrites statusless; the fixed sentinel must produce the final not-found response through `notFound()` before streaming.
- Do not add per-content internal route keys or request-time APIs to the static Watch route tree.
- Do not commit, push, open a PR, deploy, verify production, or communicate through Slack before local user approval.

## Verification

- Focused Web tests cover unavailable null identity, target-audio, PR #1867 target-subtitle, target-only five-minute storage reuse, exact manifest classification, specialized versus ordinary 404, same-video audio filtering, explicit selection, zero-option hiding, and context-free fallback.
- A production-mode local HTTP probe returns the specialized body with final not-found status and `noindex`, while unknown routes retain the ordinary body.
- Recovery pages emit no canonical video metadata, video structured data, sitemap entry, or hreflang page-head graph.
- Browser network evidence shows no unavailable-link or selector-destination prefetch, no Mux preview, one bounded language-options action, and no new request on ordinary 404.
- UI catalog, provenance, typecheck, lint, build, desktop/phone, keyboard, CJK, RTL, and Latin checks pass.
