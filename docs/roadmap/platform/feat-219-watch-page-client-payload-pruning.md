---
id: feat-219
title: Prune duplicated Watch page client payload graph
status: complete
lane: platform
depends_on:
  - feat-217
  - feat-218
blocks: []
---

## Problem

Production Web logs still show Next.js Data Cache warnings for Watch routes over
2 MB, including `/jesus.html/english.html`. The single-video route already
narrows variants, but it serializes the same `WatchVideoRecord` relation graph
through top-level props and multiple synthetic blocks.

## Scope

- Keep carousel children in the `SiblingCarousel` block where the UI reads them.
- Strip repeated `parents`, `children`, `childDubLanguages`, `studyQuestions`,
  and `bibleCitations` from client video props.
- Keep selected variant, subtitles, image, title, description, slug, and other
  fields used by the player, body, language picker, download, transcript, and
  share surfaces.

## Verification

1. `pnpm --filter @forge/web exec eslint src/app/[locale]/[htmlLang]/[...rest]/page.tsx src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
2. `pnpm --filter @forge/web test -- src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-metadata.test.tsx`
3. Production Web logs stop showing `Failed to set Next.js data cache` warnings
   for the common Watch routes after deployment.
