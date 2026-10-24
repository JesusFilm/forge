---
title: "A nullable language slug coerced to an empty string reads as nothing-selected downstream"
date: "2026-08-13"
module: apps/mobile
problem_type: logic_error
category: logic-errors
component: frontend_stimulus
severity: medium
symptoms:
  - "Selecting French subtitles shows the row as active but no captions ever appear"
  - "The failure emits no error, no warning, and no Datadog event, so no query can find it after the fact"
  - "SubtitleOverlay clears its cues and returns ahead of every subtitle.vtt_failed logging path"
  - "The subtitle control still names the language, because its label matches the track by exact equality while the player guard rejects the same key as falsy"
  - "Every other language on the same video renders captions correctly"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - "apps/mobile/src/lib/normalizeVideo.ts"
  - "apps/mobile/src/components/watch/SubtitleSheet.tsx"
  - "apps/mobile/src/components/watch/SubtitleOverlay.tsx"
  - "apps/mobile/app/watch/[slug].tsx"
  - "apps/mobile/src/lib/subtitleSelection.ts"
tags:
  - mobile
  - subtitles
  - watch-player
  - nullable-field
  - falsy-coercion
  - language-slug
  - silent-failure
---

# A nullable language slug coerced to an empty string reads as nothing-selected downstream

## Problem

A user turned on French subtitles for the video `considering-christmas` in the
mobile watch player. The subtitle control showed "French". The French row in the
subtitle sheet showed as the selected row. No captions appeared. The app wrote no
error, no warning, and no Datadog event.

The app offered a subtitle track that it could never resolve, and then showed the
name of that track as the active selection. Two independent defects made this
possible: the app kept an item it could not key, and the same key was read as a
value by some code and as an absence by other code.

**Scope — production content does not carry this data shape.** A direct query to
`https://admin.jesusfilm.org/api/graphql` on 2026-08-13 returned 144 subtitle
tracks for this video, and every one of them has a language slug. Zero are null.
The null slug exists only in the local development database, where the same query
returned 156 tracks across 13 of that video's 14 dubs — twelve tracks per dub,
exactly one of which is a null-slug French track. So no user of a released build lost captions
because of this. The defect is that the app treats a permitted data shape as
impossible, and admin's schema permits that shape in any environment at any time:
`apps/admin/schema.graphql:386` declares `slug: String`, which is nullable. The
Prisma source agrees — `apps/admin/prisma/schema.prisma:1321` declares
`slug String? @unique`, so the slug is unique **when present** and absent is a
legal state, not a data accident.

### The causal chain

1. **Admin's `Language.slug` is nullable** — `apps/admin/schema.graphql:386`.
   The mobile dub query selects it at `apps/mobile/src/lib/queries.ts:406`, inside
   the `WatchDubMedia` fragment (`queries.ts:393-416`). A real French track on
   `considering-christmas` returns `language.slug: null` with a valid `vttSrc`.

2. **The normalizer coerced the null to an empty string and kept the track.** The
   pre-fix filter in `normalizeDubMedia` accepted any track with a non-null
   `language` object, and the mapper then wrote
   `languageSlug: s.language?.slug ?? ""` (`apps/mobile/src/lib/normalizeVideo.ts:235`).
   `WatchSubtitle.languageSlug` is typed `string`, not `string | null`
   (`normalizeVideo.ts:16-24`), so the coercion is what the type demands. The
   result is a list item whose identity key is `""`.

3. **The picker uses that key as the selection id.**
   `apps/mobile/src/components/watch/SubtitleSheet.tsx:15` defines
   `const getSelectionId = (s: WatchSubtitle) => s.languageSlug`, and the row tap
   at `SubtitleSheet.tsx:64` calls `onSubtitleChange(true, sub.languageSlug, true)`.
   Choosing French therefore set the session's `activeSubtitleSlug` to `""`
   (`apps/mobile/src/contexts/WatchSessionProvider.tsx:145`).

4. **The watch route read `""` as "nothing selected".** The memo at
   `apps/mobile/app/watch/[slug].tsx:236-253` opens with
   `if (!subtitleEnabled || !activeSubtitleSlug || !activeVariantMedia) return null`
   (`[slug].tsx:241`). An empty string is falsy, so a genuine user selection took
   the same branch as "the user has chosen nothing". `subtitleVttSrc` became
   `null`, and `resolveActiveSubtitle` at `[slug].tsx:244` never ran.

