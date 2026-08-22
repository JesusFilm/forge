---
title: "Standalone Watch own-Chapter contexts require exact manifest admission"
date: "2026-08-22"
category: "logic-errors"
module: "apps/web standalone Watch routing"
problem_type: "logic_error"
component: "service_object"
symptoms:
  - "A standalone feature film kept its collection contexts but did not offer its own manifest-routable Chapters as a continuation context."
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

# Standalone Watch own-Chapter contexts require exact manifest admission

## Problem

A standalone film can be playable in its own right, belong to one or more
eligible collections, and also own Chapter children. The standalone Watch page
already offered the eligible collections as selectable carousel contexts, but
it discarded the film's own Chapter sequence. Viewers could play and download
the full film yet could not continue through its Chapters from that page.

The missing context could not safely be restored by copying every child. A
child's playback payload may fall back to another language, and an older route
manifest may prove only that the language exists somewhere in the catalog.
Neither signal proves that the exact parent/child/language contextual URL is
public.

## Symptoms

- The standalone Life of Jesus page defaulted to its existing collection and
  exposed only collection choices, although the catalog related 49 Chapters to
  the film.
- The corresponding contextual page already rendered the 49-Chapter sequence,
  so the two entry points exposed different continuation choices for the same
  film.
- A partial per-Chapter language index could admit some own children and reject
  others; an all-or-nothing film-level check would either hide valid routes or
  expose invalid ones.

## What Didn't Work

- Treating `muxPlaybackId` as language proof. Admin may return fallback media,
  so playback presence is not exact selected-language route admission.
- Falling back to the manifest's global audio-language corpus. That proves only
  that a language exists somewhere, not for this Chapter under this film.
- Replacing the canonical parent with the film. That changes the initial
  related-item identity, default selection, and JSON-LD instead of adding an
  optional context.
- Appending the film before filtering its children. A context must have at least
  two admitted children after exact filtering or the selector creates a useless
  one-item choice.

## Solution

Project the standalone film into the existing lean `CarouselParent` shape, but
only after the ordinary eligible-parent set exists. Filter each own child with
`isWatchEpisodeRouteExactlyAdmittedByManifest`, which requires both the exact
parent/child pair and the child's selected audio language in the per-episode
index:

```ts
const ownChapterContext =
  eligibleParents.length > 0 && carouselVideo.children.length >= 2
    ? withAdmittedCarouselChildren(
        {
          documentId: carouselVideo.documentId,
          slug: carouselVideo.slug,
          title: carouselVideo.title,
          children: carouselVideo.children,
        },
        languageSlug,
        routeManifest,
        isWatchEpisodeRouteExactlyAdmittedByManifest,
      )
    : null

const selectableParents =
  ownChapterContext != null && ownChapterContext.children.length >= 2
    ? [...eligibleParents, ownChapterContext]
    : eligibleParents
```

Keep the existing eligible parents first. The first eligible parent remains the
default and canonical parent; the film is only another selectable context. Reuse
the existing selector, carousel, contextual URL builder, pending-navigation
guard, playback identity, and download identity.

Test the boundary with more source children than admitted children. The pending
Web change uses three own Chapters whose exact English index admits only the
first and third, then asserts that those two appear in relation order. Separate
cases pin the legacy-manifest fallback, fewer-than-two result, 49-Chapter order,
full-film canonical/Share/download identity, and contextual Chapter navigation.

## Why This Works

The route manifest is the authority for public route possibility. Exact
per-episode admission binds all three dimensions that the contextual URL needs:
film parent, Chapter child, and selected audio language. Filtering each child
independently preserves every valid route without promoting an invalid sibling.

Appending a projected parent is also deliberately additive. It changes only
the carousel's available contexts; it does not reclassify the film as a series,
change the standalone URL, replace the canonical parent, or mutate playback,
download, rights, or publication decisions.

The gate remains a generic Watch contract rather than a title or slug special
case. Catalog titles that appear to satisfy the same structure still require
product confirmation when their reported behavior is unresolved; do not add a
title-specific exception without an approved catalog discriminator.

## Prevention

- For any synthesized Watch context, test exact per-child language admission
  with a partially admitted fixture. A test where every child is admitted does
  not prove the boundary.
- Apply the minimum-child threshold after filtering, and preserve the original
  eligible-parent ordering and default.
- Keep route admission separate from media fallback, rights, publication, and
  film-versus-series classification.
- When an authenticated Admin snapshot is unavailable, record browser routes as
  Skips with the exact limitation. Never forward authorization headers or use a
  credential-bearing proxy to manufacture branch evidence.

## Related Issues

- [FGE-75 roadmap record](../../roadmap/platform/feat-416-watch-life-of-jesus-chapter-context.md)
- [Admin-Owned Watch Route Manifest](../architecture-patterns/admin-owned-watch-route-manifest-20260530.md)
- [Feature films with children are not series containers](tv-childcount-not-a-series-container-signal.md)
- [Public Watch URL two-segment contract](../conventions/public-watch-url-two-segment-contract-20260608.md)
