---
title: "Mobile subtitle preference display + reconciliation contract"
date: "2026-06-25"
category: design-patterns
module: apps/mobile
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Displaying or applying a persisted app-wide preference (language slug + cached name) against content that may not offer it"
  - "A control label must distinguish media-not-loaded-yet from loaded-with-zero-options"
  - "A bare on/off toggle and a deliberate row pick share one handler but must persist differently"
  - "Caption/cue rendering could paint over an un-started poster at t=0"
  - "Series-level options live on lazily-fetched per-dub media, not in the bulk query"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - apps/mobile/src/lib/subtitleSelection.ts
  - apps/mobile/src/lib/seriesSubtitleUnion.ts
  - apps/mobile/src/hooks/useSeriesSubtitleUnion.ts
  - apps/mobile/src/components/watch/VideoPlayer.tsx
  - apps/mobile/src/components/watch/SubtitleSheet.tsx
  - apps/mobile/src/lib/resolveDefaultLanguage.ts
tags:
  - mobile
  - subtitles
  - watch-preferences
  - reconciliation
  - null-vs-empty
  - expo
  - series-detail
  - language-slug
---

# Mobile subtitle preference display + reconciliation contract

## Context

A persisted, app-wide subtitle preference lives in `WatchPreferences` as a
`(subtitleLanguageSlug, subtitleLanguageName, subtitlesEnabled)` triple — a
language _intent_ that flows across every video and series, each with a different
set of subtitle tracks. A run of user-visible bugs on the Series Detail and Video
Detail pages all traced to one mistake: that preference was **shown or applied
verbatim**, without reconciling it against the content actually in front of the user.

- The series Subtitles pill painted "Cantonese" on a series whose episodes only
  carry English/Japanese.
- A genuinely subtitle-less video painted the stale preferred language instead of "Off".
- A VTT cue covering `t=0` rendered over the un-started poster before playback began.
- Flipping the subtitles on/off switch silently overwrote the cross-content
  preferred language with the current item's reconciled fallback.

The building blocks pre-date this work. The `null`-vs-`[]` label distinction was
first introduced to kill a **cold-load placeholder flash** — the Subtitles button
showed a generic "Subtitles" before the lazy `GET_VIDEO_DUB` media landed — and
`subtitleLanguageName` was persisted alongside the slug (guarded by a
`preferencesReady` hydration check) so the label paints instantly on a cold launch
(session history). The video page already reconciled the preference via
`WatchSessionProvider`'s pre-select effect. The bugs were the _series page_ never
replicating that reconciliation, plus the _no-subtitle_, _un-started_, and
_bare-toggle_ edge cases the label/overlay/persistence paths didn't handle. A
supporting constraint underlies the series case: **subtitle options are not in the
bulk series query** — they live on each dub's lazily-fetched media — so a series has
no list of "subtitle languages it offers" without fanning out across episodes
(session history).

## Guidance

### Rule 1 — Reconcile the preference against the content's real tracks before display/apply

The persisted slug is an _intent_, not a guarantee. Resolve it against the actual
option set using the same fallback ladder the video page uses (preferred → device
locale → primary → English → first), so an unsupported pick degrades to a supported
track instead of being shown verbatim. Match the preference **exactly on
`languageSlug`** — bcp47 collides (`ko`/`ko-kmr`, `en`/`en-nai`).

```ts
// resolveDefaultLanguage.ts
export function resolveDefaultSlug(
  options,
  videoPrimaryBcp47,
  preferredLanguageSlug?,
) {
  if (options.length === 0) return null
  if (preferredLanguageSlug) {
    const match = options.find((o) => o.languageSlug === preferredLanguageSlug) // EXACT, not bcp47
    if (match) return match.slug
  }
  // device locale → videoPrimary → "en" → options[0]
}
```

The series replicates the video page's reconciliation against an _episode union_:

```ts
// subtitleSelection.ts
export function reconcileSeriesSubtitleSlug(
  enabled,
  preferredSlug,
  union,
  primaryBcp47,
) {
  if (!enabled || union.length === 0) return null
  const options = union.map((s) => ({
    slug: s.languageSlug,
    bcp47: s.languageBcp47,
    languageSlug: s.languageSlug,
  }))
  return resolveDefaultSlug(options, primaryBcp47, preferredSlug)
}
```

`resolveSeriesSubtitleLabel` then paints from the reconciled slug — and once the
union is known it **never falls back to the cached name**, because that name may
belong to a track the series doesn't carry.

### Rule 2 — `null` (not loaded) vs `[]` (loaded-empty) is load-bearing