5. **The overlay's early return sits ahead of every log line.**
   `apps/mobile/src/components/watch/SubtitleOverlay.tsx:126-130` clears the cues
   and returns as soon as `vttSrc` is falsy. Every failure log in that effect —
   `datadogLog.warn("subtitle.vtt_failed", …)` at lines 139, 148, 154, 168, 188
   and 194 — sits after that return. The one failure mode that produced no
   request at all was therefore the one failure mode that produced no telemetry.

6. **The control still showed "French" because the label reads the same list
   through a different test.** `resolveActiveSubtitle` matches by equality —
   `subtitles.find((s) => s.languageSlug === slug)` at
   `apps/mobile/src/lib/subtitleSelection.ts:14` — and `""` equals `""`, so the
   French track matched and `deriveSubtitleLabel` (`subtitleSelection.ts:22-29`)
   returned its name. The sheet marked the same row as active for the same reason:
   `apps/mobile/src/lib/sheetListLogic.ts:44-45` finds the active row with
   `getSelectionId(item) === activeId`.

   `resolveSubtitleActionLabel` does hold a second, cached source — it returns the
   persisted `fallbackName` while the dub media is still in flight
   (`subtitleSelection.ts:39-49`, the fallback at line 46 and again at line 48).
   That path could not have produced "French" here, because the `""` slug never
   reached the preference store. Two truthiness tests block it:
   `WatchSessionProvider.tsx:149` persists with
   `if (slug) setPreferredSubtitleLanguage(slug)`, and the re-apply effect at
   `WatchSessionProvider.tsx:313` opens with
   `if (!preferencesReady || !preferredSubtitleSlug || !activeVariantMedia)`.
   Both reject `""`. So the label the user saw came from the list itself, by an
   equality match, while the player's source came from the same list through a
   truthiness guard that refused it.

The one empty string is read as a valid key by some call sites
(`subtitleSelection.ts:14`, `sheetListLogic.ts:45`, `sheetListLogic.ts:56`,
`resolveDefaultLanguage.ts:44`) and as an absent value by others
(`[slug].tsx:241`, `[slug].tsx:225`, `WatchSessionProvider.tsx:149`,
`WatchSessionProvider.tsx:313`, `SubtitleOverlay.tsx:126`,
`resolveDefaultLanguage.ts:43`). Both readings are locally correct. The
disagreement between them is the bug.

Those are the watch path only. The same key has roughly as many readers again on
the series and offline surfaces — `downloadUrlResolution.ts:73-74`,
`apps/mobile/app/series/subtitle.tsx:41-42`, `seriesSubtitleUnion.ts:73-74`,
`apps/mobile/app/series/download.tsx:153-156`, and `offlineFiles.ts:67`, where the slug
becomes a path segment. Counting predicate locations, about seventeen sites read
this one key, split between the two tests.

## Symptoms

- The subtitle control named a language while no captions appeared.
- The subtitle sheet marked the chosen row as active, and the choice looked
  accepted, but playback never changed.
- The failure produced no error, no warning, and no Datadog event, so no query
  could find it after the fact.
- The same video worked correctly in every other language.
- The selection did not survive a return to the sheet through the preference
  store, because the persistence guard rejected the same empty string.

## What Didn't Work

Two plausible explanations were ruled out by evidence before the code was read.
Neither was the cause, and each cost a step.

- **"The subtitle content is broken."** Ruled out by fetching the French VTT URL
  directly. It returns HTTP 200 with 2,753 bytes of valid `WEBVTT` and real
  French cues. The asset is healthy. The app never requested it.
- **"The subtitle pipeline is broken."** Ruled out by turning on English
  subtitles for the same video in the same session. Captions rendered correctly.
  Fetch, parse, cue timing and overlay all work. That isolated the failure to a
  property of the French track, not to the feature.

One repair was considered and rejected: **synthesize a fallback key** for a track
that has no slug, for example from BCP-47 or from the track's `documentId`. This
was rejected on two grounds.

- A subtitle key must be stable across dubs and across app launches, because the
  persisted preference maps one choice onto every other video. BCP-47 cannot
  carry that load. [language identity on slug not bcp47](../best-practices/language-identity-on-slug-not-bcp47-20260605.md)
  is the governing rule here: BCP-47 tags collide, `ko` against `ko-kmr` and `en`
  against `en-nai`, and three Kurdish dialects share `kmr`. `documentId` is
  per-record, so it is not stable across dubs either.
