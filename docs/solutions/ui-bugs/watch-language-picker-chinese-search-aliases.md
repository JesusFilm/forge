---
title: "Bind Watch language-picker aliases to exact public slugs"
date: "2026-08-17"
last_updated: "2026-08-17"
category: "ui-bugs"
module: "apps/web/watch"
problem_type: "ui_bug"
component: "frontend_stimulus"
severity: "medium"
symptoms:
  - "Available Watch languages looked missing when users searched with familiar Chinese names such as 普通话, 粤语, 简体中文, or 繁體中文."
  - "The global, playable-audio, and subtitle pickers had no shared way to resolve those terms without widening their available options."
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/web/src/components/watch/LanguageCombobox.tsx"
  - "apps/web/src/components/watch/GlobalLanguagePickerModal.tsx"
  - "apps/web/src/components/watch/LanguagePickerModal.tsx"
  - "apps/web/src/lib/watch-language-search-aliases.ts"
tags:
  - "watch"
  - "language-picker"
  - "chinese"
  - "search-aliases"
  - "language-slug"
  - "bcp47"
  - "audio"
  - "subtitles"
---

# Bind Watch language-picker aliases to exact public slugs

## Problem

The shared Watch language combobox searched display names and native names, but
familiar Chinese terms such as `普通话`, `粤语`, and `繁體中文` were not always
present in those labels. A real option could therefore look missing even though
it was available in the current picker.

Adding aliases was not only a text-search problem. The global picker, audio
picker, and subtitle picker each own a different availability list, and an alias
must never turn an absent language into a selectable result.

## Symptoms

- Searching a familiar Chinese language name could return no result while the
  corresponding public language slug was present.
- A shared alias implementation could accidentally imply that an unavailable
  audio or subtitle language was playable.
- BCP-47 and legacy URL aliases looked reusable, but neither has the semantics
  needed to identify the exact language that owns a human search term.

## What Didn't Work

- **Inferring identity from BCP-47:** related Forge Languages may share a locale
  tag or prefix. BCP-47 can support locale-sensitive display and tokenization,
  but it cannot prove alias ownership.
- **Reusing legacy URL aliases:** `language-aliases.ts` canonicalizes historical
  path segments. A routing alias is not searchable user vocabulary.
- **Enabling aliases for every combobox:** `LanguageCombobox` has consumers that
  are outside this feature. Global behavior would silently broaden unrelated
  pickers.
- **Building results from the alias table:** that would make aliases a second
  availability source and could manufacture audio or subtitle choices.

## Solution

### Store reviewed aliases under exact slugs

`WATCH_LANGUAGE_SEARCH_ALIASES` is a small leaf table keyed by exact public
language slug. The code explicitly rejects BCP-47 family inference and requires
review before a new language identity becomes searchable
(`apps/web/src/lib/watch-language-search-aliases.ts:8-48`). The same module
publishes the normalized exact-alias vocabulary and returns an empty list for an
unknown slug (`apps/web/src/lib/watch-language-search-aliases.ts:50-69`).

`中文` is intentionally a broad discovery term, but its members remain an
explicit reviewed group of 19 exact slugs
(`apps/web/src/lib/watch-language-search-aliases.ts:15-48`). The frontend does
not maintain a popularity or "common Chinese" order for that group. Exact slug
ownership controls eligibility, direct display-name and native-name matches rank
before supplemental alias-only matches, and backend or caller order resolves
same-tier ties. A structural test asserts the complete 19-slug membership, so a
later edit cannot silently add or omit a language
(`apps/web/src/lib/watch-language-search-aliases.test.ts:24-68`). `台語` and
`臺語` remain unmapped because Taiwan Mandarin and the available Hokkien slugs
do not accurately represent that request
(`apps/web/src/lib/watch-language-search-aliases.test.ts:70-76`).

Native names remain owned by Core language metadata. The alias table does not
fill a missing visible subtitle: when Core has no native name, the picker shows
no native-name subtitle. Search synonyms and canonical language metadata stay
separate, so Web does not invent content that should be curated upstream.

### Make alias matching opt-in

`searchAliasAuthority` is optional on the shared combobox
(`apps/web/src/components/watch/LanguageCombobox.tsx:34-61`). Production passes
the authority only to:

