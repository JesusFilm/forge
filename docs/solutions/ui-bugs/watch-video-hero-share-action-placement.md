---
title: "Watch Share action renders on individual video hero, not Watch home"
date: "2026-07-14"
category: "docs/solutions/ui-bugs"
module: "apps/web watch"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "The Watch home carousel rendered a Share action while individual Watch video heroes did not render Share beside Watch now."
root_cause: "scope_issue"
resolution_type: "code_fix"
severity: "low"
related_components:
  - "apps/web/src/components/home/WatchHomeTvCarousel.tsx"
  - "apps/web/src/components/watch/HeroPlayer.tsx"
  - "apps/web/src/components/watch/WatchSectionRenderer.tsx"
  - "apps/web/src/components/watch/WatchPageClient.tsx"
tags:
  - "watch"
  - "share"
  - "video-hero"
  - "watch-home"
  - "modal"
---

# Watch Share action renders on individual video hero, not Watch home

## Problem

The requested Share action belongs beside the pre-reveal **Watch now** control
on individual Watch video pages. It was instead added to the Watch home
carousel, leaving the individual page without a Share action and giving home a
second modal owner.

## Symptoms

- Individual video heroes had no Share action next to **Watch now**.
- Watch home rendered a Share button and managed Share modal state for carousel
  slides.
- The secondary action was outlined instead of the requested text treatment.

## What Didn't Work

Putting Share in `WatchHomeTvCarousel` coupled a page-level action to transient
carousel state: the carousel owned a lazy modal, autoplay locking, playback
pause/resume, and share identity fields. Mounting another `ShareModal` directly
inside `HeroPlayer` would have duplicated the individual page's canonical URL
and playback-lifecycle owner.

## Solution

Keep placement in the hero and behavior in the page client. `HeroPlayer`
accepts an optional callback and renders a borderless text button only in its
pre-reveal action row:

```tsx
{
  onShareClick ? (
    <button
      type="button"
      data-testid="hero-player-share-button"
      onClick={onShareClick}
      className="... text-white/90 ... hover:underline ..."
    >
      {tBibleQuotes("share")}
    </button>
  ) : null
}
```

`WatchSectionRenderer` forwards `modalCallbacks?.openShare` to that callback.
`WatchPageClient` remains the one owner of the lazy `ShareModal`, canonical
video and language slugs, and player pause/resume behavior. The home-carousel
Share import, state, callbacks, and share-specific model fields were removed.

## Why This Works

The hero owns where the action appears, but not the identity or lifecycle of
the modal it opens. The page client already has authoritative current-video
data and safely coordinates modal state with playback, so a callback boundary
preserves one source of truth. Rendering the action only before player chrome
appears also keeps it out of the revealed player and entirely off Watch home.

## Prevention

- Keep Share modal state and current-content identity in `WatchPageClient`;
  display components receive callbacks rather than mounting another modal.
- Cover the component boundary: hero layout/callback and post-reveal removal,
  renderer callback forwarding, page modal identity and playback restoration,
  and the absence of Share on Watch home.
- Browser-smoke an individual Watch route to verify the text action is beside
  **Watch now** and opens the existing Share modal.

## Related

- [Watch Home inline Mux takeover player pattern](../best-practices/watch-home-inline-mux-takeover-player-pattern-20260706.md)
  remains the home-carousel pattern; it intentionally does not own page Share
  behavior.
- [Next.js route-shape migration contract drift](../best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md)
  covers the canonical Share URL contract retained by `WatchPageClient` and
  `ShareModal`.
