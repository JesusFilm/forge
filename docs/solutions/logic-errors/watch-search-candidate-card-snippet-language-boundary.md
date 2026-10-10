---
title: "Keep Candidate Watch search card copy inside the requested language boundary"
date: "2026-08-17"
category: "logic-errors"
module: "apps/admin Watch Search Candidate presentation"
problem_type: "logic_error"
component: "service_object"
symptoms:
  - "Watch search returned correctly ranked and playable results while card descriptions appeared in unrelated languages"
  - "An English search could display French, Portuguese, or Vietnamese evidence text even though the display and target language were English"
  - "The mismatch occurred across queries because the public snippet preferred retrieval evidence without validating its language"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "Typesense Candidate global recall"
  - "Watch search GraphQL result contract"
  - "apps/web Watch search cards"
tags:
  - "watch-search"
  - "candidate-search"
  - "multilingual-search"
  - "evidence-language"
  - "display-language"
  - "typesense"
  - "snippet"
  - "presentation-boundary"
---

# Keep Candidate Watch search card copy inside the requested language boundary

## Problem

Candidate Watch search could return the correct canonical video,
target-language playback, and rank while exposing a snippet in an unrelated
language. The defect was independent of the query text: any globally recalled
Candidate could carry foreign or unknown-language evidence into the public
card.

## Symptoms

- With English selected, searching `jesus` returned English titles and English
  playback but French, Portuguese, or Vietnamese card descriptions.
- Candidate diagnostics correctly reported the evidence language and target
  availability, so the mismatch looked like bad retrieval even though ranking
  and playback were correct.
- Current search did not show the same presentation mismatch.

## What Didn't Work

- Rebuilding or re-embedding the catalog would not correct the merge boundary
  because the required localized catalog description was already present.
- Hard-filtering Candidate recall by selected language would hide legitimate
  native-language and cross-language title matches, contradicting the global
  recall design.
- Retuning title or semantic scoring would not help because the correct result
  and order had already been selected.
- Changing Web rendering would duplicate a server-owned language decision and
  alter a public frontend that was correctly rendering the GraphQL `snippet`
  field.

## Solution

Keep global retrieval and ranking intact, then enforce a language boundary
while projecting the final public card.

`Candidate` already carries both `snippet` and `evidenceLanguageSlug`
(`apps/admin/src/services/typesense-watch-search.service.ts:233-242`). The new
`candidateCardSnippet` helper returns evidence text only when its language
matches an allowed display or target language; missing, unknown, or unrelated
evidence falls back to the localized catalog description
(`apps/admin/src/services/typesense-watch-search.service.ts:245-258`).

The allowed set is assembled only for the `CANDIDATE` profile from the resolved
display-or-route language and target language
(`apps/admin/src/services/typesense-watch-search.service.ts:1412-1421`). Result
ranking is already complete before this point
(`apps/admin/src/services/typesense-watch-search.service.ts:1375-1401`). The
final projection uses the helper for Candidate and retains the existing
`candidate.snippet ?? locale.description` behavior for Current
(`apps/admin/src/services/typesense-watch-search.service.ts:1423-1442`).

```ts
const allowedLanguageSlugs = new Set([
  displayLanguageSlug ?? routeLanguageSlug,
  targetLanguageSlug,
])

const snippet =
  candidate.snippet != null &&
  evidenceLanguageSlug != null &&
  allowedLanguageSlugs.has(evidenceLanguageSlug)
    ? candidate.snippet
    : localizedDescription
```

The public `evidence` object remains unchanged, including its actual evidence
language (`apps/admin/src/services/typesense-watch-search.service.ts:1462-1475`).
This preserves diagnostics and semantic seek time while preventing retrieval
evidence from silently becoming unrelated display copy.

Regression tests cover known unrelated evidence, unknown evidence, and allowed
target-language evidence. They also pin playback identity, availability, start
time, and the existing two Typesense calls
(`apps/admin/src/services/typesense-watch-search.service.test.ts:1262-1420`).

## Why This Works

Candidate global recall is intentionally broader than one language. That makes
evidence language a retrieval fact, not automatic permission to display the
evidence as card copy. Display language, target/playback language, and evidence
language answer different questions:

- display language chooses the localized catalog copy shown in the UI;
- target language describes what the viewer wants to watch;
- evidence language records which indexed text recalled or ranked the result.

The fix preserves all three facts and adds one rule at their convergence:
evidence may replace localized card copy only when it belongs to the display or
target language. Because this happens after ranking and uses values already in
memory, it adds no Typesense search, database query, embedding, schema field,
index rebuild, or network round trip.

## Prevention

- Treat retrieval evidence as diagnostic content until its language is proven
  suitable for public presentation.
- Fail closed to localized catalog copy when evidence language is null or
  outside the display/target set.
- Keep language guards at the server projection boundary so every consumer
  receives the same safe contract.
- Test known mismatch, unknown language, and intentional target-language
  mismatch separately.
- Pin ranking, playback, semantic start time, availability, and request count
  so a presentation fix cannot accidentally change retrieval or latency.

## Related Issues

- [Combine global exact-title recall with localized Typesense tokenizers](../architecture-patterns/typesense-global-exact-title-recall-with-localized-tokenizers.md)
- [Keep unavailable Watch search evidence separate from playback identity](watch-search-unavailable-evidence-playback-identity.md)
- [Separate Watch Search lexical language from playback language](watch-search-chinese-lexical-playback-language-conflation.md)
- [Watch subtitle-only search results need separate availability and playback languages](watch-search-subtitle-playback-contract.md)
