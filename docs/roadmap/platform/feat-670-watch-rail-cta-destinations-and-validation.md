---
id: "feat-670"
title: "Watch rail CTA destinations and validation"
owner: "vlad"
priority: "P2"
status: "complete"
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
   detect self-links, resolve a bare root link to the page language's home,
   and select a truthful fallback.
3. `apps/admin/src/services/experience.service.ts` —
   `assertNoNewVagueMediaCollectionCtaLabels` rejects a vague label that a
   create or draft save adds.
4. `apps/admin/src/domain/blocks.ts` — `MediaCollectionBlockSchema.ctaLabel`
   stays a plain optional string so stored blocks keep parsing.
5. `packages/watch-url-policy/src/media-collection-cta.ts` — shared vague-label
   predicate used by Admin and Web.
6. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` and
   `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — pass the current
   public path through nested section renderers.

## Grep These

- `mediaCtaLabel`
- `mediaCtaLink`
- `isSameWatchPage`
- `resolveMediaCollectionCta`
- `languageHomeHref`
- `assertNoNewVagueMediaCollectionCtaLabels`
- `ExperienceVagueMediaCollectionCtaLabelError`

## What To Build

1. Normalize current and target Watch paths before comparing them; ignore
   query/hash and canonicalize explicit English routes.
2. Skip a CTA that returns to its current page and fall back to the active
   language video inventory (`/watch/{language}.html/videos`).
3. Resolve a bare relative root link (`/`, `/watch`) to the page language's
   home, so a translated home treats it as a self-link and a translated content
   page keeps the viewer in their language. Absolute URLs stay as authored.
4. Route a “Watch the Full Story” CTA to the first item when the authored
   target points elsewhere.
5. Name the destination with existing translated messages only:
   `WatchHome.showVideo` ("Show {title}") for a collection or authored link,
   `See all languages` for the language directory, and
   `See all videos in {language}` for the inventory. Keep any non-vague
   authored label, including on a language-directory link.
6. Reject a vague label (`Watch`, `See all`, `View all`, `Read more`, `More`)
   that a write adds. A vague label already stored with the same link may stay
   so editors can save unrelated changes; reads, duplication, previews and
   revision snapshots keep parsing it.
7. Remove generic CTA defaults from new Admin MediaCollection templates.

## Constraints

- Preserve non-vague editor-authored labels and valid destinations.
- Do not tighten the shared `BlockSchema`: it also parses stored drafts,
  revisions, duplicates and dashboard previews.
- Do not add untranslated text to locale catalogs or mark user-facing CTA copy
  locale-neutral. A dedicated "Open {title}" message is a follow-up for the
  next locale batch, not this change.
- Do not hand-edit generated GraphQL outputs. The Admin Pothos schema is not
  changed.
- Keep navigation within existing route helpers and the shared package; do not
  introduce cross-app imports.

## Known Limits

- The full-story reroute matches the English label “Watch the Full Story” and
  trusts that the rail's first card is the full-length item. Translated labels
  keep their authored link.
- The vague-label list is English only.
- The self-link fallback is the language video inventory, not a films index.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx src/lib/media-collection-cta.test.ts`
- `pnpm --filter @forge/admin exec vitest run src/services/experience.service.test.ts src/domain/blocks.test.ts src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
- `pnpm --filter @forge/watch-url-policy exec vitest run src/media-collection-cta.test.ts`
- Web, Admin, and watch-url-policy lint/typecheck; root format check.
- Confirm no CTA whose normalized href equals the current public route is
  rendered, and fallback labels resolve through existing translated messages.
