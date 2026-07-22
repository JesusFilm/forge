---
title: "Watch Home Editorial Programming Boundaries"
date: "2026-07-22"
category: "architecture-patterns"
module: "admin-graphql-web-watch-home"
problem_type: "architecture_pattern"
applies_when:
  - "Editors need to schedule a media sequence without owning player behavior"
  - "A client needs fresh, unseen-first playback without polluting account progress"
  - "Partially invalid editorial data must degrade item-by-item before a bounded fallback"
related_components:
  - "graphql"
  - "content_authoring"
  - "browser_storage"
  - "media_playback"
  - "testing_framework"
tags:
  - "watch-home"
  - "editorial-programming"
  - "admin"
  - "graphql"
  - "shuffle-bag"
  - "exposure-ledger"
  - "media-lifecycle"
  - "fallback"
---

# Watch Home Editorial Programming Boundaries

## Context

Watch Home needed an editor-controlled intro, deliberate video/promo cadence,
and fresh content on every Web entry. The player already had valuable
platform-specific behavior: one media element, poster-first rendering, muted
previews, captions, scroll pause, takeover controls, and bounded advancement.
Putting selection rules directly into the player would have made editorial
changes deployment-bound and made queue tests depend on React, storage, and
media events.

The durable pattern is a four-stage boundary:

```text
Admin schema/editor
  -> GraphQL public projection
  -> Web normalization
  -> pure engine + ledger adapters
  -> existing player lifecycle
```

Each stage rejects only the data it owns and passes stable identities across
the boundary. Admin owns the programming document. Web owns public hydration,
selection, local exposure, and playback.

## 1. Author a Bounded, Typed Document

The locale-specific Homepage Experience carries an optional program inside its
`WatchHomeHeroBlock`. The program has:

- one optional promo-shaped intro;
- video buckets containing explicit Admin video IDs;
- promo buckets containing stable campaign IDs, playback identity, managed
  poster assets, localized overlay copy, and actions; and
- an ordered rotation of stable bucket IDs, where a bucket may be referenced
  more than once.

Validate the complete document at the program boundary. Kind mismatches,
duplicate IDs, missing rotation references, unsafe actions, unapproved poster
references, oversized strings, and excessive bucket/item counts should be
unrepresentable after Admin validation. Parse relative actions against the
canonical public origin and require the parsed origin to remain unchanged;
prefix checks alone accept backslash forms that browsers can reinterpret as an
external host. Keep the missing-program form valid so an existing
placement-only hero remains publishable during migration.

The editor should make mutation explicit. Opening a placement-only block does
not silently create programming. Creating, applying, canceling, removing, and
deleting referenced buckets are visible actions, and deleting a referenced
bucket names the affected rotation slots before confirmation.

## 2. Project Identities, Then Normalize Public Playback

The public GraphQL contract is additive and optional. It projects the authored
shape while resolving producer-owned identities at the boundary:

- Admin video ID resolves to the catalog/Core identity used for bounded Web
  hydration;
- managed poster asset ID resolves to a public URL; and
- the consumer fragment carries the complete typed program.

Web then performs a second trust and delivery pass. It rechecks document
limits and action destinations, fetches unique catalog identities in one
bounded server request, chooses a playable dub for the active language, and
derives public stream/thumbnail values. Containers, unresolved videos,
unplayable dubs, unsafe actions, and unresolved poster assets are omitted
item-by-item. A structurally invalid response or a program with no playable
rotation keeps the legacy static program as the migration fallback.

Do not leak Admin credentials or producer-only types into the client bundle.
Pass a serializable, normalized Web program to the client, including both the
stable Admin video identity and the derived catalog/playback data it needs.

## 3. Keep Selection Pure and Persistence Defensive

The sequence engine accepts the normalized program, an injected entry seed,
browser exposure, signed-in video history, and continuation state. It does not
read the DOM, React state, storage, time, or the network.

Its rules are:

1. Emit a playable intro once, outside the repeating rotation.
2. Advance through rotation slots exactly as authored.
3. Give every bucket an independent no-repeat shuffle bag.
4. Prefer globally unseen video identities within that bucket.
5. Reset only the exhausted bucket; avoid an immediate boundary repeat when
   multiple candidates permit it.
6. Skip missing, empty, duplicate, unplayable, or current-entry-quarantined
   items while scanning at most one complete authored rotation.
7. Signal fallback when that bounded scan produces nothing.

Canonical video identity is global across languages and buckets. Promo identity
is the semantic campaign ID. A material promo change, such as replacing its
playback asset or action destination, requires a new ID; copy or poster polish
keeps the ID and its exposure continuity.

