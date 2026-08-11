---
title: "Separate Watch search drafts, suggestions, and explicit submission"
date: "2026-08-06"
category: "design-patterns"
module: "Watch search"
problem_type: "design_pattern"
component: "frontend_stimulus"
severity: "medium"
applies_when:
  - "Adding autocomplete where typing must not execute the full search"
  - "Serving multilingual suggestions from a cheaper retrieval projection"
  - "Supporting touch, keyboard, screen-reader, and IME search input"
  - "A lazy controller and instant shell share transient search ownership"
related_components:
  - "apps/admin"
  - "apps/web"
  - "packages/admin-graphql"
  - "typesense"
tags:
  - "watch-search"
  - "search-suggestions"
  - "explicit-submit"
  - "combobox"
  - "typesense"
  - "language-identity"
  - "graphql"
  - "mobile-search"
---

# Separate Watch search drafts, suggestions, and explicit submission

## Context

Watch search needed title completions without restoring live full-result search.
The full search pipeline can run several retrieval lanes, embeddings, result
hydration, tracing, and analytics, so using it for every partial draft would
make typing expensive and would blur the meaning of a submitted search.

The durable boundary has three separate states:

1. The **draft query** changes as the viewer types.
2. **Watch Title Suggestions** are optional, language-scoped completions for
   that draft.
3. The **submitted query** changes only through Enter, the mobile keyboard
   Search action, or the visible submit control.

Suggestion selection fills the draft; it does not cross the submission
boundary. This distinction is the core pattern. Debounce belongs to the cheap
suggestion lane, not to the full search action.

## Guidance

### Keep the suggestion lane structurally cheaper than search

Admin exposes a separate additive `watchSearchSuggestions` query backed only by
the lexical title projection. The service should:

- normalize the prefix with NFC, trim it, and cap it by Unicode code points
  before cache, database, or Typesense work;
- require at least two Unicode letters or numbers;
- query only localized `title_*` fields plus `title_fallback`;
- use prefix matching, zero typo tolerance, exact-first ranking, canonical-video
  grouping, a small candidate pool, and a hard response cap;
- return unique raw title strings, keeping document IDs internal; and
- fail to an empty list without blocking normal search.

Do not call the full Watch search service from this path. Suggestions must not
run metadata or transcript lanes, query embeddings, result-card hydration,
availability lookup, submitted-search traces, or prefix analytics. Popular,
recent, personalized, or history-based suggestions require separate product,
privacy, and retention decisions and are not a fallback for lexical failure.

The public schema, generated Admin GraphQL types, and typed operation ship
together. Web consumes the operation from
`packages/admin-graphql/src/operations/watch-search.ts`; it does not duplicate
an inline GraphQL contract.

### Separate language identity from tokenization

The viewer-selected public language slug is the exact identity across the Web,
GraphQL, and Typesense boundaries. Admin resolves its BCP-47 value only to pick
the tokenizer-specific title field.

Each lexical document carries a faceted `languageIdentity`, and suggestion
requests filter it before grouping:

```ts
{
  collection: "watch_search_lexical",
  q: normalizedPrefix,
  query_by: "title_en,title_fallback",
  filter_by: "languageIdentity:=[`slug:english`]",
  group_by: "canonicalVideoId",
  group_limit: 1,
  prefix: true,
  num_typos: "0,0",
}
```

Filtering only `localeCodes` and then parsing `localesJson` from one shared
multilingual document is insufficient: two distinct public language slugs may
share the same BCP-47 value. The per-language lexical projection plus exact
`languageIdentity` filter prevents that collision. See
`../best-practices/language-identity-on-slug-not-bcp47-20260605.md` for the
general identity rule.

### Make async freshness explicit

The browser client combines a caller-owned abort signal with a bounded timeout.
The overlay then uses two guards:

- a request key made from normalized draft plus public language slug; and
- a monotonic generation checked before any response commits state.

Abort alone is not a freshness proof. Response parsing, test doubles, or a
non-compliant client can still settle after cancellation. Generation identity
also protects rapid edits, language changes, close/reopen races, and React
Strict Mode effect replay.

Selection suppresses suggestions for the resulting controlled draft value.
Without that suppression, filling a suggestion immediately schedules the same
request and reopens the list. A later user edit removes the suppression.

Repeated full-search submissions for the same active query and language are
coalesced. Draft edits, language changes, Clear, and reset invalidate that lock
so an obsolete unresolved request cannot block a later explicit submission.

### Bound public fan-out below the structural GraphQL ceiling

