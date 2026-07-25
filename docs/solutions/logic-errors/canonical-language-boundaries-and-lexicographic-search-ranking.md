---
title: "Preserve canonical language identity and ranking precision in Watch search"
date: "2026-07-23"
category: "logic-errors"
module: "apps/web and apps/admin Watch search"
problem_type: "logic_error"
component: "service_object"
severity: "high"
symptoms:
  - "The exact-title JESUS film did not reliably rank first for the query Jesus"
  - "Equivalent language identities such as en and english produced different availability and lexical-search behavior"
  - "Candidates with different raw relevance could collapse into the same displayed score and be reordered by availability or result ID"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/web"
  - "apps/admin"
  - "testing_framework"
tags:
  - "watch-search"
  - "language-identity"
  - "bcp47"
  - "exact-title"
  - "ranking"
  - "relevance"
  - "watchability"
  - "determinism"
---

# Preserve canonical language identity and ranking precision in Watch search

## Problem

The public Watch search and Admin search debugger could disagree about whether the exact-title `JESUS` film appeared first for the query `Jesus`. The request crossed Web and Admin using multiple representations of language identity, then ranked candidates through an additive score whose public rounding and cap erased distinctions needed for the final order.

## Symptoms

- The exact-title film could rank first in one request and disappear from the first page in another.
- `en` and `english` could describe the same language to a person but take different server paths for target-language availability.
- A deterministic result-ID tie-break decided among candidates that product relevance should have distinguished.

## What Didn't Work

- **Fixing availability alone.** Canonicalizing `en` to `english` repairs the watchability signal, but it does not state that a whole-title match outranks a title that merely contains the query.
- **Uncapping the additive score.** This keeps more numerical separation but still lets unrelated concerns trade against each other. A sufficiently large availability bonus could outrank a better textual result, and the meaning of the public score would change.
- **Treating result ID as a relevance rule.** An ID is useful only as a final deterministic tie-break. It has no relationship to what the user meant.

## Solution

### 1. Canonicalize language signals at both boundaries

Web now passes the actual UI locale separately from the selected search target. It derives the display-language slug from that UI locale and forwards only validated public route slugs (`apps/web/src/lib/search-actions.ts:92-172`). The search controller supplies `useLocale()` for both initial and paginated requests (`apps/web/src/components/FloatingSearchController.tsx:102-106`, `apps/web/src/components/FloatingSearchController.tsx:446-456`, `apps/web/src/components/FloatingSearchController.tsx:567-577`).

Admin resolves each incoming signal against the Language table. It prefers an exact case-insensitive slug, then performs progressively less-specific BCP-47 lookup, and accepts a BCP-47 match only when it identifies one unique slug (`apps/admin/src/services/search-language-resolution.ts:75-121`). Source precedence remains explicit target, query-named language, current Watch language, route, display language, `Accept-Language`, then English fallback (`apps/admin/src/services/search-language-resolution.ts:267-293`).

The resolver also carries the canonical Language row's BCP-47 value for lexical retrieval. That prevents a canonical product slug such as `german-standard` from falling back to English when the SQL retriever needs locale `de` (`apps/admin/src/services/search-language-resolution.ts:123-139`, `apps/admin/src/services/watch-search.service.ts:329-368`).

```ts
const displayLocale =
  localeForLanguageSlug(language.displayLanguageSlug) ??
  language.displayLanguageBcp47 ??
  localeForLanguageSlug(language.routeLanguageSlug) ??
  language.routeLanguageBcp47 ??
  "en"
```

### 2. Rank with an explicit lexicographic tuple

The final comparator now expresses product intent directly:

```text
(whole-title match desc,
 raw relevance desc,
 watchability rank asc,
 result ID asc)
```

Whole-title equality is computed from normalized query and title text. Raw, unrounded relevance is retained for ordering; the rounded score breakdown remains available for the public response and observability (`apps/admin/src/services/watch-search.service.ts:561-594`, `apps/admin/src/services/watch-search.service.ts:1270-1311`).

This means:

1. `JESUS` beats `Nicodemus and Jesus` because whole-title match is the first key.
2. Among candidates with the same match class, stronger textual relevance wins.
3. Watchability improves the order only after textual intent ties.
4. Result ID makes truly equivalent candidates stable; it never substitutes for relevance.

## Why This Works

The failure had two information-loss points. First, treating locale codes and product slugs as interchangeable could lose the canonical language entity before availability hydration. Second, adding, capping, and rounding score components could lose the relevance distinctions before sorting.

The fix preserves each type of information until its proper decision point. Canonical slug identity drives language and availability logic; BCP-47 remains a locale attribute for lexical retrieval. Raw relevance drives ordering; rounded totals remain presentation and trace data. The lexicographic comparator prevents availability from compensating for a worse match while retaining availability as a useful tie-break.

Regression tests prove `en` and `english` produce the same canonical target and result ordering, `de` and `german-standard` both send locale `de` to all lexical retrievers, a whole-title result wins even when its ID and watchability favor the broader result, and raw relevance wins when two candidates expose the same rounded score (`apps/admin/src/services/watch-search.service.test.ts:299-375`, `apps/admin/src/services/watch-search.service.test.ts:682-719`, `apps/admin/src/services/watch-search.service.test.ts:789-821`). Web tests cover real UI locale propagation, route absence, canonical routes, and invalid route values (`apps/web/src/lib/search-actions.test.ts:135-206`, `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx:593-685`).

## Prevention

- Give every language-bearing field one declared semantic type: canonical product slug, BCP-47 locale, or raw header. Convert only at an owned boundary.
- Make ambiguous BCP-47 matches fail closed instead of choosing the first Language row.
- Keep ranking policy as named comparator keys in priority order. Do not encode categorical product rules only as additive boosts.
- Sort on full-precision internal values and round only the response or observability projection.
- Test equivalence classes across boundaries (`en` versus `english`) and adversarial ordering cases where rounded values tie.
- Keep a stable identifier as the last comparator key so exact ties remain deterministic.

## Related Issues

- [Key language identity on the unique slug, not BCP-47](../best-practices/language-identity-on-slug-not-bcp47-20260605.md)
- [Admin Watch search production rollout checklist](../best-practices/admin-watch-search-production-rollout-20260720.md)
- [Stable Admin search dub hydration ordering](../database-issues/stable-admin-search-dub-hydration-ordering.md)
- [Admin hybrid search R4 pattern](../platform/admin-hybrid-search-r4-pattern.md)
- `docs/plans/2026-07-22-001-fix-watch-search-language-ranking-plan.md`
