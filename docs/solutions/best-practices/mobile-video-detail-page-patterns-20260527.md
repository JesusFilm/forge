---
title: "Mobile video detail page patterns: standalone route with independent data fetching"
date: 2026-05-27
category: best-practices
module: apps/mobile
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - "Building a standalone mobile video detail route with independent data fetching"
  - "Wiring expo-video player with source replacement on language/quality changes"
  - "Rendering scroll-heavy React Native screens with carousel + accordion + FAB"
  - "Routing on GraphQL enum values that differ in case between admin schema and client"
  - "Implementing animated floating bars that must survive exit animations"
tags:
  - mobile
  - expo
  - react-native
  - expo-video
  - graphql
  - prisma-relation-inversion
  - memoization
  - scroll-performance
related_components:
  - packages/admin-graphql
  - apps/admin
---

# Mobile video detail page patterns: standalone route with independent data fetching

## Context

The JesusFilm mobile app needed a dedicated video detail page reachable by slug (`app/watch/[slug].tsx`), separate from the existing experience-child video route (`app/video/[sectionKey].tsx`) which only resolves videos within an Experience context. The new page fetches independently via `GET_VIDEO_BY_SLUG`, normalizes the admin GraphQL response into flat consumer types, and renders player, metadata, action modals, sibling carousel, study questions, and bible quotes.

Seven non-obvious patterns emerged during build and code review. Each is documented below with enough specificity to apply in future mobile work.

Prior session context (session history): dev environment setup required `EXPO_PUBLIC_ADMIN_GRAPHQL_URL=http://127.0.0.1:3003/api/graphql` (not `localhost` which loops through the auth-host proxy). The mobile Apollo client sends no auth header; public queries work unauthenticated but search requires a bearer token. This was a known constraint during development.

## Guidance

### 1. GraphQL enum case sensitivity in routing discriminators

Admin's `HybridSearchContentType` returns uppercase string literals (`"EXPERIENCE"`, `"VIDEO"`), not lowercase. Any discriminator that routes on this field must match the exact case. A lowercase comparison is a silent no-op: the condition never matches, and every result falls through to the wrong branch.

```typescript
// WRONG — never matches, every result routes to /watch/
if (result.type === "experience") { ... }

// CORRECT — matches the GraphQL enum's wire format
if (result.type === "EXPERIENCE") { ... }
```

Check the admin SDL or a live query response before writing discriminator logic for any enum field.

### 2. expo-video language switching: replace, don't reinitialize — and FREEZE the source

> **Superseded as a recipe (2026-08-12).** Do not hand-roll this in a new
> screen. `apps/mobile/src/hooks/useManagedVideoPlayer.ts` (todo 016) now owns
> the frozen creation source, the `replaceAsync` swap with resume, and the
> AppState handling, and every player screen consumes it. The reasoning below
> is still correct and is the best explanation of WHY the source must be
> frozen — read it to understand the adapter, not to reimplement it.

When a user switches the audio language, swap the stream URL via `player.replaceAsync(newUrl)` rather than re-creating the `useVideoPlayer` instance. Reinitializing destroys the decoder slot, causes a blank frame, buffering delay, and lost playback position.

**Critically, the source passed to `useVideoPlayer` must be frozen.** `useVideoPlayer` recreates AND releases the native player whenever its source argument _value_ changes (its internal dependency is `JSON.stringify(source)`). Passing a ref value you then mutate — which an earlier version of this pattern did (`initialUrl.current = streamingUrl`) — defeats `replaceAsync`: the next render hands `useVideoPlayer` the new value, so it tears down the playing player and builds a fresh paused one on the new asset while the in-flight `replaceAsync` runs against the just-released instance. Symptom: black/stuck frame on language switch, controls showing "playing" while nothing plays. Track the loaded URL in a **separate** ref.

```typescript
// Frozen at creation — never reassigned, so useVideoPlayer never recreates.
const creationSource = useRef(streamingUrl).current
const player = useVideoPlayer(creationSource, (p) => {
  p.muted = false
  p.loop = false
})

// Separate ref tracks the loaded URL for swap decisions.
const loadedUrlRef = useRef(streamingUrl)

useEffect(() => {
  if (!streamingUrl || streamingUrl === loadedUrlRef.current) return
  loadedUrlRef.current = streamingUrl
  // Preserve playback: replace does not carry the play state to the new source.
  const wasPlaying = player.playing
  void player
    .replaceAsync(streamingUrl)
    .then(() => {
      if (wasPlaying) player.play()
    })
    .catch(() => {
      try {
        player.replace(streamingUrl, true)
      } catch {}
    })
}, [streamingUrl, player])
```

