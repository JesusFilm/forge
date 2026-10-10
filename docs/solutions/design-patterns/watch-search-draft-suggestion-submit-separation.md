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
   Search action, the contextual query action, or deliberate suggestion
   activation.

Typing remains draft-only, but selecting an offered query suggestion is an
explicit search action: it fills the draft and immediately crosses the same
submission boundary as Enter or the Search button. Debounce belongs to the
cheap suggestion lane, not to the full search action.

## Guidance

### Keep the suggestion lane structurally cheaper than search

Admin exposes a separate additive `watchSearchSuggestions` query backed only by
the lexical title and description projection. The service should:

- normalize the prefix with NFC, trim it, and cap it by Unicode code points
  before cache, database, or Typesense work;
- require at least two Unicode letters or numbers;
- query only localized `title_*` and `metadata_*` fields plus their fallback
  fields;
- use prefix matching, zero typo tolerance, exact-first ranking, canonical-video
  grouping, a small candidate pool, and a hard response cap;
- extract bounded query phrases, validate that each displayed phrase has a
  lexical hit in the exact selected language, and hydrate only the bounded
  direct matches needed for links; and
- fail to an empty list without blocking normal search.

Do not call the full Watch search service from this path. Suggestions must not
run transcript or semantic lanes, query embeddings, watchability lookup,
submitted-search traces, or prefix analytics. Direct-match hydration is limited
to indexed video IDs and link/group metadata. Popular,
recent, personalized, or history-based suggestions require separate product,
privacy, and retention decisions and are not a fallback for lexical failure.

Phrase extraction is not itself a result guarantee. After ranking and capping
the phrase candidates, validate uncached phrases through one dependent
Typesense multi-search request with `per_page: 1` per phrase, a minimal
projection, and the same exact `languageIdentity` filter. Preserve candidate
order and keep only confirmed positives. Cache positive and negative verdicts
briefly in a bounded process-local cache owned by the stable Prisma client so
the cache survives per-request service construction. Transport, sub-search, or
malformed-batch failures are not cached and suppress only query phrases;
already-hydrated direct matches and explicit search submission remain usable.

The public schema, generated Admin GraphQL types, and typed operation ship
together. Web consumes the operation from
`packages/admin-graphql/src/operations/watch-search.ts`; it does not duplicate
an inline GraphQL contract.

### Separate language identity from tokenization

The viewer-selected public language slug is the exact identity across the Web,
GraphQL, and Typesense boundaries. Admin resolves its BCP-47 value only to pick
the tokenizer-specific title and metadata fields.

Each lexical document carries a faceted `languageIdentity`, and suggestion
requests filter it before grouping:

```ts
{
  collection: "watch_search_lexical",
  q: normalizedPrefix,
  query_by: "title_en,title_fallback,metadata_en,metadata_fallback",
  query_by_weights: "8,4,2,1",
  filter_by: "languageIdentity:=[`slug:english`]",
  group_by: "canonicalVideoId",
  group_limit: 1,
  prefix: true,
  num_typos: "0,0,0,0",
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
active query option fills the draft, closes the popup, and immediately searches
through the shared submission path. Direct content options navigate directly.

The interaction contract is:

- `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`,
  `aria-controls`, `aria-busy`, and a mounted-only `aria-activedescendant` on
  the input;
- stable listbox and option IDs with `aria-selected` on options;
- mouse selection on `click`, with `pointerdown` preventing the focus-changing
  default so removing the selected row cannot retarget the click beneath it;
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
</form>
```

Keep the modal input free of a competing outlined submit button. Native form
submission still handles desktop Enter and the mobile keyboard Search action.
Place the pointer-visible action in the suggestion context row as `Search in
[language] for "query" ↩`: the outlined language name opens the full-panel
language picker, the query alone receives semibold emphasis, and the entire
remaining row submits through the same guarded path.
Implement them as sibling buttons rather than nested controls: an inset row
button beneath pointer-transparent content, with the language button layered
above as the only independent hit target. Give the language button a quiet
language glyph and a trailing chevron that rotates with the full-panel picker.
Give both controls explicit accessible names and at least a 44 CSS-pixel touch
target. At narrow widths, tighten internal spacing before truncating the query;
preserve the language chip and return-key cue.

Keep the active search field as the modal's only bright surface. Render the
language selector as a smaller dark-glass chip and the title suggestions as an
inset, width-bounded dark menu with quieter type. The menu stays keyboard and
touch scrollable, but hides its visual scrollbar so it reads as supporting
guidance rather than a second content panel.

Description completions can reuse the lexical index's localized `metadata_*`
fields without adding hydration or a second request. Keep localized title
fields weighted at least four times above metadata, sort all title matches
ahead of description-only matches, and always use the title as the selectable
draft value. A single-line description may sit beneath the title in subdued
text; highlight only the literal matching phrase so the added context does not
compete with the completion itself. Expose match source in the API contract for
testing and future analytics, but do not add a visible source badge unless
research shows viewers need it.

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

### Keep a controlled popover trigger mounted while it opens

A controlled language combobox must not disappear from its own render branch
when `open` becomes true. Doing so reconstructs the combobox between pointer
down and focus transfer, which can make the first activation appear to do
nothing. Measure the takeover surface before activation, keep the initiating
combobox mounted for the transition, and let the suggestion-panel instance own
the picker only when that panel already exists.

### Render the contextual submit row only for an unsubmitted intent

Once results correspond to the current normalized query and language, collapse
the helper to the compact `Search in [language]` control. Restore the query and
return-key action only after the viewer edits the query or explicitly changes
the language. Treat a null submitted language slug as the implicit/default
selection, not as a mismatch with the language displayed by the UI.

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
