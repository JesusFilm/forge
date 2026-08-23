---
title: "Watch carousel hierarchy requires exact own-child admission"
date: "2026-08-22"
category: "logic-errors"
module: "apps/web Watch routing"
problem_type: "logic_error"
component: "service_object"
symptoms:
  - "A contextual Watch URL could lose its selected collection when the playable child also owned Chapters."
  - "A standalone feature film treated its own manifest-routable Chapters as secondary to external collection contexts."
  - "Using playback presence or a global language list could expose a Chapter whose exact contextual route was not admitted for the selected audio language."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "apps/web Watch route manifest"
  - "apps/web SiblingCarousel"
  - "apps/web WatchPageClient navigation"
tags:
  - "watch-route"
  - "route-manifest"
  - "chapter-context"
  - "exact-admission"
  - "standalone-video"
  - "carousel-parent"
  - "language-routing"
---

# Watch carousel hierarchy requires exact own-child admission

## Problem

A playable video can belong to one or more eligible collections and also own
Chapter children. Those relationships do not have equal authority on every
route: a contextual URL records an explicit parent choice, while a standalone
URL expresses the playable video's own context. Treating parents as an ordered
selector and appending the video's children made external collections the
standalone default; letting own children always win could instead override a
parent explicitly named by the URL.

The missing context could not safely be restored by copying every child. A
child's playback payload may fall back to another language, and an older route
manifest may prove only that the language exists somewhere in the catalog.
Neither signal proves that the exact parent/child/language contextual URL is
public.

## Symptoms

- Standalone Life of Jesus defaulted to an external collection even though the
  catalog related 49 Chapters to the film.
- A contextual collection URL could be replaced by the selected playable
  child's own hierarchy, contradicting the viewer's explicit context.
- A partial per-Chapter language index could admit some own children and reject
  others; an all-or-nothing film-level check would either hide valid routes or
  expose invalid ones.

## What Didn't Work

- Treating `muxPlaybackId` as language proof. Admin may return fallback media,
  so playback presence is not exact selected-language route admission.
- Falling back to the manifest's global audio-language corpus. That proves only
  that a language exists somewhere, not for this Chapter under this film.
- Treating external parents as the standalone default and appending the film as
  another selectable context. This makes intrinsic children secondary and
  serializes parent choices that are irrelevant when the own-child rail
  qualifies.
- Letting a hybrid video's own children override a contextual canonical
  parent. The parent selected in the URL is authoritative for that route.
- Applying the two-item threshold before filtering. A source qualifies only
  when at least two children remain after exact admission.

## Solution

Resolve one carousel source from route context, in this order:

1. On a contextual route, the URL-resolved canonical parent is authoritative
   and terminal. If fewer than two of its children are admitted, render no
   sibling carousel; do not fall through to the selected video's children or
   another parent.
2. On a standalone playable-video route, filter the video's own children for
   the exact current parent/child/selected-audio-language route. At least two
   admitted children produce one fixed own-child rail.
3. Only when the standalone own-child rail does not qualify, use eligible
   external parents as the existing selectable fallback, preserving their
   relation order and default.

Exact admission uses `isWatchEpisodeRouteExactlyAdmittedByManifest`, which
requires both the exact parent/child pair and the child's selected audio
language in the per-episode index:

```ts
const admittedOwnChildren = withAdmittedVideoChildren(
  carouselVideo,
  languageSlug,
  routeManifest,
  isWatchEpisodeRouteExactlyAdmittedByManifest,
)

const carouselSource = canonicalParent
  ? fixedParent(canonicalParent)
  : admittedOwnChildren.length >= 2
    ? fixedOwnChildren(carouselVideo, admittedOwnChildren)
    : selectableParents(eligibleParents)
```

The sketch expresses precedence, not a required new abstraction. Keep
standalone parent lookup lazy so qualifying own children do not serialize or
resolve irrelevant choices. Reuse the fixed-parent carousel, contextual URL
builder, and pending-navigation guard. Contextual Up Next follows the
URL-selected canonical parent; standalone Up Next retains its existing
own-video behavior and never follows an external-parent fallback selector.

Test the boundary with more source children than admitted children: three own
Chapters whose exact English index admits only the first and third must render
those two in relation order. Separate cases pin contextual-parent authority,
terminal contextual threshold behavior, legacy-manifest parent fallback,
standalone thresholds, production-shaped 49/61/73-child order, full-film
canonical/Share/download/rights/language identity, contextual Chapter
navigation, and `SeriesPage` separation.

## Why This Works

The route manifest is the authority for public route possibility. Exact
per-episode admission binds all three dimensions that the contextual URL needs:
film parent, Chapter child, and selected audio language. Filtering each child
independently preserves every valid route without promoting an invalid sibling.

The route shape supplies authority before catalog relationships do. That keeps
an explicit contextual choice stable while giving a standalone playable video
its intrinsic hierarchy whenever it is useful. The mutually exclusive result
also avoids shipping external-parent selector data when it cannot be selected.

This remains a generic Watch contract for qualifying playable videos, including
JESUS, Life of Jesus, and Book of Acts. It never checks a title, slug, document
ID, or current child count, does not turn a playable film into a series, and
does not change the separate `SeriesPage` flow. Carousel choice must not mutate
canonical, playback, hero, Share, download, rights, language, publication, or
media identity.

## Prevention

- For any synthesized Watch context, test exact per-child language admission
  with a partially admitted fixture. A test where every child is admitted does
  not prove the boundary.
- Apply the minimum-child threshold after filtering. Preserve relation-owned
  own-child order and, when used as fallback, eligible-parent order and default.
- Test contextual URL authority separately from standalone priority; the same
  hybrid video must not erase its URL-selected parent.
- Preserve manifest-null fail-open for already restriction-filtered own
  children. A present legacy manifest cannot prove exact episode-language
  admission, so treat own admission as inconclusive and use parent fallback.
- Keep route admission separate from media fallback, rights, publication, and
  film-versus-series classification.
- When an authenticated Admin snapshot is unavailable, record browser routes as
  Skips with the exact limitation. Never forward authorization headers or use a
  credential-bearing proxy to manufacture branch evidence.
- Do not deploy production while collecting evidence; production changes go
  through the normal PR-to-main flow.

## Related Issues

- [FGE-75 roadmap record](../../roadmap/platform/feat-416-watch-life-of-jesus-chapter-context.md)
- [Admin-Owned Watch Route Manifest](../architecture-patterns/admin-owned-watch-route-manifest-20260530.md)
- [Feature films with children are not series containers](tv-childcount-not-a-series-container-signal.md)
- [Public Watch URL two-segment contract](../conventions/public-watch-url-two-segment-contract-20260608.md)