Also make play/pause controls read the **live** `player.playing`, not a cached React snapshot: a source swap can leave the player paused without emitting a `playingChange`, so a stale snapshot wedges the toggle (it calls `pause()` on an already-paused player forever, and the user can't resume without leaving the screen).

The parent component must pass `activeVariant?.hls` (the currently-selected variant's stream), not the base `video.streamingUrl`. A common bug (found in code review) is wiring the player to a fixed base URL so the language switch becomes a no-op. Identify _which_ language is active by the unique language slug, never by bcp47 — see the language-identity doc in Related.

### 3. Bible verse fetching: bookSlugForApi strips spaces, not replaces with hyphens

Bible verse content is fetched client-side from the jsdelivr CDN (`wldeh/bible-api`). The book slug format strips spaces entirely. Both the mobile and web implementations use the same logic.

```typescript
// WRONG — "1-corinthians" 404s on the CDN
const bookSlug = book.replace(/ /g, "-")

// CORRECT — matches the CDN's path structure
const bookSlug = book.replace(/ /g, "") // "1corinthians"
```

### 4. Animated floating bars: separate mounted state from visible state

For any animated floating bar (MiniPlayerBar, toast, snackbar), use a `mounted` boolean that stays `true` until the exit animation completes. A bare `if (!visible) return null` unmounts the component immediately, killing the exit animation mid-frame.

**Note added 2026-08-15.** `MiniPlayerBar.tsx` was deleted — it never had an import site. The pattern is unchanged and the snippet below still reads correctly. Live examples are `apps/mobile/src/components/library/DeleteConfirmSheet.tsx` and `apps/mobile/src/hooks/useControlsVisibility.ts`. Do not copy it onto a layer that holds a video surface: `MiniPlayerWindow.tsx` returns `null` at once on purpose, because a fade-out there would keep a second decoder attached.

```typescript
function MiniPlayerBar({ visible }: { visible: boolean }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (visible) setMounted(true)
    Animated.parallel([
      Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: visible ? 0 : 60, duration: 200, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && !visible) setMounted(false)
    })
  }, [visible])

  if (!mounted) return null
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>...</Animated.View>
}
```

### 5. FlatList performance: memoize renderItem and hook returns

Scroll-heavy screens must wrap `renderItem` in `useCallback` and hook return values in `useMemo`. Without this, every parent re-render (from scroll events) creates new function references, causing FlatList to re-render all visible cells.

```typescript
// Module-level stable empty arrays
const EMPTY_CITATIONS: WatchBibleCitation[] = []

// In component
const bibleQuotes = useBibleVerses(video?.bibleCitations ?? EMPTY_CITATIONS)

// In hook
return useMemo(() => { /* compute quote cards */ }, [citations, verses])

// FlatList renderItem
const renderItem = useCallback(({ item }) => { ... }, [stableDeps])
```

Also: `PlayerControls.toggleMute` should track state locally (`!isMuted`) instead of reading back `player.muted` after the write, because the native bridge write may not be synchronous on Android.

### 6. Study questions fallback: CTA pills when answer text is empty

When a study question has an empty `answer` field, render "Chat" and "Ask Bible Question" pill buttons instead of blank space. This matches `apps/web`'s `WatchStudyQuestions` pattern.

URLs: `chataboutjesus.com/chat/?utm_source=jesusfilm-watch` and `everystudent.com/contact.php?utm_source=jesusfilm-watch`.

### 7. Defensive sibling filtering for Prisma relation inversion

The admin Prisma schema has a known inversion of `Video.parents`/`Video.children` relation labels. When fetching sibling videos, the response may contain duplicates and the current video itself. Filter defensively at the normalizer layer:

```typescript
const selfId = raw.documentId
const rawSiblings =
  raw.parents?.[0]?.parent?.children
    ?.map((rel) => rel.child)
    .filter((child) => child != null && child.documentId !== selfId) ?? []
const siblings = dedupeByDocumentId(rawSiblings)
```

This guard must live in the normalizer so it applies regardless of which component consumes the data. The Prisma inversion is tracked as a known defect on `main` (see `docs/solutions/database-issues/prisma-video-relation-inverted-back-references-20260514.md`).

## Why This Matters

These patterns span three failure categories:

- **Silent no-ops**: enum case mismatch (pattern 1) and fixed-URL language switch (pattern 2) produce zero runtime errors while the feature simply does not work. Only manual testing catches them.
- **Visual glitches**: bare `return null` on animated bars (pattern 4) produces a janky snap-to-hidden that users notice immediately.
- **Scroll performance**: unmemoized `renderItem` and unstable hook returns (pattern 5) degrade frame rate on lower-end Android devices, which is the primary device tier for JesusFilm's audience.

## When to Apply

- Any new mobile screen that fetches a video by slug rather than by Experience context
- Any feature that adds language or quality switching to the video player
- Any animated floating UI element (mini-player, toast, bottom sheet)
- Any FlatList screen with complex sections or async-computed data
- Any admin GraphQL enum used as a routing discriminator
- Any study questions or FAQ surface where answers may be empty

## Examples

The canonical implementation lives on the `feat/mobile-video-detail-page` branch:

- Route: `apps/mobile/app/watch/[slug].tsx`
- Normalizer: `apps/mobile/src/lib/normalizeVideo.ts`
- Player: `apps/mobile/src/components/watch/VideoPlayer.tsx`
- Bible verses hook: `apps/mobile/src/hooks/useBibleVerses.ts`
- Commit `664fe547` — code review fixes (P0 language-switch, P1 animation, P2 memoization)
- Commit `ab878d89` — UX polish (scroll FAB, nav title fade, section spacing)

Web reference for study questions CTA parity: `apps/web/src/components/watch/WatchStudyQuestions.tsx`.

## Related

- `docs/solutions/architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md` — normalizer pattern upstream
- `docs/solutions/database-issues/prisma-video-relation-inverted-back-references-20260514.md` — known constraint for sibling queries
- `docs/solutions/best-practices/playlist-video-player-sdui-mobile-20260409.md` — prior `useVideoPlayer` source-swap approach (frozen creation source + `replaceAsync`); the canonical reference for why the source arg must not change
- `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md` — how to identify _which_ language is active/preferred (key on the unique language slug, not bcp47); complements Pattern 2's swap mechanism
- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` — ref-mirror patterns for expo-video async events
