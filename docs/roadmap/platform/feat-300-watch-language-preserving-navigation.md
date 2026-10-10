---
id: "feat-300"
title: "Watch language-preserving navigation"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on:
  - "feat-260"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "navigation"
  - "language-picker"
  - "i18n"
---

## Problem

On a localized Watch video or episode, the compact floating-header logo links
to bare `/watch`. Following it drops the public audio-language slug and returns
the viewer to the default English Watch home. The page language modal also
links “See all languages” to the unlocalized language index.

The reported production route
`/watch/jesus.html/women-disciples/hindi.html` already preserves Hindi in its
chapter links, so the repair belongs at the remaining language-dropping link
emitters rather than in global navigation interception.

## Entry Points - Read These First

1. `docs/plans/2026-07-23-001-fix-watch-language-preserving-links-plan.md` -
   implementation scope, route boundaries, and verification scenarios.
2. `apps/web/src/components/FloatingSearchProvider.tsx` - shared header,
   parsed route language, and compact Watch-home logo link.
3. `apps/web/src/components/watch/LanguagePickerModal.tsx` - page-specific
   language picker and Watch catalog links.
4. `apps/web/src/lib/routes.ts` - public audio-language route builders.
5. `apps/web/src/lib/watch-language-switcher.ts` - validated language-bearing
   utility-route precedent.
6. `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md`
   - public Watch URL contract.

## What To Build

1. Link the compact header logo on non-English inner Watch routes to
   `/{language}.html`.
2. Link the page language modal’s “See all languages” action to
   `/{language}.html/languages` when a non-English language is applied.
3. Preserve the existing default-English aliases, malformed-slug fallback,
   contextual episode links, standalone canonical/share links, downloads, and
   links that intentionally leave Watch.
4. Derive hrefs from route language already available to the client components
   without loading additional data or adding client effects.

## Constraints

- Use public audio-language slugs, never internal UI catalog keys.
- Use the builders in `apps/web/src/lib/routes.ts`.
- Keep the full home-page ministry logo’s external destination unchanged.
- Do not change canonical metadata, share URLs, or the contextual collection
  route shape.
- Do not import the broader locale map into the shared header client bundle.
- Do not overwrite unrelated worktree changes.

## Verification

- Focused `FloatingSearchProvider` tests cover Hindi, English/default, and
  malformed-language compact-logo destinations.
- Focused `LanguagePickerModal` tests cover Hindi and English/default
  “See all languages” destinations.
- Existing contextual chapter-navigation coverage remains green.
- Web typecheck, lint, formatting, and relevant CI-sensitive checks pass.
- Browser smoke starts on the reported Hindi contextual episode and proves the
  repaired Watch home and language-index links retain Hindi without degrading
  page loading.

## Completion Evidence

- `pnpm --filter @forge/web exec vitest run
src/components/__tests__/FloatingSearchProvider.test.tsx
src/components/watch/__tests__/LanguagePickerModal.test.tsx` passed 114
  tests. The Hindi assertions failed before the implementation and passed
  afterward.
- `pnpm --filter @forge/web typecheck`, the full Web lint suite, touched-file
  Prettier checks, and `git diff --check` passed.
- A local browser smoke on
  `/watch/jesus.html/women-disciples/hindi.html` rendered the Hindi experience
  with `lang="hi"` and verified:
  - the compact header logo emitted `/watch/hindi.html` and navigated there;
  - existing chapter links retained their contextual `/hindi.html` suffix;
  - “All languages” emitted `/watch/hindi.html/languages` and navigated to a
    Hindi language directory with `lang="hi"`;
  - the browser console contained no errors.
- The reused local Admin snapshot returned 503 for the optional Watch route
  manifest endpoint, so the Watch-home content itself showed its existing
  error fallback after the correct localized navigation. The destination URL,
  route language, video page, modal, and language-directory flow were all
  verified independently.
- The change only derives hrefs from existing pathname and applied-language
  values. It adds no request, effect, media initialization, or page-loading
  work.
