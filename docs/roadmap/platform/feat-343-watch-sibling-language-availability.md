---
id: "feat-343"
title: "Watch sibling selected-language availability"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "watch"
  - "routing"
  - "seo"
---

## Problem

Watch sibling carousels can advertise a contextual video URL even when that child has no playable
variant in the route's selected language. The query returns the child relationship and slug, so the
client builds a link, but the exact destination correctly resolves to the native Watch 404 page.
This creates user-visible dead navigation and exposes the same unavailable sibling in related-item
structured data.

The server already has a cached Watch route manifest containing exact parent/child/language
admission. The child's `muxPlaybackId` cannot prove availability because Admin may fall back to a
different language's playable variant.

## Entry Points — Read These First

1. `docs/plans/2026-08-10-001-fix-watch-sibling-language-availability-plan.md` — scoped
   implementation and verification plan.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — route-manifest admission and
   the standalone/contextual render paths.
3. `apps/web/src/components/watch/SiblingCarousel.tsx` — consumes the filtered model and builds
   contextual hrefs using the selected language.
4. `apps/web/src/lib/watch-structured-data.ts` — related-item JSON-LD consumes the same block.
5. `apps/web/src/lib/watch-route-manifest.ts` — exact selected-language route admission.

## Grep These

- `selectableParentsForStandaloneVideo` — existing exact standalone parent filtering.
- `isWatchRouteAdmittedByManifest` — authoritative parent/child/language admission.
- `canonicalParent.children` — downstream carousel and structured-data consumers.
- `muxPlaybackId(languageSlug` — playback metadata whose fallback behavior must not be used as route proof.
- `getRoutableCarouselChildren` — the current client-side slug-only guard.

## What To Build

- Filter each candidate carousel parent to children admitted by the route manifest for the exact
  parent slug, child slug, and selected audio-language slug before constructing the carousel.
- Preserve child order, parent identity, current-video state, contextual routes, and the existing
  source priority: eligible selectable parents, then own children, then canonical-parent siblings.
- Keep only selectable parents with at least two playable children; continue through the existing
  fallback order when none remain.
- Return no carousel when every source has fewer than two admitted children.
- Preserve fail-open behavior when the manifest is unavailable.
- Add focused regression tests for contextual and standalone sources, including a child with a
  non-empty fallback playback ID but no selected-language route.

## Constraints

- Do not add redirects: an unavailable selected-language variant has no equivalent working target.
- Do not fall back to another language or substitute another video.
- Do not change Admin data, GraphQL schema, generated types, route-manifest generation, or proxy behavior.
- Do not add a client-side availability request.
- Keep related-item structured data aligned by filtering the shared block before both consumers.

## Verification

- Focused page-routing, content-builder, renderer, and structured-data tests.
- Web-scope typecheck, lint, and format checks.
- Browser smoke on a representative affected Watch route: unavailable sibling absent, retained
  sibling navigates successfully, no new console/network errors.
- Capture a screenshot and confirm the render-model change adds no browser request or page-loading
  regression.
