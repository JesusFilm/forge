---
id: "feat-708"
title: "Restore URL-only Watch language routing"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "localization"
  - "routing"
---

## Problem

Feat-645 made the bare Watch entry and utility routes select a language from
the `forge_watch_lang` cookie or the browser's `Accept-Language` header. This
allowed request state outside the URL to change the visible language. Watch's
public contract requires language to be driven only by its URL.

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` — public Watch path classification, redirects, and
   internal locale rewrites.
2. `apps/web/src/proxy.test.ts` — routing contract coverage.
3. `apps/web/next.config.mjs` — default `/watch` root rewrite.
4. `apps/web/CLAUDE.md` — canonical Web localization guidance.
5. `docs/roadmap/platform/feat-645-watch-language-preference-redirect.md` —
   superseded state-driven routing decision.
6. `docs/solutions/architecture-patterns/watch-language-routing-is-url-only.md`
   — durable decision history, including PR #1057, FGE-176, and PR #2658.

## Grep These

- `preferredPublicLanguageSlug`
- `isLanguageNegotiatedEntryPath`
- `forge_watch_lang`
- `Accept-Language`
- `Vary`

## What To Build

1. Remove cookie- and `Accept-Language`-driven redirects from the Watch proxy.
2. Restore the default English renderer for bare `/watch` entry routes without
   emitting language-state cache variation.
3. Preserve explicit localized URL handling, including language home,
   inventory, history, and What's New routes.
4. Remove end-to-end and matcher coverage that exists only for entry-language
   negotiation, and add a regression test proving language state cannot change
   the route.
5. Update Web guidance and retire feat-645.

## Constraints

- The public URL is the sole Watch language carrier.
- Do not remove explicit language URL segments or localized route support.
- Preserve unrelated canonicalization and `Accept-Language` parsing used by
  non-routing features.
- Do not change search-language preferences or subtitle preferences.
- Do not deploy directly to production; use the normal PR-to-main flow.

## Verification

- Run focused proxy and URL canonicalization tests.
- Run Web typecheck and scoped lint.
- Run Prettier on touched source, tests, and roadmap files.
- Confirm the bare root does not depend on route-manifest availability.

## Local Result

The Watch proxy no longer reads `forge_watch_lang` or `Accept-Language`, emits
language-state cache variation, or redirects bare entry routes into a language
URL. The config-level `/watch` rewrite again supplies the default English
renderer, while explicit localized URLs and URL-only utility routes remain
supported. The feature-specific root matcher and redirect E2E suite were
removed.

Focused proxy and canonicalization coverage passes (236 tests), including a
regression that supplies both a Japanese cookie and Japanese browser header to
all four former negotiation routes. Web typecheck, scoped Web ESLint, roadmap
lint, Prettier, and `git diff --check` pass. Removing request-state routing also
removes work from entry requests; rendering, hydration, media, and client-side
initialization are unchanged, so no page-load measurement is required.

The durable decision record explains why agents implemented feat-645: FGE-176
explicitly labeled the absence of cookie/header routing a site-wide bug and
prescribed the implementation, while neither the ticket nor PR #2658 linked
the contrary PR #1057/feat-315 decision. It also records that the work was
pushed immediately as a draft; the delay was a base-path matcher defect and
then an unreviewed wait, not agent reluctance to push.
