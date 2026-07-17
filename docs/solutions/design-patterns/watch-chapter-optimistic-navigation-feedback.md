---
title: Watch chapter carousel optimistic navigation feedback
date: 2026-06-11
category: docs/solutions/design-patterns
module: apps/web
problem_type: design_pattern
component: watch-page
severity: medium
related_components:
  - apps/web/src/components/watch/SiblingCarousel.tsx
  - apps/web/src/components/watch/HeroPlayer.tsx
  - apps/web/src/components/watch/WatchSectionRenderer.tsx
  - apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx
  - apps/web/src/lib/routes.ts
tags:
  - watch-page
  - sibling-carousel
  - chapter-navigation
  - hero-player
  - optimistic-ui
  - loading-state
  - next-link
  - react-compiler
  - browser-smoke
applies_when:
  - You are changing chapter, episode, sibling, or related-video navigation on public watch pages
  - A normal click starts a slow same-app navigation and the current route remains visible while Next resolves the next payload
  - You need click feedback without replacing canonical `next/link` behavior or breaking open-in-new-tab interactions
---

# Watch chapter carousel optimistic navigation feedback

## Context

Watch chapter cards are ordinary `next/link` navigations to another public
watch route. On slow route resolution, the old page can remain visible long
enough that a user wonders whether their click registered. The browser did not
need a new URL contract; the page needed an immediate local acknowledgment
using data already present in the carousel: parent collection slug, target
href, target title, and target thumbnail.

The fix lives in `apps/web/src/components/watch/SiblingCarousel.tsx` and keeps
the carousel server-data model unchanged. A normal click makes the clicked
chapter the temporary visual current item, shows busy feedback on that tile,
updates the clip counter, and removes the current treatment from the previous
card while the next route is still loading.

## Guidance

Keep the chapter card as a `Link`. Do not replace it with imperative
`router.push()` or a raw `<a>` just to get immediate feedback. The route
builder in `apps/web/src/lib/routes.ts` still owns the canonical public watch
href shape and base-path behavior. In a collection carousel, preserve the
current parent collection with the existing three-segment contextual route;
fall back to the standalone video route only when no valid parent slug is
available:

```tsx
const parentSlug = tryAsContentSlug(canonicalParent.slug)
const slug = tryAsContentSlug(child.slug)
const lang = tryAsLocaleSlug(languageSlug)
const href =
  slug && lang
    ? parentSlug
      ? watchEpisodePath(parentSlug, slug, lang)
      : watchVideoPath(slug, lang)
    : undefined
```

This distinction matters for multi-parent clips. A slug-only chapter href can
resolve through a different parent, changing the carousel order and active
index after navigation. The contextual href keeps chapter progression inside
the collection the user is already browsing.

Capture only normal left-click navigations. Modified clicks must keep browser
semantics, and active-card clicks should not create a fake pending state:

```tsx
if (isActive) return
if (event.defaultPrevented) return
if (event.button !== 0) return
if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

setPendingNavigation({
  href,
  languageSlug,
  sourceVideoDocumentId: currentVideoDocumentId,
  targetVideoDocumentId,
})
```

Treat pending navigation as an overlay on top of the route-derived active
state. The pending payload stores the source video and language that produced
it. When the route commits, `currentVideoDocumentId` changes and the pending
payload no longer validates, so the component naturally falls back to the
server-derived active index:

```tsx
const validPendingNavigation =
  pendingNavigation != null &&
  pendingNavigation.languageSlug === languageSlug &&
  pendingNavigation.sourceVideoDocumentId === currentVideoDocumentId
    ? pendingNavigation
    : null

const pendingActiveIndex =
  validPendingNavigation != null
    ? children.findIndex(
        (child) =>
          child.documentId === validPendingNavigation.targetVideoDocumentId,
      )
    : -1

const visualActiveIndex =
  pendingActiveIndex >= 0 ? pendingActiveIndex : activeIndex
```

Use that derived `visualActiveIndex` for all visible "current" surfaces:

- `data-active` and `aria-current` on the clicked card.
- The inside white border and active-card styling.
- The header clip count (`Clip 2 of 4`, etc.).
- The Embla `scrollTo()` target.
- The previous card's removal of active/current styling.

