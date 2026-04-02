---
date: 2026-03-31
topic: mobile-video-viewport-pause
---

# Pause Inline Videos When Scrolled Out of Viewport

## Problem Frame

In the mobile Expo app, inline `VideoRenderer` sections autoplay correctly when scrolled into view but continue playing when scrolled away. This wastes battery, bandwidth, and competes for hardware decoder slots. The root cause: `VideoRenderer` relies on `useSectionVisible()` from `LazySectionContext`, but when rendered outside a `LazySection` wrapper (e.g. via `SectionDispatcher`), the hook defaults to `visible: true` — so the video never pauses.

## Requirements

- R1. Inline video sections must pause when scrolled out of the viewport and resume when scrolled back in.
- R2. Video hero (`VideoHeroRenderer`) is excluded — it already manages its own scroll-based lifecycle and must not be affected.
- R3. The existing `LazySection` + `useSectionVisible()` pattern should be reused rather than introducing a new visibility mechanism.

## Success Criteria

- Inline videos pause within one frame of leaving the viewport and resume when re-entering.
- Video hero behavior is unchanged.
- No regression in scroll performance (no additional per-frame measurement overhead beyond what `LazySection` already does).

## Scope Boundaries

- **Not in scope:** Video hero changes, new visibility APIs, preloading/prefetching strategies, controls UI changes.
- **Not in scope:** Videos inside deeply nested content dispatchers (e.g. Container → ContentDispatcher → VideoRenderer) — if these are not currently wrapped, they can be addressed as a follow-up.

## Key Decisions

- Reuse `LazySection` wrapping rather than adding standalone visibility detection to `VideoRenderer` — keeps a single visibility pattern across the app.

## Deferred to Planning

- [Affects R1][Needs research] Determine exactly which render paths produce `VideoRenderer` without a `LazySection` ancestor and where to add the wrapping.
- [Affects R1][Technical] Decide whether to wrap at the `SectionDispatcher` level (for all top-level video sections) or closer to the scroll container.

## Next Steps

→ `/ce:plan` for structured implementation planning
