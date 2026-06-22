---
title: "Persist the display name alongside the slug so cold-start labels paint instantly"
date: 2026-06-23
category: design-patterns
module: apps/mobile
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "A selection/preference pill label depends on a name that lives in lazily-fetched per-item media"
  - "The identity slug is in fast local state but the slug->name map needs a network round-trip"
  - "The client cache has no persistence, so every navigation is a cold fetch"
  - "The display name is display-only and never used as a resolution key"
tags:
  - mobile
  - react-native
  - async-storage
  - cold-launch
  - watch-preferences
  - subtitles
  - display-name
  - caching
---

# Persist the display name alongside the slug so cold-start labels paint instantly

## Context

A selection pill on the mobile (Expo / React Native) watch screen showed a static `Subtitles` placeholder for the first ~1-2 seconds of every cold load, then snapped to the real subtitle language name (e.g. `French`). The neighboring dub-language pill never flickered — it painted `English` immediately.

The asymmetry comes from where each name lives. The dub language loads with the video itself, so its name is in hand on mount. Subtitle tracks are fetched **lazily per dub** (a separate `videoDub(id)` query, cache-first), and the app's Apollo `InMemoryCache` has no persistence — so every navigation is a cold fetch. The user's _selection_ (a language slug) is in fast local state and resolves instantly, but the slug -> display-name map is exactly the part that needs the round-trip. (auto memory [claude]: the watch screen fetches each dub's media lazily via `videoDub`, cache-first; Apollo `InMemoryCache` has no persistence — every cold navigation re-fetches.)

The instinct — and the first cut — was to persist only the _identity_ (the language slug). That doesn't help: the slug is already fast; it's the name lookup that's slow.

## Guidance

When a label's **display text** comes from lazily-fetched data while its **identity** is available immediately, persist the display _name_ app-wide (not just the id), and use the cached name as the label's immediate fallback while the lazy source loads.

Three details make it safe:

1. **Cache the name keyed on the _preferred_ identity, never the per-view resolved one.** The persisted name tracks the user's app-wide choice. If you key the write on the per-view auto-resolved selection, a view that lacks that entity overwrites the cache with a different name — re-introducing the placeholder on the next view that _does_ have it.
2. **Gate the write on the persistence-hydration flag.** A caching effect that writes before the persistence layer has finished its initial read merges its patch onto _default_ state and clobbers the rest of the stored blob. Wait for the provider's `isReady` / hydrated flag.
3. **Keep identity keyed on the unique slug; the name is display-only.** Never resolve against the persisted name. (auto memory [claude]: JFP language bcp47 tags are not unique — `ko-kmr` collides with `ko` — so identity must key on the unique language slug, never a name or a bcp47 prefix.)

The write is **self-terminating**: only persist when the resolved name differs from what's cached, so the effect fires at most once per name change and never loops.

## Why This Matters

Persisting the identity alone leaves the cold path slow, because the id -> name map is the lazy part. Caching the _name_ turns the label's cold path into its warm path — the pill paints the real value on the first frame instead of a placeholder.

The two guards prevent subtle, hard-to-spot regressions: keying on the per-view value silently corrupts the cache across navigations, and an un-gated pre-hydration write wipes unrelated persisted preferences. Both are invisible in a quick demo and only bite on specific navigation orders or cold starts.

## When to Apply

- Any UI label whose **display name** comes from a lazily-fetched or non-persisted source, while the underlying **selection / id** is available immediately.
- Especially on mobile, where a non-persisted client cache plus per-screen navigation means _every_ entry can be a cold fetch.
- Skip it when the name is already in fast local state, or when a brief placeholder is genuinely acceptable.

## Examples

Persist the name beside the slug (both app-wide, in the same preferences blob):

```ts
// watchPreferences.ts
export type WatchPreferences = {
  subtitleLanguageSlug: string | null // identity (already persisted)
  subtitleLanguageName: string | null // display name — the new cold-load cache
  // ...
}
```

Cache the name when the lazy media lands — keyed on the **preferred** slug, gated on hydration, self-terminating:

```ts
// WatchSessionProvider.tsx
useEffect(() => {
  if (!preferencesReady || !preferredSubtitleSlug || !activeVariantMedia) return
  const next = subtitleNameToCache(
    preferredSubtitleSlug, // preferred id, NOT the per-video resolved one
    activeVariantMedia.subtitles, // the lazily-fetched names
    preferredSubtitleName, // current cache → null means no write
  )
  if (next != null) setPreferredSubtitleName(next)
}, [
  preferencesReady,
  preferredSubtitleSlug,
  preferredSubtitleName,
  activeVariantMedia,
  setPreferredSubtitleName,
])
```

```ts
// subtitleSelection.ts — pure + unit-tested
export function subtitleNameToCache(slug, subtitles, cached) {
  const name = resolveActiveSubtitle(slug, subtitles)?.languageName
  return name != null && name !== cached ? name : null // no-op unless it changed
}
```

Use the cached name as the immediate label fallback:

```ts
// resolveSubtitleActionLabel(enabled, slug, subtitles, fallbackName)
return (
  deriveSubtitleLabel(enabled, slug, subtitles) ??
  (enabled ? fallbackName : null)
)
//     ^ resolved name once media lands                  ^ persisted name, painted on cold load
```

**Before:** cold load -> `Subtitles` placeholder for ~1-2s -> `French`.
**After:** cold load -> `French` on the first frame.

**Known trade-off:** on a view that _lacks_ the preferred entity, the label optimistically shows the preferred name for the load window, then corrects to that view's resolved value once media lands. A sub-second cosmetic transient, accepted as the price of killing the placeholder flash in the common case.

## Related

- `docs/solutions/design-patterns/asyncstorage-swr-snapshot-slow-admin-resolver.md` — companion AsyncStorage pattern (pre-hydration write buffering / stale-while-revalidate snapshot); this learning reuses its hydration-gate discipline on a different surface.
- `docs/solutions/design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md` — the lean-bulk + lazy per-item fetch that makes per-dub media (and thus subtitle names) cold on each navigation.
- `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md` — why identity keys on the unique language slug, never the name or a bcp47 prefix.
- `docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md` — set-state-in-effect caveat (benign on mobile React 18; relevant if the compiler is later enabled).
- This learning refines the existing watch-surface selection architecture — `WatchPreferences` (app-wide persistence) and `WatchSession`'s per-dub lazy `videoDub` media fetch — changing only the cold-load label behavior, not the slug-based resolution model.