Use separate pending state only for "navigation is in flight" affordances on
the clicked tile:

```tsx
const isPending =
  validPendingNavigation != null &&
  validPendingNavigation.href === href &&
  validPendingNavigation.targetVideoDocumentId === child.documentId
```

That flag drives `aria-busy="true"` and swaps the hover play icon for the
spinner. A pending card can also be the visual active card; that is intentional
because the product expectation is "my clicked chapter is now the current one"
while the rest of the page catches up.

## Why This Matters

This gives users the same feedback cadence as a classic full-page navigation
without giving up Next's client-side route behavior. The important shift is
that the chapter rail acknowledges intent immediately while the hero poster,
title, video data, and rest of the page are still resolving.

When the pending chapter also drives the hero shell, treat the hero poster as a
loading cover, not a playback source swap. `WatchSectionRenderer` should pass a
pending-only visual payload with `loading: true` and a stable transition key
derived from the target video id. `HeroPlayer` can then bridge the cover through
black, fade the clicked chapter poster in, and pulse the visible cover while
the route is pending. The real player source, Mux metadata, downloads,
subtitles, and share data still remain route-owned until navigation commits.

Do not carry a separate destination black-bridge intent across the route
boundary. The optimistic chapter payload should self-invalidate when
`currentVideoDocumentId` changes, and the committed route-owned poster should
settle without another black overlay. A post-route black bridge creates a
visible double transition: current media to black, clicked cover reveal, then
the landed route dims from black again.

When the requested order is "current player to black, then title/cover swap,"
do not let `next/link` commit the route immediately for normal clicks. Keep the
card as a `Link` for native semantics, but have the parent-owned normal click
call `preventDefault()`, start a current-player blackout, and push the route
after the blackout and reveal delays. Modified clicks, middle clicks, and
already prevented events must keep the native link path. The pending
title/poster payload should be applied only after the blackout starts so a fast
route commit cannot visually jump ahead of the black transition, and the route
push should wait until after the cover reveal so a slow destination render does
not blank the first visible cover swap.

The React shape also avoids the `set-state-in-effect` trap. Do not clear
pending navigation from an effect that watches the URL or current video. Encode
the pending source and target, then derive whether it is still valid from the
current props. This matches the React Compiler guidance in
`docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md`.

## When to Apply

- Same-app Watch navigations where the clicked target's title, thumbnail, href,
  and document id are already in the current payload.
- Carousels or rails where a stale "current" highlight would make the click
  feel ignored.
- Navigation feedback that must preserve ordinary browser link behavior:
  command-click, control-click, shift-click, alt-click, middle-click, and
  already-prevented events.

Do not apply this pattern when the target data is not known locally, when the
click starts a mutation rather than route navigation, or when a full document
navigation is the desired product behavior.

## Verification

Focused coverage belongs in
`apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`:

- A normal chapter click sets the clicked card to `data-active="true"` and
  `data-pending="true"`.
- The previous current card becomes `data-active="false"`.
- The clicked card exposes `aria-busy="true"` and the loading icon.
- The clip label follows the clicked card while navigation is pending.
- Modified clicks do not set pending feedback.
- Collection carousels emit contextual hrefs such as
  `/anticipate-the-resurrection.html/jesus-is-crucified/english.html`, not
  slug-only child hrefs.

Run:

```bash
pnpm --filter @forge/web test -- src/components/watch/__tests__/SiblingCarousel.test.tsx
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
```

Browser smoke for the original issue used:

```text
http://127.0.0.1:3011/watch/resurrected-jesus-appears.html/english.html
```

Expected behavior:

- The clicked chapter tile becomes current immediately on normal click.
- The old current tile loses the current state immediately.
- The clicked tile shows a pending affordance before the destination page fully
  settles.
- The destination route eventually renders the real hero/title/current state.
- Modified clicks preserve browser behavior and do not show in-page pending
  feedback.

## Related

- `docs/roadmap/platform/feat-179-watch-chapter-navigation-feedback.md` - the
  ticket for this implementation.
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
  - adjacent Watch-page UX contracts for hero/player/header/episode rail work.
- `docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md`
  - derived-state pattern that explains why this implementation avoids an
    effect-based pending clear.
