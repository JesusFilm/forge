---
title: "Web search Admin keyword-first opt-in"
date: "2026-06-09"
category: "web"
module: "apps/web search"
problem_type: "architecture_pattern"
component: "service_object"
severity: "medium"
applies_when:
  - "A consumer app should opt into a provider-owned GraphQL or API mode at a shared data boundary."
  - "Input strategy selection must remain separate from response degradation or health signals."
  - "Multiple UI callers share one search helper and should inherit the same product-level search behavior."
related_components:
  - "apps/web/src/lib/search.ts"
  - "apps/web/src/lib/search.test.ts"
  - "apps/admin/src/graphql/queries/hybrid-search.ts"
tags:
  - "web"
  - "search"
  - "keyword-first"
  - "admin-graphql"
  - "boundary-contract"
---

# Web search Admin keyword-first opt-in

## Context

`apps/web` search called Admin `Query.search` without `mode`, so Admin used its default hybrid pipeline. Admin already supported `mode: "keyword-first"` as a nullable `String` argument, while response `searchMode` still meant the degradation signal (`"hybrid"` or `"keyword-only"`).

The web product cutover needed all web search callers to move together: floating search, shared load-more results, and demo search. It did not need a visible mode selector or a wider server-action input.

## Guidance

Opt in at the shared data boundary. In `apps/web/src/lib/search.ts`, define a private consumer-level constant, add `$mode: String` to the typed `adminGraphql` operation, pass `mode: $mode` to `search`, and include `mode: WEB_SEARCH_MODE` in the Apollo variables.

```ts
const WEB_SEARCH_MODE = "keyword-first"

const searchVideosOperation = adminGraphql(`
  query Search(
    $q: String!
    $locale: String!
    $limit: Int
    $offset: Int
    $type: HybridSearchContentType
    $mode: String
  ) {
    search(q: $q, locale: $locale, limit: $limit, offset: $offset, type: $type, mode: $mode) {
      searchMode
      results {
        id
        title
      }
    }
  }
`)
```

Keep `searchVideos(query, limit, offset, type?)` and `runSearch(input)` unchanged unless callers need runtime mode selection. A fixed app-level constant is enough for a product cutover and avoids leaking Admin pipeline details into UI components.

Keep input `mode` separate from response `searchMode`. `mode` selects the retrieval pipeline; `searchMode` reports whether Admin degraded from semantic plus keyword retrieval to keyword-only.

## Why This Matters

Omitting a nullable GraphQL argument fails silently: the request remains valid, but behavior falls back to the provider default. A boundary constant makes web's chosen behavior explicit and ensures every web search caller moves together.

The app-side test should prove the wire contract, not Admin ranking. Web owns "did we send the right operation and variables?" Admin owns "did keyword-first rank correctly?"

## When to Apply

- A backend exposes a forward-compatible nullable `mode` or behavior flag.
- Existing default behavior must remain stable for other consumers.
- One consumer app is ready to opt in globally.
- The mode should not be user-visible or caller-configurable yet.
- A similarly named response field already exists and must keep its own meaning.

## Examples

The regression test should print the captured GraphQL document from the mocked client call and assert both `$mode: String` and `mode: $mode` are present. It should also assert exact variables, including `type: undefined` for unfiltered search and the content-type enum for filtered search.

```ts
const options = lastSearchQueryCall()
const printed = print(options.query)

expect(printed).toMatch(/\$mode:\s*String\b/)
expect(printed).toMatch(/search\([^)]*mode:\s*\$mode/)
expect(options.variables).toEqual({
  q: "jesus",
  locale: "en",
  limit: 20,
  offset: 0,
  type: undefined,
  mode: "keyword-first",
})
```

The `limit: 20` example describes the shared helper default. Do not copy it into Watch overlay pagination when the product surface needs a different page size; `apps/web/src/components/FloatingSearchProvider.tsx` owns its local `SEARCH_PAGE_SIZE` instead.

Add a response mapping assertion beside the request-mode assertions:

```ts
mockSearchResponse("KEYWORD_ONLY")

const data = await searchVideos("jesus")

expect(data.searchMode).toBe("keyword-only")
expect(lastSearchQueryCall().variables.mode).toBe("keyword-first")
```

That keeps the two mode concepts from collapsing into each other during later refactors.

## Related

- [Admin hybrid search keyword-first mode](../platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md)
- [Watch search overlay page size mismatch](../logic-errors/watch-search-overlay-page-size-mismatch.md)
- [Admin hybrid search R4 pattern](../platform/admin-hybrid-search-r4-pattern.md)
- [Dual-client gql.tada multi-schema codegen pattern](../architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md)
- [Codegen strips optional GraphQL variable definitions from DocumentNode AST](../cms/codegen-strips-optional-graphql-variables.md)
- [GraphQL callsite inventory dual-pattern sweep](../best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md)