The storage adapter persists a version, calendar month, program fingerprint,
stable exposure identities, and per-bucket cycle state. It sanitizes malformed
JSON, resets old versions/months, retains canonical monthly exposures across
locale/program changes, and discards only cycle state when the program
fingerprint changes. Storage denial, quota failure, and competing-tab writes
degrade to safe in-memory or merged state rather than breaking playback. Once
a storage object rejects writes, use the in-memory ledger for subsequent reads
in that session so a failed persistence attempt cannot erase newly recorded
exposure. Storage is an adapter around the engine, never an engine dependency.

## 4. Record Exposure at the Media Lifecycle

Queue selection cannot decide whether a viewer actually saw a preview. The
player hook owns that decision because it can observe playback, document
visibility, hero intersection, media completion, skips, and errors.

A rotating item becomes browser-exposed after three cumulative seconds of
successful playback while both the document and hero are visible. An explicit
next/skip records exposure immediately, and a shorter promo records on
completion. Poster dwell, buffering, blocked autoplay, rail selection,
background/offscreen playback, and media errors do not count. Pause media and
all advance/progress timers as soon as the document or hero becomes hidden,
preserve the remaining delay, and reset the exposure sampling baseline before
resuming. Cap each sampled media-time delta so seeking or a delayed event cannot
manufacture the threshold. Guard asynchronous `play()` rejections and media
errors with both the active slide and media element so a stale failure cannot
quarantine the replacement slide. A failed item is quarantined only for the
current entry and advances through the same exactly-once path as other
completions.

The fixed intro intentionally runs on every entry and is not exposure-filtered.
Browser exposure never calls account progress APIs. Existing signed-in progress
(`getWatchProgressRatio(entry) > 0`) is read only as an unseen preference for
canonical videos; it does not apply to promos and is never modified by hero
autoplay.

Keep the existing media surface. The engine supplies the next slide, but the
player retains responsibility for poster loading, autoplay recovery, preview
caps, captions, reduced motion, scroll pause, takeover, and exactly-once
advance.

## Failure and Migration Rules

Failures should narrow scope before they trigger the fallback:

- invalid Admin document: reject before publish;
- missing GraphQL item: omit that item and preserve surviving slots;
- unplayable normalized item: omit that item;
- media error at runtime: quarantine for this entry without exposure;
- one complete authored rotation yields nothing: switch to the legacy queue;
- legacy queue unavailable: keep the rest of Watch usable rather than loop or
  blank the page.

The legacy static playlist and promos are a migration adapter, not a second
authoring source. The local/staging seed remains placement-only because a valid
promo program requires approved Admin `MediaAsset` poster IDs. Production
editors publish the program through the normal Admin Experience workflow rather
than committing environment-specific asset identities.

Mobile and TV do not consume this Web program. If native adoption is approved,
scope it separately and preserve each platform's playback constraints instead
of sharing the Web hook.

## Safe Extension and Testing Guide

When extending the program:

- Add editorial fields producer-first: Admin schema/editor, GraphQL type,
  regenerated schema/introspection, Web normalization, then the client model.
- Keep fields additive and optional until every consumer can tolerate them.
- Add a new stable identity rule before adding a new item kind.
- Bound every new list, string, URL, hydration request, and rotation scan.
- Keep audience targeting, weighting, frequency caps, and cross-device exposure
  out of the shuffle-bag engine until they have an explicit product contract.
- Never turn preview exposure into watch progress or analytics implicitly.

Test each boundary independently:

1. Admin schema/editor tests prove limits, cross-field references, trust policy,
   explicit mutations, and accessible reordering.
2. GraphQL and normalization tests prove public projection, language-correct
   playback, bounded deduped hydration, item-level omission, and whole-program
   fallback.
3. Pure engine tests use fixed seeds to prove exact cadence, repeated bucket
   references, independent exhaustion/reset, unseen preference, quarantine,
   bounded empty scans, and corrupt-ledger recovery.
4. Hook tests prove fresh-entry lifecycle, asynchronous account-history
   reconciliation, visible playback accumulation, explicit skip, short-promo
   completion, error quarantine, back/forward-cache restoration, and
   exactly-once advancement.
5. Browser and page-loading checks remain separate evidence: visual playback
   smoke does not prove that hydration, media requests, or loading performance
   stayed within budget.

## Related

- `docs/plans/2026-07-22-001-feat-watch-home-editorial-programming-plan.md`
- `docs/roadmap/platform/feat-286-watch-home-editorial-programming.md`
- `apps/admin/src/domain/blocks.ts`
- `apps/admin/src/graphql/types/blocks.ts`
- `apps/web/src/lib/watch-home.ts`
- `apps/web/src/lib/watch-home-carousel-sequence.ts`
- `apps/web/src/components/home/useWatchHomeTvCarousel.ts`
