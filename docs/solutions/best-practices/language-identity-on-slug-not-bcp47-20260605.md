---
title: "Key language identity on the unique slug, not BCP-47"
date: "2026-06-05"
category: "best-practices"
module: "apps/mobile"
problem_type: "best_practice"
component: "frontend_stimulus"
severity: "high"
applies_when:
  - "Persisting a user's chosen dub/subtitle/UI language across content items or sessions"
  - "Matching a stored language preference against another item's available language options"
  - "Building any cross-content language identity key in apps/mobile, apps/web, or apps/tv"
  - "Tempted to compare or dedupe languages by BCP-47 tag (full or prefix)"
symptoms:
  - "Picking Korean dub re-selected Kurmanji Standard on re-entry (prefix collision ko vs ko-kmr)"
  - "Picking plain English re-selected English North American Indigenous (en vs en-nai)"
  - "Three Kurdish dialects share the full tag kmr, so the first in the array always won"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/web"
  - "apps/tv"
  - "watch-experience"
tags:
  - "language"
  - "bcp47"
  - "i18n"
  - "persistence"
  - "mobile"
  - "watch"
  - "identity"
---

# Key language identity on the unique slug, not BCP-47

## Context

The mobile watch screen persists the user's chosen dub and subtitle language app-wide, so it carries across videos and app restarts instead of resetting to the device-locale default. The first implementation keyed that persistence on the **BCP-47 tag** and re-selected by **prefix match** against the next video's variant list. It silently re-selected the **wrong** language on re-entry:

| User chose                | bcp47 stored | What got re-selected                              | Why                                        |
| ------------------------- | ------------ | ------------------------------------------------- | ------------------------------------------ |
| Korean                    | `ko`         | **Kurmanji Standard** (`ko-kmr`)                  | `ko` prefix-matches `ko-kmr`, listed first |
| English                   | `en`         | **English, North American Indigenous** (`en-nai`) | `en` prefix-matches `en-nai`, listed first |
| any of 3 Kurdish dialects | `kmr`        | the wrong dialect                                 | three distinct languages all carry `kmr`   |

Root cause: **BCP-47 tags are not unique per language** in this data set (confirmed by querying the admin GraphQL `dubs` for one video). They collide by prefix (`ko` ⊂ `ko-kmr`) and even by _full_ tag (`kmr` ×3). A preference keyed on bcp47 can't reliably name _which_ language the user picked — `.find()` returns the first prefix-sibling in the array, so element order makes it look nondeterministic when it is structural.

## Guidance

**Persist and match on the unique language-entity slug (`languageSlug`), compared EXACTLY. Reserve bcp47-prefix matching for the fuzzy device-locale fallback only.**

Store slugs, not tags:

```ts
export type WatchPreferences = {
  audioLanguageSlug: string | null // not audioBcp47
  subtitleLanguageSlug: string | null // not subtitleBcp47
  subtitlesEnabled: boolean
}
```

Match the persisted preference exactly, _before_ any bcp47 step:

```ts
export function resolveDefaultSlug(
  options: LanguageOption[], // { slug, bcp47, languageSlug }
  videoPrimaryBcp47: string | null,
  preferredLanguageSlug?: string | null,
): string | null {
  if (options.length === 0) return null

  // Exact, unique-slug match — never prefix. Outranks device locale.
  if (preferredLanguageSlug) {
    const match = options.find((o) => o.languageSlug === preferredLanguageSlug)
    if (match) return match.slug
  }

  // bcp47 PREFIX matching is correct ONLY below here — fuzzy locale fallback:
  // device locale -> video primary -> English -> first.
  const deviceLang = getDeviceLanguageCode()
  if (deviceLang) {
    const m = matchByBcp47Prefix(options, deviceLang)
    if (m) return m.slug
  }
  // ...
}
```

The option list carries `languageSlug` alongside the per-video variant `slug`, so resolution matches on identity but returns the variant slug the player needs. The preference is **soft**: when no option matches the stored slug (the video lacks that language), resolution falls through the locale → primary → English → first chain, so it still defaults sanely.

## Why This Matters

- **`languageSlug` is the stable, unique language-entity identifier** (`"korean"`, `"kurmanji-standard"`, `"english-north-american-indigenous"`). One language → one slug, globally, across all content. Exact equality on it cannot select a sibling.
- **BCP-47 is a _locale_ tag, intentionally not unique per language.** It encodes regional and script variants and macrolanguages, so distinct languages legitimately share a prefix (`ko` / `ko-kmr`) or a full tag (`kmr` ×3). Using it as a preference identity conflates "what locale family is this" with "which specific language did the user choose."
- **Prefix matching is correct only for fuzzy locale fallback** — "the device says `pt-BR`, give me any Portuguese." Approximate matching is the _desired_ behavior there. It is never correct for re-selecting a _specific_ prior choice, which needs exact identity. The fix keeps prefix matching exactly where it belongs and removes it from the preference path.

This is the **third recurrence** of the bcp47-vs-slug identity bug shape on the watch surface (web video page, then web series page, now mobile) — see Related. Earlier cases were bcp47 _rejecting_ a valid slug and falling back to a default; this one is bcp47 _actively mis-matching_ the wrong language. Same rule: never key language identity on bcp47.

## When to Apply

Any language picker or cross-content language preference (mobile, web, tv): the moment a language choice is stored once and re-applied against a _different_ item's option list, key it on the unique language-entity slug and match exactly. Reserve bcp47/locale-prefix matching for best-effort-from-device-locale fallbacks.

## Examples

**Regression test pattern** — include a collision case where the bcp47 prefix and the `languageSlug` _disagree_, with the prefix-colliding sibling listed FIRST, so any regression to prefix-matching fails:

```ts
// Kurmanji Standard's tag "ko-kmr" shares the "ko" prefix with Korean and is
// listed FIRST — a prefix match would wrongly return it.
const options = [
  langOpt("v-kurmanji", "ko-kmr", "kurmanji-standard"),
  langOpt("v-korean", "ko", "korean"),
]
expect(resolveDefaultSlug(options, "en", "korean")).toBe("v-korean")
```

The deliberate ordering plus the slug/prefix disagreement is the load-bearing guard: without them, a prefix-matching regression could pass vacuously. (This is the same mocked-shape-vs-real-contract discipline noted in the root `CLAUDE.md` — a test only guards a discriminator when there's a case only the correct branch can satisfy.) The suite also covers `en` vs `en-nai` and the soft-fallback path. Verified in the iOS simulator: Korean→Korean, English→English, Amharic subtitle→Amharic survive leave/re-enter and app restart.

## Related

- `../ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md` — web counterpart and prior art. Same thesis ("slug is the stable language identity; bcp47 is for `Intl`/`Accept-Language` internals"), different failure mode (validator _rejects_ a slug rather than prefix-_collides_). This doc is the third entry in that recurrence chain.
- `../logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md` — sibling symptom (watch page shows wrong language), distinct cause; note its selection chain still includes a bcp47 match step, which exact-slug matching should gate before.
- `../best-practices/mobile-video-detail-page-patterns-20260527.md` — same mobile surface; documents the expo-video language _switch_ mechanism. This doc refines how the active language is _identified_.
- `../design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md` — same files (`WatchSessionProvider.tsx`, `normalizeVideo.ts`), orthogonal concern (payload/over-fetch).
