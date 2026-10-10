---
title: "Watch modals coordinate playback through shared activity ownership"
date: "2026-07-20"
category: ui-bugs
module: apps/web
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "A playing Watch video continued beneath search, language, question, feedback, quiz, or other modal surfaces"
  - "Pause and resume behavior varied by modal owner and player type because local coordinators covered only part of the Watch layout"
  - "Overlapping modal close transitions could restore playback before the final overlay released interaction"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - "Watch modal activity"
  - "Mux hero and carousel players"
  - "Authored inline video sections"
tags:
  - "watch"
  - "modal"
  - "video-playback"
  - "pause-resume"
  - "react-context"
  - "media-provenance"
  - "strictmode"
  - "browser-proof"
---

# Watch modals coordinate playback through shared activity ownership

## Problem

Watch playback pause behavior was fragmented across page-local and beta-modal
effects. Search, language, download, and share could pause one page player,
while question, feedback, beta-tester, quiz, series, authored inline, hero, and
carousel surfaces were inconsistently covered. Overlapping modal lifecycles
could also resume playback while another overlay still owned interaction.

## Symptoms

- Video continued playing beneath some Watch overlays.
- Closing one of two overlapping modals could resume playback too early.
- Media attached while a lazy modal was already open could begin playing.
- Replacing a player or changing its source during modal activity could grant
  stale resume permission.
- Autoplay or source-change logic could restart playback beneath an open modal.
- A video manually paused before opening a modal could be restarted on close.

## What Didn't Work

The original `WatchPageClient` effect observed floating search plus its three
local modal states and coordinated only the primary page player. A separate
beta-tester hook repeated similar logic for the hero and home carousel.
Independent effects could not see every modal owner or make one safe resume
decision when owners overlapped.

Registering only mounted dialog content was also too late for lazy feedback and
beta chunks. Playback must pause when open intent begins, before dialog content
loads. Tracking only the DOM media element was insufficient too: Mux and
authored players can reuse one element for a different source.

## Solution

Wrap the Watch layout in one activity provider and let each modal owner acquire
a private token:

```tsx
;<WatchModalActivityProvider>
  <FloatingSearchProvider>{children}</FloatingSearchProvider>
</WatchModalActivityProvider>

useWatchModalActivity(open)
```

The registry holds a `Set<symbol>`, so activity remains true until the final
owner releases. Its default release waits through the visible close transition.
Floating search uses its existing `open || closing` lifecycle with no second
delay.

Players use the shared pause hook with both element and playback-source
identity:

```tsx
usePauseForWatchModal(player, playbackId ?? hlsSrc ?? null)

const { media, mediaRef, setMediaRef } =
  useWatchModalMediaRef<HTMLVideoElement>(src)
```

Resume entitlement is captured only on the first inactive-to-active edge and
only for media that was already playing in the last fully inactive commit:

```tsx
shouldResumeRef.current =
  media != null &&
  media === inactiveMediaRef.current &&
  playbackIdentity === inactiveIdentityRef.current &&
  !media.paused
```

On close, playback resumes only if both identities still match. Media that
appears or changes during activity is paused but receives no entitlement. A
`play` listener immediately re-pauses autoplay attempts while activity remains
active. Reactive callback refs keep authored `Video`, `VideoHero`, and
`CarouselVideo` subscriptions aligned with their actual media elements.

## Why This Works

Modal activity is aggregate ownership rather than a collection of unrelated
booleans. Releasing search cannot resume playback while language, feedback, or
another dialog still owns a token.

Resume behavior is provenance-based. The system remembers exactly which media
element and source were playing before the first overlay opened. Late
attachments, element replacement, same-element source swaps, and route changes
revoke that provenance instead of transferring it to new content. Consulting
the synchronous token registry also prevents a media replacement batched with
modal opening from inheriting stale entitlement before React publishes the
aggregate state update.

Browser verification on the local `Easter Explained` route confirmed that the
playing Mux video paused under both floating search and the language dialog,
then resumed after each close transition. Resource timing placed the first Mux
stream request at about 8667 ms, after `DOMContentLoaded` at 157 ms and `load`
at 248 ms, so the coordination did not move media work onto initial page load.

## Prevention

- Every new Watch overlay should call `useWatchModalActivity(open)` at the
  authoritative state owner, including lazy-loading fallbacks.
- Every new Watch media surface should use `usePauseForWatchModal(media,
stablePlaybackIdentity)` or the reactive callback-ref wrapper.
- Do not add modal-specific pause effects or resume a player from dialog
  content.
- Preserve regression coverage for overlapping tokens, pre-paused media, late
  attachment, element and source replacement, same-commit modal/media changes,
  active `play` attempts, close-delay cancellation, StrictMode replay, and
  rejected `play()` promises.
- Pair browser pause/resume smoke with navigation and resource timing whenever
  modal coordination or player initialization changes.

## Related Issues

- [Base UI dialog lifecycle verification](../best-practices/base-ui-dialog-state-attribute-detection-20260520.md)
- [Watch search modal close reset](watch-search-modal-close-reset.md)
- [Watch Home inline Mux takeover player](../best-practices/watch-home-inline-mux-takeover-player-pattern-20260706.md)
- [Mux Player with custom React chrome](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md)
- [React StrictMode remount safety](../logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md)
- [Frontend page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md)
