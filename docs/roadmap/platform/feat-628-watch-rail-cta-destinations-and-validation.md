---
id: "feat-628"
title: "Watch rail CTA destinations and validation"
owner: "vlad"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "admin"
  - "watch-page"
  - "navigation"
---

## Problem

Linear FGE-232 found Watch media collection CTAs that lead back to the current
page, promise a full story but open an episode, use vague labels, or are absent.
The completed feat-262 added default collection inference but did not guard
authored self-links or verify that each label describes its actual destination.

## Entry Points — Read These First

1. `apps/web/src/components/sections/MediaCollection.tsx` — resolve renderable
   destinations and localized labels for authored rails.
2. `apps/web/src/lib/media-collection-cta.ts` — canonicalize Watch paths,
   detect self-links, and select a truthful fallback.
3. `apps/admin/src/domain/blocks.ts` — reject destination-less CTA labels in
   new or edited MediaCollection blocks.
4. `packages/watch-url-policy/src/media-collection-cta.ts` — shared label
   validation used by Admin and Web.
5. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` and
   `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — pass the current
   public path through nested section renderers.

## Grep These

- `mediaCtaLabel`
- `mediaCtaLink`
- `isSameWatchPage`
- `resolveMediaCollectionCta`
- `Watch the Full Story`

## What To Build

1. Normalize current and target Watch paths before comparing them; ignore
   query/hash and canonicalize explicit English routes.
2. Skip a CTA that returns to its current page and fall back to the active
   language video inventory.
3. Route a “Watch the Full Story” CTA to the first playable full-length item
   when the authored target points to an episode.
4. Use existing localized Watch and LanguagePickerModal messages for fallback
   labels. Keep language-directory destinations labelled as language links.
5. Reject vague labels such as `Watch`, `See all`, `View all`, `Read more`, and
   `More` at the Admin block-validation boundary; replace stale stored labels
   with destination-specific copy when rendering.
6. Remove generic CTA defaults from new Admin MediaCollection templates.

## Constraints

- Preserve non-vague editor-authored labels and valid destinations.
- Do not add untranslated text to locale catalogs or mark user-facing CTA copy
  locale-neutral.
- Do not hand-edit generated GraphQL outputs. The Admin Pothos schema is not
  changed by this block validation.
- Keep navigation within existing route helpers and the shared package; do not
  introduce cross-app imports.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx src/lib/media-collection-cta.test.ts`
- `pnpm --filter @forge/admin exec vitest run src/domain/blocks.test.ts src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
- `pnpm --filter @forge/watch-url-policy exec vitest run src/media-collection-cta.test.ts`
- Web, Admin, and watch-url-policy lint/typecheck; root format check.
- Confirm no CTA whose normalized href equals the current public route is
  rendered, and fallback labels resolve through existing translated messages.
