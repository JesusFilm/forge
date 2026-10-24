---
title: "Dual-pattern callsite sweep for GraphQL inventories — gql.tada AND raw Apollo gql tag"
date: 2026-05-07
problem_type: best_practice
component: tooling
root_cause: inadequate_documentation
resolution_type: workflow_improvement
severity: high
module: packages/graphql, apps/web, apps/mobile, apps/tv
applies_when:
  - "Inventorying every callsite of a typed GraphQL helper for a migration, codemod, or audit"
  - "Codebase mixes gql.tada (graphql-paren form) with raw Apollo (gql-backtick form) — both patterns coexist"
  - "Building a per-app inventory that gates downstream units (PUBLIC field set, schema diff, codegen scope)"
symptoms:
  - "Single-pattern rg sweep on the typed helper silently drops raw Apollo callsites"
  - "Downstream unit (PUBLIC tier widening, dual-client codegen, parity harness) builds against an incomplete field set"
  - "Category errors in operation-to-field mapping when inventory is missing one half of the dual-pattern surface"
related_components:
  - packages/graphql
  - apps/web
  - apps/mobile
  - apps/tv
tags:
  - graphql
  - gql-tada
  - apollo
  - inventory
  - migration
  - ripgrep
  - meta-pattern
related:
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md"
  - "docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md"
---

# Dual-pattern callsite sweep for GraphQL inventories

The intuitive sweep for a GraphQL callsite inventory is one ripgrep against the typed helper:

```sh
rg "graphql\(" apps/web/src apps/mobile/src apps/tv/src
```

That command is silently incomplete in any codebase that **mixes gql.tada with raw Apollo's `` gql`...` `` tag** — which the forge web app does. Both forms compile, both ship to production, and the second form is invisible to the first sweep. A zero-hits result for an operation does not mean the operation does not exist; it means the analyst did not search for the form it was authored in.

## The rule

> **When inventorying GraphQL callsites in any app that uses `@apollo/client` as a dependency, run BOTH patterns. The typed-helper pattern catches gql.tada operations; the raw-tag pattern catches anything authored against the underlying library directly.**

```sh
# Typed helper (gql.tada from @forge/graphql)
rg "graphql\(" apps/web/src apps/mobile/src apps/tv/src

# Raw Apollo tag (assignment + tagged template)
rg "= gql\`"   apps/web/src apps/mobile/src apps/tv/src
```

The union of the two result sets is the inventory. The second pattern anchors on `= gql\`` (assignment + tag) rather than just `gql\``to avoid matching`import { gql }`or unrelated identifiers ending in`gql`.

## The concrete near-miss

In `apps/web/src/lib/recommendations.ts` two operations sit side-by-side, each authored in a different style:

```ts
// gql.tada — caught by `rg "graphql\("`. Typed inference is automatic;
// no explicit annotation needed — ResultOf/VariablesOf derive from the literal.
const GET_VIDEO_BY_SLUG = graphql(`
  query GetVideoBySlug($slug: String!, $locale: I18NLocaleCode!) {
    videos(filters: { slug: { eq: $slug } }, locale: $locale) {
      documentId
      title
      slug
      images {
        url
        width
        height
      }
    }
  }
`)

// Raw Apollo gql — INVISIBLE to `rg "graphql\("`
const SCENE_RECOMMENDATIONS = gql`
  query SceneRecommendations($slug: String!, $locale: String!, $limit: Int) {
    sceneRecommendations(slug: $slug, locale: $locale, limit: $limit) {
      videoId
      similarity
      themes
      demographics
      spiritualContext
      startSeconds
      endSeconds
      playbackId
    }
  }
`
```

`SCENE_RECOMMENDATIONS` returns scene-level rich fields. `GET_VIDEO_BY_SLUG` returns thin video-shell fields. They are completely different operations that happen to live in the same file.

## Why this matters

The inventory feeds Unit 2 (admin PUBLIC schema readiness) which decides what fields the new backend exposes. If `SCENE_RECOMMENDATIONS` is dropped from the inventory, Unit 2 would specify admin's `sceneRecommendations` PUBLIC contract using `GET_VIDEO_BY_SLUG`'s thin field set — the only `sceneRecommendations`-adjacent operation visible in the single-pattern inventory.

Either downstream failure mode is bad. If admin ships strict (only the documented fields), the consumer query fails server-side validation; Apollo surfaces a GraphQL error in the `error` channel that renderers gating on `data` may treat as empty. If admin ships permissive (nullable fields, unwired resolvers — a common "ease the migration" choice), there is no error and renderers gate on null `themes`/`similarity` and silently render an empty strip. Both surface as production UX regressions, neither breaks builds or tests.

The cost of the dual-pattern sweep is one extra rg invocation. The cost of missing it is multi-unit cascade.

## When to apply

- **GraphQL callsite inventories** in any monorepo that uses `@apollo/client` directly anywhere (gql.tada is layered on top, not a replacement).
- **Migration audits** anchored on a typed helper (`graphql()`, `gql()`, `useTypedQuery()`) when the underlying library's raw tag is also in use.
- **Mixed-library codebases** where a single concept has two authoring forms (`z.object` vs `Joi.object`, `fetch(` vs `axios(`, `graphql(` vs `` gql` ``, `useForm` vs `<form onSubmit>`). Whenever the answer to "is X used anywhere?" depends on which library X is, single-pattern sweeps are incomplete. Within a single library, the same enumeration discipline applies recursively — a Zod sweep on `z.object(` misses `z.discriminatedUnion`, `z.tuple`, etc.

Pre-flight rule for any inventory step in a multi-unit plan: enumerate authoring forms first, then define the sweep as the union of patterns. Document both patterns in the plan's verification section so future plan-readers cannot accidentally regress to the single-pattern form.

## Related META

This is a new instance of two existing meta-patterns (see `related:` frontmatter):

- **`mocked-shape-vs-real-contract-discipline`** — a single mock satisfying multiple branches gives zero signal about which branch is load-bearing. Same logical structure: a single rg pattern "proves" coverage for one form but leaves the other form silently uncovered.
- **`review-fix-round-2-sibling-call-site-regressions`** — sibling-callsite sweep rule. This learning extends it: sibling DSL **forms** can hide alongside sibling **files**.

The dual-client gql.tada pattern doc (`dual-client-gql-tada-multi-schema-codegen-pattern-20260507`) is the producer-side complement; this learning is the consumer-side discipline that closes the loop on its inventory step.