- Production does not produce this shape. Inventing a keying scheme for a data
  shape that production does not emit adds a permanent, untestable surface to
  buy a track that no released build has ever been offered.

## Solution

Drop the track at the normalizer boundary. `normalizeDubMedia` now keeps only a
subtitle it can key — `apps/mobile/src/lib/normalizeVideo.ts:228-232`:

```ts
subtitles: (raw.videoEdition?.subtitles ?? [])
  // Admin's Language.slug is nullable. A slug-less track can't be keyed —
  // it collapses to "", which is falsy, so a genuine pick reads downstream
  // as "nothing selected" and shows no captions under its own name.
  .filter((s) => s.vttSrc != null && !!s.language?.slug)
```

The previous predicate was `s.vttSrc != null && s.language != null`. It tested
that the language OBJECT exists. It did not test that the language carries the
one field the app uses as identity.

The regression test is `apps/mobile/src/lib/__tests__/normalizeVideo.test.ts:485`,
"drops a subtitle whose language has no slug". It builds a dub with two tracks —
an ordinary English track, and a French track shaped exactly like the real row
(`language: { slug: null, name: { en: "French" }, bcp47: "fr" }` with a real
`vttSrc`, test lines 497-503) — and asserts
`expect(media.subtitles.map((s) => s.languageSlug)).toEqual(["english"])` at
line 508. The comment at lines 480-484 records where the row was observed and the
whole downstream mechanism, so a later reader cannot mistake the case for
defensive padding. That comment names the video and the date but not the
environment; the row was seen in the local development database, as the Scope
paragraph above records.

The test was falsified against the fix. With the filter reverted to
`s.vttSrc != null && s.language != null`, the case fails and reports the received
value as `["english", ""]` — the empty-string key itself, visible in the failure
output. With the fix in place, it passes.

The change ships in PR #1927 (`fix/mobile-watch-player-chrome`), which is open
and not yet merged at the time of writing. The subtitle fix is one line plus its
comment; the rest of that PR reworks the watch player chrome.

## Why This Works

The app has exactly one honest option for an item it cannot key, and that is to
not offer the item. Every other option needs the app to invent an identity, and
an invented identity has to be stable across dubs and launches to be worth
anything.

The deeper reason the fix belongs in the normalizer, and not in the guard at
`[slug].tsx:241`, is that the normalizer is the only place with one owner.
`WatchSubtitle.languageSlug` is typed `string`, so the type system tells every
consumer that the key is always present. About seventeen call sites read that
key, across the watch, series and offline surfaces. Patching the one guard that
noticed the problem would leave every other consumer still holding an item whose
key means two different things, and it would leave the sheet still able to offer
a row that resolves to nothing. Enforcing the
invariant where the type is constructed makes the type honest again: every
element of `VariantMedia.subtitles` can be selected, and selecting it works.

Dropping the track also removes the silent-failure surface without adding a log.
There is no new "unusable track" warning to route, because there is no longer a
moment where the app holds an unusable track and has to decide what to say about
it. The remaining `subtitle.vtt_failed` warnings continue to cover the failure
modes that involve a real request.

## Prevention

**Never coerce a nullable IDENTITY field to a falsy sentinel.** The coercion
itself is not the problem. `normalizeVideo.ts` uses `?? ""` at more than twenty
sites, and on a display string or a URL it is harmless — lines 237, 239, 240,
308 and 341 are names and image URLs, and nothing downstream keys on them.

The rule applies to the subset of fields a later consumer uses as a key: a
selection id, a map key, a persisted preference, a path segment. For those, a
missing value must drop the record at the boundary, not travel as `""`. Several
sites in this same file still coerce a field that IS used as a key, and they are
the same latent defect on a field that has not yet met a null:

- `:234` `documentId: s.documentId ?? ""` becomes a React list key —
  `SubtitleSheet.tsx:16` reads it as `getKey`, and `SearchableListSheet.tsx:128`
  passes that to `keyExtractor`.
- `:223` `documentId: d.documentId ?? ""` is a persisted re-resolution identity:
  `downloadUrlResolution.ts:48` matches a stored download by
  `d.documentId === desired.renditionDocumentId`.
- `:322` `documentId: child.documentId ?? ""` feeds `dedupeByDocumentId`
  (`:328`), whose `Set` at `:196-201` would silently drop the second of two
  null-documentId siblings — this bug's exact shape, one field over.
- `:278` `slug: v.slug ?? ""` is matched by `findIndex` at
  `WatchSessionProvider.tsx:267`, and `:364-365` feed a route path segment and
  `buildWatchShareUrl`.

