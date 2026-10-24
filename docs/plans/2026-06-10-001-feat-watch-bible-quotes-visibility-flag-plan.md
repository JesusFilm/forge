---
title: "Watch Bible Quotes Visibility Flag Plan"
type: "feat"
status: "complete"
date: "2026-06-10"
---

# Watch Bible Quotes Visibility Flag Plan

## Summary

Add a default-off LaunchDarkly watch-page flag that can hide the entire Bible
Quotes band on web watch pages while preserving the existing behavior when the
flag is off.

---

## Problem Frame

The web watch page already has `forge.watch.youVersionBibleQuotes`, but that
flag only controls the YouVersion-backed passage panel and API fetch. Operators
need a separate visibility switch that removes the whole Bible Quotes band from
video watch pages, including the heading, quote cards, always-on promo card, and
section-local share entry point.

---

## Requirements

**Flag behavior**

- R1. Add a new temporary boolean LaunchDarkly flag, defaulting off, for the
  watch-page Bible Quotes band visibility.
- R2. When the new flag is off, watch pages continue to render the Bible Quotes
  band exactly as they do today.
- R3. When the new flag is on, watch pages omit the entire Bible Quotes band,
  including the quote cards, promo card, and share button rendered in that
  section header.

**Scope boundaries**

- R4. Keep `forge.watch.youVersionBibleQuotes` focused on YouVersion passage
  fetching and rendering; do not reuse it as a section visibility flag.
- R5. Keep the new flag scoped to the synthetic watch-page Bible Quotes slot;
  do not hide generic Experience-page `BibleQuotesCarousel` sections outside
  the watch-page surface.
- R6. Preserve server-side LaunchDarkly evaluation and local fallback behavior
  when `LAUNCHDARKLY_SDK_KEY` is absent.

**Operations and documentation**

- R7. Document the new flag key, local fallback env var, default state, and
  intended rollout behavior in the web guide and env example.
- R8. Keep the roadmap feature status aligned with implementation progress.

---

## Key Technical Decisions

- KTD1. New flag instead of extending the YouVersion flag: the existing flag
  controls API-backed passage enrichment, while this work controls section
  visibility.
- KTD2. Hide at the watch-block render boundary: the `BibleQuotes` slot should
  still be representable in merged watch content, but rendering can skip it
  when the visibility flag is active.
- KTD3. Server-evaluate and pass plain state down: this follows the existing
  Forge LaunchDarkly pattern and keeps SDK keys out of browser bundles.
- KTD4. Use a negative local fallback name that matches operator intent:
  `FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT=false` preserves current behavior and
  reads naturally when flipped for smoke tests.

---

## Implementation Units

### U1. Register the watch visibility flag

- **Goal:** Add the shared flag definition and web helper path for the new
  default-off boolean.
- **Files:**
  - `packages/feature-flags/src/registry.ts`
  - `apps/web/src/env.ts`
  - `apps/web/src/lib/feature-flags.ts`
  - `apps/web/.env.example`
  - `apps/web/CLAUDE.md`
- **Patterns:** Follow `forge.watch.questionPanel` and
  `forge.watch.youVersionBibleQuotes` for registry, fallback env, helper, and
  docs shape.
- **Test Scenarios:**
  - Flag defaults to `false` when LaunchDarkly and local fallback env are both
    absent.
  - `FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT=true` makes the helper resolve
    `true`.
  - The shared feature flag client receives the new local fallback and
    `false` default value.
- **Verification:**
  - `pnpm --filter @forge/web test -- src/lib/feature-flags.test.ts`

### U2. Gate the watch-page Bible Quotes band

- **Goal:** Evaluate the new flag on watch routes and skip rendering the
  synthetic Bible Quotes band when it is enabled.
- **Files:**
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
  - `apps/web/src/components/watch/WatchPageClient.tsx`
  - `apps/web/src/components/watch/WatchSectionRenderer.tsx`
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
  - `apps/web/src/components/watch/__tests__/WatchSectionRenderer.test.tsx`
- **Patterns:** Mirror the question panel flag threading from route to client
  and the existing `BibleQuotes` switch branch in `WatchSectionRenderer`.
- **Test Scenarios:**
  - Feature-film watch route calls the new flag helper with the route context.
  - Flag-off route props still include the `BibleQuotes` block.
  - Flag-on route props communicate that Bible Quotes should be hidden.
  - Renderer skips the `BibleQuotesSection` when the hide flag is active.
  - Renderer still leaves generic Experience-page quote carousel behavior
    untouched because this gate applies only to the synthetic watch renderer.
- **Verification:**
  - `pnpm --filter @forge/web test -- 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' src/components/watch/__tests__/WatchSectionRenderer.test.tsx`

### U3. Roadmap and rollout proof

- **Goal:** Keep project tracking and LaunchDarkly operational notes aligned
  with the code change.
- **Files:**
  - `docs/roadmap/platform/feat-169-watch-bible-quotes-visibility-flag.md`
  - `docs/plans/2026-06-10-001-feat-watch-bible-quotes-visibility-flag-plan.md`
- **Patterns:** Follow `docs/roadmap/platform/feat-145-watch-question-panel-flag.md`
  for a small watch-page LaunchDarkly gate.
- **Test Scenarios:**
  - Roadmap ticket starts `in-progress` before implementation and flips
    `complete` after validation.
  - PR notes include the LaunchDarkly key, fallback env var, default targeting
    behavior, and local validation evidence.
- **Verification:**
  - `git diff --check`

---

## Scope Boundaries

- The new flag does not replace or change `forge.watch.youVersionBibleQuotes`.
- The new flag does not globally hide every CMS-authored
  `BibleQuotesCarouselBlock`.
- The change does not redesign Bible Quotes cards, copy, carousel behavior, or
  share modal behavior.
- Creating or enabling the live LaunchDarkly flag in production requires
  LaunchDarkly MCP access and should keep targeting off by default.

---

## Risks & Dependencies

- The section-local share button disappears with the hidden band. This is part
  of the requested scope, but browser proof should verify the page still has no
  broken layout gap.
- Detached worktree state must be moved onto a normal branch before committing.
- LaunchDarkly remote flag creation may be blocked by unavailable MCP/OAuth
  access. Code must still be safe with local fallback defaults.

---

## Sources / Research

- `apps/web/CLAUDE.md` documents server-side LaunchDarkly conventions and the
  existing YouVersion flag behavior.
- `packages/feature-flags/src/registry.ts` contains the shared flag registry.
- `apps/web/src/lib/feature-flags.ts` contains the web server-side flag helper
  pattern.
- `apps/web/src/lib/content.ts` currently always builds a `BibleQuotes` watch
  block.
- `apps/web/src/components/watch/WatchSectionRenderer.tsx` renders the
  `BibleQuotes` synthetic block.
- `docs/roadmap/platform/feat-145-watch-question-panel-flag.md` is the closest
  completed roadmap pattern.
