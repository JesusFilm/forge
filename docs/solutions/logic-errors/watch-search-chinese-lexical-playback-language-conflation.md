---
title: "Separate Watch Search lexical language from playback language"
date: "2026-08-06"
category: "logic-errors"
module: "apps/admin Watch Search"
problem_type: "logic_error"
component: "service_object"
symptoms:
  - "A Simplified Chinese search for Jesus returned two unrelated semantic-only videos instead of the canonical JESUS film."
  - "The Typesense title and metadata lanes returned no lexical candidates even though the Chinese JESUS titles were indexed."
  - "A unit fixture passed because it used the Mandarin playback slug as if it were also the localized title slug."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "typesense-watch-search"
  - "search-language-resolution"
  - "testing-framework"
tags:
  - "watch-search"
  - "typesense"
  - "chinese"
  - "language-identity"
  - "lexical-search"
  - "mandarin"
  - "i18n"
  - "testing"
---

# Separate Watch Search lexical language from playback language

## Problem

Modern Watch Search treated the resolved playback language as the identity of
the localized text it should query. For a Han-script search, playback correctly
targeted `mandarin-china`, but the canonical JESUS titles were indexed under
`chinese-simplified` and `chinese-traditional`, so an exact language-identity
filter removed the best lexical result before ranking.

## Symptoms

- Searching `耶稣` returned two weak semantic results and omitted the canonical
  JESUS film.
- The title and metadata lanes were empty even though the lexical collection
  contained `耶稣` and `耶穌`.
- The request used English query fields or a `mandarin-china` identity, while
  the indexed title documents used exact Chinese localization slugs.

## What Didn't Work

- Retuning semantic ranking could not recover a title document excluded by the
  lexical filter.
- Broadening identity through `locale:zh` would conflate tokenizer
  configuration with Forge language identity and admit ambiguous rows.
- Changing the index was unnecessary because the projection already stored
  exact localized titles correctly.
- The original Chinese unit fixture was false-positive coverage: it used
  `mandarin-china` for both localization and audio, so it could not represent
  production.

## Solution

Represent query-script lexical context separately from playback targeting. Han
script now supplies a `zh` tokenizer and the exact localization slugs while
retaining `mandarin-china` as the playback target
(`apps/admin/src/services/search-language-resolution.ts:85-92`).

```ts
{
  targetLanguageSlug: "mandarin-china",
  lexicalContext: {
    tokenizerLocale: "zh",
    languageSlugs: ["chinese-simplified", "chinese-traditional"],
  },
}
```

The service uses that lexical context only when the script-inferred target
agrees with the resolved target
(`apps/admin/src/services/typesense-watch-search.service.ts:706-715`). This
target-consistency guard preserves Chinese queries with inferred or explicit
Mandarin playback without forcing a Kanji-only Japanese query into Chinese
lexical identities.

Exact slugs become the Typesense filter and `zh` only selects the tokenizer
fields (`apps/admin/src/services/typesense-watch-search.service.ts:716-748`).
The index projection already enforces the same boundary:
`typesenseWatchLanguageIdentity` prefers the safe exact slug, while
`typesenseWatchTokenizerLocale` derives the two-letter field suffix
(`apps/admin/src/services/typesense-watch-search-lexical.ts:49-70`).

Production-shaped service fixtures now keep three facts distinct:

- localized title identity: `chinese-simplified` or `chinese-traditional`;
- tokenizer field: `title_zh` / `metadata_zh`;
- playable audio identity: `mandarin-china`.

The tests assert the full Typesense filter and hydrated Mandarin playback for
both Chinese forms
(`apps/admin/src/services/typesense-watch-search.service.test.ts:501-580`).
They also pin English text with Mandarin playback (`:582-636`) and Kanji-only
Japanese text with Japanese playback (`:638-690`).

## Why This Works

Search text language and playback language answer different questions. The
lexical context selects which localized document can contain the query and
which tokenizer should process it. The target language selects which Dub or
subtitle hydration should prefer. Carrying both values preserves the
information needed at each boundary instead of overloading one slug.

Exact Forge slugs remain the identity boundary, so the request matches the
projection without relying on non-unique BCP-47 values. The target-consistency
guard also handles the fact that Han characters are shared across Chinese and
Japanese: a script heuristic may provide a fallback, but it does not override a
stronger resolved target.

## Prevention

- Model localized-text identity, tokenizer locale, semantic evidence language,
  and playback target as separate concepts in multilingual search code.
- Use exact `Language.slug` values in Typesense facets. Use BCP-47 only for
  tokenizer and locale behavior.
- When a script heuristic contributes lexical context, bind it to the resolved
  language decision so it cannot override explicit user intent.
- Build regression fixtures from the real producer shape. A fixture must use
  different values for Chinese title localization and Mandarin audio, or it
  cannot catch this defect.
- Assert request construction and user-visible hydration together: tokenizer
  fields, exact identity filter, canonical result, and playback language.
- Do not rebuild a correct index to compensate for a request-time routing bug.

## Related Issues

- [Key language identity on the unique slug, not BCP-47](../best-practices/language-identity-on-slug-not-bcp47-20260605.md)
- [Preserve canonical language identity and ranking precision in Watch search](canonical-language-boundaries-and-lexicographic-search-ranking.md)
- [Mocked-shape-vs-real-contract testing discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
- [Precomputed hybrid search serving index](../best-practices/precomputed-hybrid-search-serving-index-20260803.md)