The keystone. The label helper's track argument is `WatchSubtitle[] | null`, never a
bare array overloaded as "unknown":

```ts
// BEFORE: [] doubled as "not loaded" → fell back to the cached name, so a
//         no-subtitle video painted the stale preferred language.
// AFTER:
export function resolveSubtitleActionLabel(
  enabled,
  slug,
  subtitles: WatchSubtitle[] | null,
  fallbackName,
) {
  if (!enabled) return "Off"
  if (subtitles == null) return fallbackName // in flight → optimistic cached name
  if (subtitles.length === 0) return "Off" // loaded, zero tracks → "Off"
  return deriveSubtitleLabel(enabled, slug, subtitles) ?? fallbackName
}
```

The caller threads the distinction with `?? null` (not `?? []`) and mutes the pill's
"active" state for a loaded-empty dub:

```ts
// app/watch/[slug].tsx
const subtitleActionLabel = resolveSubtitleActionLabel(
  subtitleEnabled,
  activeSubtitleSlug,
  activeVariantMedia?.subtitles ?? null, // null while the lazy dub media is in flight
  preferredSubtitleName,
)
const subtitlesAvailable =
  activeVariantMedia == null || activeVariantMedia.subtitles.length > 0
const subtitleActive = subtitleEnabled && subtitlesAvailable
```

### Rule 3 — Gate caption rendering on a `hasStarted` latch

The player already carries a `hasStarted` latch (set on the first `isPlaying`,
persists through pauses, resets on remount) that gates the poster. Gate the caption
overlay's source on the same latch, so a cue covering `t=0` can't paint over the
un-started poster:

```ts
// VideoPlayer.tsx — SubtitleOverlay
vttSrc={hasStarted ? subtitleVttSrc : null}
```

### Rule 4 — `isUserSelection` separates toggle from select

Visibility (enabled/disabled) and identity (which language) are orthogonal. A bare
on/off toggle must not persist the (possibly reconciled) active slug as the user's
cross-content preference; only a deliberate row pick does. The shared sheet's
callback gained a third arg so both routes can branch:

```ts
// SubtitleSheet.tsx — onSubtitleChange: (enabled, slug, isUserSelection) => void
const handleToggle = (value) =>
  onSubtitleChange(value, activeSubtitleSlug, false) // toggle → false
const handleSelect = (sub) => onSubtitleChange(true, sub.languageSlug, true) // pick   → true

// app/series/subtitle.tsx
const handleSubtitleChange = (enabled, slug, isUserSelection) => {
  setSubtitlesEnabled(enabled)
  if (!isUserSelection) return // bare toggle → don't touch the cross-content pref
  setPreferredSubtitleLanguage(slug)
  setPreferredSubtitleName(
    slug
      ? (subtitles?.find((s) => s.languageSlug === slug)?.languageName ?? null)
      : null,
  )
}
```

The intent that "the toggle doesn't persist" predated this flag, but the shared
sheet still threaded the active slug into the persist path until `isUserSelection`
made the boundary explicit for **both** the watch and series routes (session history).

### Supporting pattern — Series subtitle union (lazy two-hop fan-out)

Because subtitle options aren't in bulk data, the series builds its option set by
fanning out across episodes. `resolveSeriesSubtitleUnion` is pure with injected
fetchers; the two hops per episode are **variants → dub media → subtitles**, deduped
by `languageSlug`, concurrency-capped, per-episode timeout, abortable:

```ts
async function episodeSubtitles(slug, languageSlug, deps) {
  const variants = await deps.getEpisodeVariants(slug)
  const variant = variants.find((v) => v.languageSlug === languageSlug)
  if (!variant) return [] // language not offered → skip, not error
  const media = await deps.getDubMedia(variant.documentId)
  return media.subtitles
}
// mapWithConcurrency(episodes, 4, withTimeout(..., signal), signal) → first track wins per slug
```

`useSeriesSubtitleUnion` wraps it in a gated, cache-first state machine
(`idle | loading | error | ready`):

- `enabled` gates the fan-out — the detail-page **pill passes `false`** (it only needs
  the union to reconcile _if_ a pref is set), the **picker sheet passes `true`**.
- Apollo `cache-first`, so it reuses the download flow's fetches.
- `subtitles` is `WatchSubtitle[] | null` — `null` feeds Rule 2's not-loaded path directly.
- **All episodes failing → `error` (retry), not an empty union** — distinguishes
  "offline" from "genuinely no subtitles."

