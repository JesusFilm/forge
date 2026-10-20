---
title: "Revalidate Top Shelf inputs without clearing viewing history"
date: "2026-10-19"
category: integration-issues
module: "apps/tv — Top Shelf"
problem_type: integration_issue
component: content_refresh
tags: [tv, tvos, top-shelf, apollo, cache, cancellation]
---

# Top Shelf freshness and request ownership

The October 19 controlled API test exposed two independent caches. The persisted
`watch.top-shelf.catalog.v1` reused film metadata for the whole local day when
language/slugs matched. The Home model supplying Journey titles also remained in
memory across foreground transitions and beta style reselection. Clearing one
cache did not establish freshness of the other.

The app now reads the bounded resume/editorial metadata set during an existing
foreground synchronization. The native snapshot remains the expiring transport
fallback; the redundant daily catalogue is no longer read or written. Real viewing
history and daily concept rotation retain their existing storage. Use
`preferredPlayableDub(languageSlug:)` and verify its returned language exactly:
the public field can fall back to another language, and fetching every dub would
unnecessarily reload thousands of variants for some films.

Apple Home and the beta selector opt into fresh Home requests. An explicit refresh
key fences publication during the render before the request effect starts.
`refreshing` stays true while cached Home content is painted; loading/visible
content alone cannot prove that Journey input is current. Equal data preserves
the existing model reference. Default/Android request policy and scheduling remain
unchanged. A failed fresh request keeps visible content and suppresses fresh
Top Shelf publication from that stale model.

Cancellation must cover the entire hydration chain. Pass the same abort signal
and `queryDeduplication: false` through both primary queries and every divergent
video top-up chunk for an owned refresh. Otherwise a newer Apollo query can share
the older in-flight top-up and accept its result as current despite the outer
request-ID guard. Default callers omit that ownership context, preserving their
existing query-sharing behavior.

Successful null/empty content differs from a network error. Retire explicit empty
Journey blocks even when a parallel video request fails. Never reintroduce a
confirmed unavailable resume film through an overlapping recommendation. During
partial metadata failure, remove confirmed ineligible films, removed local history
and removed Journey IDs from the retained snapshot, without extending its expiry.
Recheck ownership/privacy generation after awaited rotation/native writes before
persisting or reporting success.

Foreground freshness does not implement closed-app updates. The current native
provider reads files only. Extension fetching needs a separate bounded native
read path, endpoint configuration and cache ownership; Push requires additional
native/server integration. See
`docs/plans/2026-10-19-top-shelf-fresh-content.md` for scope and verification.

For local-only testing, disabling GraphQL forwarding is necessary but not always
sufficient: captured Home content can contain production API asset-preview URLs.
Use reviewed stored catalogue data, deny uncaptured operations, and omit those
API asset previews from local responses. Preserve real film IDs, destinations,
durations and safe CDN artwork. Keep local fixture identities off the normal API,
preserve failed attempts, and label prior forwarding evidence separately from
later fully local API replay.