- the global Watch language picker
  (`apps/web/src/components/watch/GlobalLanguagePickerModal.tsx:312-324`);
- the playable-audio picker
  (`apps/web/src/components/watch/LanguagePickerModal.tsx:795-803`); and
- the subtitle picker
  (`apps/web/src/components/watch/LanguagePickerModal.tsx:962-970`).

Consumers that omit the prop retain the previous display-name and native-name
search behavior.

### Filter only the caller's options

The combobox starts with its supplied `options`, computes a match tier for each
one, removes non-matches, and sorts the remaining entries. It never constructs
an option from alias metadata
(`apps/web/src/components/watch/LanguageCombobox.tsx:249-275`).

This preserves each surface's authority:

- audio options come only from playable variants
  (`apps/web/src/components/watch/LanguagePickerModal.tsx:304-320`);
- subtitle options come only from supplied subtitle tracks, plus an existing
  disabled context row (`apps/web/src/components/watch/LanguagePickerModal.tsx:429-501`);
- the global picker continues to use its loaded public-language options.

### Keep exact aliases strict and partial aliases lower-ranked

When the query exactly equals a configured alias, only a non-disabled supplied
option whose exact slug owns that alias is eligible. Direct display/native-name
matches then rank before supplemental alias-only matches, while backend or
caller order breaks same-tier ties. This prevents a BCP-47-derived label or
unavailable context row from bypassing the authority
(`apps/web/src/components/watch/LanguageCombobox.tsx:120-150`).

For partial queries, existing direct-name tiers remain `0..2`, alias tiers are
shifted to `3..5`, and original option order breaks ties. Direct display or
native-name matches therefore continue to rank before alias-only matches
(`apps/web/src/components/watch/LanguageCombobox.tsx:135-150`,
`apps/web/src/components/watch/LanguageCombobox.tsx:249-275`).

## Why This Works

The fix separates three authorities:

1. the exact public slug identifies a Forge Language;
2. BCP-47 supports locale behavior but is not a unique language identity; and
3. the caller's option list says what that picker can currently offer.

Aliases improve discovery without changing option values, submitted slugs,
playback routing, subtitle routing, or availability. The same term may find a
language globally, find it in the audio picker only when a playable variant
exists, and find it in the subtitle picker only when that subtitle exists.

## Prevention

- Bind any new search synonym to a reviewed exact public slug. Do not infer
  ownership from a BCP-47 prefix, locale family, geography, or script.
- Keep search vocabulary separate from URL-canonicalization aliases, visible
  translated UI copy, and Core-owned native names. Do not use search metadata
  to fill a missing native-name subtitle.
- Apply alias matching only to the intended consumers, and always filter the
  options already supplied by the caller.
- Test a real selectable result and the matching unavailable case. An earlier
  review found that the positive audio case alone did not prove the availability
  boundary (session history); the final player tests now prove that `粤语` finds
  Cantonese only when playable Cantonese audio is present and returns no row
  when it is absent
  (`apps/web/src/components/watch/LanguagePickerModal.aliases.test.tsx:147-231`).
- Keep a collision fixture in which an unconfigured `zh`-family option has a
  BCP-47-derived native label but cannot enter an exact `中文` result
  (`apps/web/src/components/watch/LanguageCombobox.aliases.test.tsx:125-159`).
- Protect ranking and stable order with both partial-alias and broad-`中文`
  cases. The broad-query test proves a direct `中文` native-name match ranks
  first, while supplemental alias-only owners preserve backend or caller order
  (`apps/web/src/components/watch/LanguageCombobox.aliases.test.tsx:84-239`).
- Keep non-Chinese regression coverage. Russian native-name search still uses
  the original direct matching path
  (`apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx:1359-1369`).

## Related Issues

- [Key language identity on the unique slug, not BCP-47](../best-practices/language-identity-on-slug-not-bcp47-20260605.md)
  establishes the governing language-identity rule.
- [Chinese Watch search lexical/playback language conflation](../logic-errors/watch-search-chinese-lexical-playback-language-conflation.md)
  applies the same identity separation to Admin content search.
- [Watch caption language availability](watch-caption-language-availability-20260615.md)
  documents the matching subtitle-availability boundary.
- GitHub issue
  [#1897](https://github.com/JesusFilm/forge/issues/1897) is a distinct
  localized topic-card search bug, not the language-picker alias defect.
