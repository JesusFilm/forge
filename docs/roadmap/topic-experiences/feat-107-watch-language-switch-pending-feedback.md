---
id: "feat-107"
title: "Watch Language Switch Pending Feedback"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-06-13"
duration: 2
depends_on:
  - "feat-047"
blocks:
  - "feat-191"
tags:
  - "web"
  - "watch"
  - "ux"
  - "performance"
---

## Problem

Changing the audio language on Watch can take several seconds on a cold per-language route, especially when the destination page needs fresh server rendering. Today the language modal closes immediately after Apply, leaving the old page visible with no pending feedback. Users can interpret the delay as a broken control.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguagePickerModal.tsx` - Apply handler, pending navigation guard, safety timeout, and Apply button state.
2. `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` - modal behavior tests for cookie writes, router navigation, duplicate-submit guard, and timeout recovery.
3. `apps/web/src/components/watch/WatchPageClient.tsx` - client wrapper that owns modal open/close state and passes current route language props.
4. `apps/web/src/lib/routes.ts` - canonical Watch URL builder used by `router.push`.
5. `apps/web/src/app/[slug]/[...rest]/page.tsx` and `apps/web/src/lib/content.ts` - route/data path that explains why cold language transitions can be slow, but is out of scope for the first UX fix.

## Grep These

- `pendingNavTo|NAVIGATING_TIMEOUT_MS|handleApply|languageDirty|Switching` in `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `writePreferredLanguageSlug|router.push|onClose` in `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `watchVideoPath|router.prefetch` in `apps/web/src/`
- `resolveWatchPage|resolveWatchVideoBySlug|fetchWatchVideoBySlug` in `apps/web/src/lib/content.ts`

## What To Build

1. Keep the language modal open after Apply when the language selection is dirty.
   - Show the Apply button as `Switching...` with a spinner or equivalent progress affordance.
   - Disable duplicate submits while navigation is in flight.
   - Keep the existing safety timeout so the user is not trapped if the route never resolves.
   - Close immediately only for non-language-only modal changes that do not trigger a route transition.

2. Add selective target-route prefetching.
   - Prefetch the Watch route for the currently selected draft language when the user changes the language inside the modal.
   - Keep prefetch best-effort and client-only; failures should not block Apply.
   - Avoid prefetching unchanged languages, invalid slugs, or repeated identical targets.
   - Do not prefetch every available language.

3. Preserve the current route and preference contracts.
   - Keep the client cookie write before `router.push`.
   - Keep the canonical Watch URL builder as the only route construction path.
   - Keep subtitle-only changes behavior unchanged unless they share the final Apply button state.

## Constraints

- Do not change the admin GraphQL fragment or generated client types in this PR-sized slice.
- Do not solve the deeper cold-route data bottleneck here; document it as follow-up performance work.
- Do not introduce a new global loading overlay for the Watch page.
- Do not remove the navigation safety timeout.
- Keep modal copy short and local to the existing UI; the first visible fix is status, not education.

## Verification

- Focused unit test for dirty-language Apply:
  - modal stays open after Apply
  - Apply button changes to `Switching...`
  - duplicate submits are ignored while pending
  - modal closes or pending state clears when the destination language prop resolves
  - safety timeout clears pending state if the route does not resolve
- Focused unit test for selective prefetch:
  - prefetch runs for a changed valid target language
  - prefetch does not run for unchanged, invalid, or duplicate target paths
  - prefetch errors are swallowed
- `pnpm --filter web test -- LanguagePickerModal.test.tsx`
- `pnpm --filter web typecheck`
- Browser smoke with Helium:
  - open a Watch video route
  - open language modal
  - choose a different audio language
  - press Apply
  - confirm modal remains visible, Apply shows pending feedback, and duplicate clicks do not trigger repeated navigation