None of these has produced a defect, because no null has arrived on those
fields. That is the only thing separating them from the subtitle bug.

**When you must decide "present or absent", pick one test and use it
everywhere.** This bug is the disagreement between `=== slug` and `!slug` over
the same value. Either test alone is defensible. Reading a key through both is
what let the UI report one state while the player was in another. If a value can
be an empty string, a truthiness guard is a bug waiting for the data.

**Check where the label comes from, not only where the value comes from.** A
control that names the active selection should derive its label from the same
resolution that produces the effect. Here both read the same array, but through
different absence tests, so the label survived a resolution that the player had
already refused. Any surface that can display a name for a value it did not
successfully use can assert a state that is not true.

**Put the early return after the logging, or log at the early return.** The
`if (!vttSrc)` return at `SubtitleOverlay.tsx:126` is correct — an unset source
is a normal state, and it must not warn. That is exactly why the one abnormal
path that also produced a falsy `vttSrc` became invisible. When a guard collapses
a normal state and a fault into the same branch, the fault has to be excluded
upstream, because the guard itself can never tell them apart.

**Look for the same guard on sibling paths.** The identical defence already
existed in this very file: `buildLanguages` skips a blank slug with
`if (slug == null || slug === "" || seen.has(slug)) continue`
(`normalizeVideo.ts:415`), and its test, "drops an empty-string language slug
from the union" (`normalizeVideo.test.ts:1025-1035`), has been green since
PR #1162 on 2026-06-08. It is not even the only one: `seriesSubtitleUnion.ts:73`
also skips a slug-less track with `if (sub.languageSlug && …)`, which is why the
series subtitle sheet could never have offered the French row, and why the
unguarded `setPreferredSubtitleLanguage(slug)` at `apps/mobile/app/series/subtitle.tsx:38`
never persisted a `""`.

So two sibling paths were protected for two months while the per-dub subtitle
path was not, and each protection made the gap harder to see. A correct guard on
one path reads as coverage of the concern; it is not. When you add a guard for a
nullable upstream field, grep every other consumer of that field — the sibling
that already looks handled is the one that hides the hole.

**Trace where the sentinel would have travelled next.** The empty string had a
second destination that had not been reached yet. The download sheet resolves the
track to bundle by equality (`apps/mobile/app/watch/download.tsx:55-58`) and
writes `subtitleLanguageSlug: activeSubtitle?.languageSlug ?? null`
(`download.tsx:71`), so `""` would round-trip into the offline manifest as `""`,
not as `null`. The offline reader then tests it for truthiness at
`apps/mobile/app/watch/[slug].tsx:225`. A user who downloaded that video with
French active would have got the subtitle bundled and then never shown, offline,
with the same silence. The fix closes both surfaces because it closes the source.

**Isolate by working instance.** The fastest step in this diagnosis was turning
on English on the same video in the same session. One working instance of the
same feature converts "subtitles are broken" into "this one item is broken", and
it eliminates the whole pipeline — fetch, parse, timing, render — in a single
observation. Do it before reading code. Then query the data source directly for
the failing item and compare its fields against a working sibling. Here that
comparison produced the answer in one line: French was the only track of the
dub's twelve with a null slug.

## Related

- [language identity on slug not bcp47](../best-practices/language-identity-on-slug-not-bcp47-20260605.md)
  — the governing law this fix follows. It covers slug **collision** (BCP-47 tags
  are not unique); this doc covers slug **absence**. A reader who fully absorbed
  that doc would still have written `?? ""`, because it states the slug is unique
  without stating it can be missing.
- [mobile subtitle preference reconciliation contract](../design-patterns/mobile-subtitle-preference-reconciliation-contract.md)
  — its Rule 2 is the nearest prior instance of the same anti-pattern: collapsing
  `null` (not loaded) and `[]` (loaded, empty) into one falsy state. That is this
  bug one layer up, on the `subtitles` array instead of a scalar key inside a
  track.
- [lean bulk, lazy per-item GraphQL fetch](../design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md)
  — introduced `normalizeDubMedia` and its original filter predicate.
- [admin JSONB locale map vs Strapi string silent drop](../integration-issues/admin-jsonb-locale-map-vs-strapi-string-silent-drop-20260515.md)
  — the same meta-lesson in another app: a loosely-typed admin field needs an
  explicit presence check at the normalization boundary, never an implicit
  coercion.