This is **Route B**: resolve per-episode only when needed. Route A (extending the lean
series fragment with per-episode dub ids) was rejected — the fragment is shared with
`apps/tv`, every series page load would pay the cost, and the `childDubLanguages`
over-fetch was already a known 2.5–4.9s prod pain point (session history).

## Why This Matters

A persisted _app-wide_ media preference is an **identity** (a language slug), not a
capability claim. It must be **resolved against each content item's actual
capabilities at display and apply time** — never rendered or applied verbatim —
because the same preference flows across videos and series with wholly different
track sets.

Two corollaries make the resolution correct rather than merely present:

1. **Not-loaded vs loaded-empty is load-bearing.** Collapsing `null` and `[]` into one
   "falsy" state is exactly what produced the stale-label bugs. `null` warrants
   optimism (paint the cached name so a cold load isn't blank); `[]` is a fact (zero
   tracks → "Off"). One state type cannot serve both.
2. **Toggle ≠ select.** Visibility and identity are orthogonal axes. Conflating them
   lets an on/off toggle silently rewrite the user's cross-content language choice.

One rejected approach is worth recording: a reviewer proposed **clearing the cached
`subtitleLanguageName` when a dub has no matching track**. It was rejected — the cached
name tracks the _app-wide preference_, not the current dub; clearing it would make the
next subtitle-bearing video flash the placeholder again, regressing the cold-load fix.
The preference is preserved; only its _display_ is reconciled per item (session history).

## When to Apply

Any mobile/TV surface that **shows or applies a persisted media preference against
per-item, lazily-fetched capabilities** — subtitle/caption language (this case), audio
language (same `resolveDefaultSlug` ladder), or any per-content option set that isn't in
bulk data and must be fanned-out + deduped.

The portable checklist:

- (a) reconcile preference → actual options via a shared fallback resolver, matching on
  the unique slug not bcp47;
- (b) model the capability list as `T[] | null`, never overloading `[]` as "unknown";
- (c) on loaded-empty, show the disabled/"Off" state, never a carried-over name;
- (d) gate any media-overlay render on a "has started" latch;
- (e) keep the visibility-toggle and identity-select as separate signals so a toggle
  never mutates the persisted choice.

## Examples

**Cantonese pref on an English/Japanese series → pill shows English.** Persisted pref
is `(cantonese, "Cantonese", enabled)`. The detail page resolves the union
(`{english, japanese}`); `reconcileSeriesSubtitleSlug(true, "cantonese", union, …)` runs
`resolveDefaultSlug`: no `cantonese` match → device-locale/primary/`en` → returns
`english`. The pill paints "English", and the picker's "Current" row uses the same
reconciled slug, so pill and sheet agree. The Cantonese identity is honored where
supported and gracefully substituted where not — the persisted pref is untouched.

**No-subtitle video → "Off" (not the stale name).** The dub media loads with
`subtitles: []`. The caller passes `activeVariantMedia.subtitles ?? null` = `[]` (loaded,
not `null`), so `resolveSubtitleActionLabel(enabled, slug, [], "Cantonese")` hits
`if (subtitles.length === 0) return "Off"`, and `subtitleActive` is muted. Before the
fix, `[]` read as "not loaded" and the function returned the cached `"Cantonese"`,
lying about a video with no subtitles at all.

## Related

- [watch caption language availability](../ui-bugs/watch-caption-language-availability-20260615.md)
  — the `apps/web` precursor of Rule 1 + the "No subtitles" empty state (default caption
  only when the subtitle slug matches the audio slug; never cross-language fallback).
  This doc is the `apps/mobile` generalization; the web doc stays canonical for web-watch.
- [persist display name for cold-load label](./persist-display-name-for-cold-load-label.md)
  — introduced `resolveSubtitleActionLabel`'s `fallbackName` and the persisted
  `subtitleLanguageName` that Rule 2's not-loaded path paints from.
- [language identity on slug not bcp47](../best-practices/language-identity-on-slug-not-bcp47-20260605.md)
  — the source of `resolveDefaultSlug` and the slug-not-bcp47 identity law behind Rules 1 and 4.
- [lean-bulk + lazy per-item GraphQL fetch](./lean-bulk-lazy-per-item-graphql-fetch-20260604.md)
  — the per-dub lazy fetch that makes subtitles cold per navigation and drives the series
  union; its `normalizeDubMedia` loaded-empty `{ subtitles: [] }` is exactly Rule 2's `[]` signal.
- [Apollo InMemoryCache frozen-array sort crash](../runtime-errors/apollo-inmemorycache-frozen-array-sort-crash-20260616.md)
  — when merging/sorting cached track arrays in the union, clone first (`[...arr].sort()`).