A per-minute field rate is not an operation burst limit. A caller can alias a
public suggestion field many times in one GraphQL document, and sibling
resolvers execute concurrently. Keep a small request-context occurrence cap,
coalesce identical in-flight `(languageSlug, prefix)` work, cache the in-flight
language lookup rather than only its settled value, and fail empty above a
service-wide concurrency ceiling. This prevents one document from turning into
hundreds of simultaneous Prisma and Typesense calls while preserving the
optional suggestion contract.

The serving client prefers `TYPESENSE_SEARCH_API_KEY`; legacy
`TYPESENSE_API_KEY` is only the bounded current-profile compatibility fallback.
Otherwise a production environment correctly provisioned with the search-only
credential can silently disable suggestions.

### Use a manual-selection editable combobox

No suggestion starts active. Arrow keys move the active descendant; Enter on an
active option fills the draft and closes the popup; only a later Enter or submit
activation searches.

The interaction contract is:

- `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`,
  `aria-controls`, `aria-busy`, and a mounted-only `aria-activedescendant` on
  the input;
- stable listbox and option IDs with `aria-selected` on options;
- mouse selection on `pointerdown` with its focus-changing default prevented;
- touch and pen selection only after a stationary pointer gesture, so a drag
  can scroll an overflowed list before choosing a row;
- Escape closes suggestions before it can close the modal;
- Tab closes suggestions without selecting;
- IME composition and the candidate-commit Enter cannot submit; and
- `dir="auto"` plus `<bdi>` keeps mixed-direction titles isolated.

The form remains native:

```tsx
<form role="search" onSubmit={handleSubmit}>
  <input type="search" enterKeyHint="search" />
  <button type="submit" disabled={!hasValue}>
    <CornerDownLeft aria-hidden />
    <span>Search videos</span>
  </button>
</form>
```

On narrow screens, the submit action may keep only the Enter icon visually, but
its accessible name remains “Search videos.” Both submit and suggestion rows
retain at least a 44 CSS-pixel touch target.

### Measure the viewport the viewer actually has

The suggestion list is portaled so it is not clipped by overlay stacking
contexts. Its position uses `visualViewport` when present, compares available
space above and below the field, chooses the roomier side, and caps an
internally scrollable list to the available height. Recompute on viewport
resize and scroll so a software keyboard cannot strand the popup outside the
visible screen.

### Keep the instant shell request-free

The first-open search shell exists only to paint and focus the input while the
full controller loads. It must not create a second suggestion requester. A cold
submit transfers one normalized intent to the controller exactly once; the
controller then owns suggestions, results, pagination, and reset behavior.

## Why This Matters

This design preserves explicit search semantics without making the field feel
inert. Viewers can complete known titles, but partial drafts do not replace
results, reset pagination, change the URL, create submitted-search traces, or
become a popularity corpus.

Exact slug identity prevents cross-language leakage, while BCP-47 still serves
its proper tokenizer and locale-negotiation roles. Abort plus generation checks
prevent stale suggestions. The manual-selection combobox gives pointer,
hardware-keyboard, screen-reader, IME, and mobile-keyboard users the same
predictable two-step behavior.

An empty-failure contract lets suggestions remain an optional accelerator. A
Typesense, network, GraphQL, or parsing failure never removes the viewer's
ability to submit a full search.

## When to Apply

- Full retrieval is materially more expensive than prefix completion.
- Search results should change only on an explicit action.
- Suggestions are multilingual and language identity is richer than locale
  identity.
- The UI must work with touch, desktop keyboards, screen readers, IMEs, and
  software-keyboard-reduced viewports.
- Suggestion failure must not affect the primary search action.
- A lazy controller or transient shell creates ownership and handoff races.

## Examples

The discriminating regression tests are:

- `apps/admin/src/services/typesense-watch-search-suggestions.test.ts` for
  title-only request shape, bounds, exact slug identity despite a shared
  locale, cache reuse, and empty failure;
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` for no
  full search while typing, draft-only keyboard and pointer selection,
  repeated-submit coalescing, stale-response suppression, long-query
  suppression, close/reopen races, and IME behavior; and
- `apps/web/src/lib/watch-search-suggestions-client.test.ts` for the public
  operation, cancellation, bounded timeout, and malformed-response rejection.

## Related

- `../best-practices/language-identity-on-slug-not-bcp47-20260605.md`
- `../best-practices/nextjs-search-overlay-ui-patterns-20260415.md`
- `../performance-issues/typesense-watch-search-payload-projection-latency.md`
- `../ui-bugs/watch-search-modal-close-reset.md`
- `../ui-bugs/watch-search-overlay-stacked-control-breakpoints-20260708.md`
- `../../roadmap/content-discovery/feat-337-watch-search-suggestions.md`
- [PR #1860](https://github.com/JesusFilm/forge/pull/1860)
