---
module: apps/web
date: 2026-05-14
problem_type: logic_error
component: tooling
severity: medium
symptoms:
  - "Two `as NonNullable<WatchExperience>` casts in apps/web/src/lib/content.ts compile cleanly while bridging structurally-equivalent but nominally-distinct gql.tada types"
  - "watchSetting.homepageExperience and watchSetting.defaultTemplateExperience (both spreads of watchExperienceFragment) are not assignable to WatchExperience without a cast"
  - "If GET_WATCH_SETTINGS later requests fewer fields than watchExperienceFragment, the cast still compiles and pages silently render with missing fields"
  - "ce-code-review surfaces the unjustified casts as a load-bearing bridge between two ResultOf paths that should be one type"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - packages/graphql
  - apps/admin
tags:
  - gql-tada
  - typescript
  - type-safety
  - fragment-types
  - fragmentof
  - resultof
  - cast-drift
  - watch-page
---

# gql.tada cast drift between two query projections of the same fragment

## Problem

`apps/web/src/lib/content.ts` defined `WatchExperience` as `ResultOf<typeof GET_WATCH_EXPERIENCE>["experiences"][number]`, but the same type alias was consumed by call sites reading from a second query — `GET_WATCH_SETTINGS.watchSetting.homepageExperience` and `defaultTemplateExperience`. Both queries spread the same `watchExperienceFragment`, but gql.tada projects fragment-derived types through each query's selection set independently. The two projections were structurally identical but nominally distinct, forcing a load-bearing `as NonNullable<WatchExperience>` cast that compiled cleanly while hiding the drift.

## Symptoms

- TypeScript compiles with no errors despite the type mismatch.
- An `as NonNullable<…>` (or `as <FragmentType>`) cast appears at a call site consuming a value from one query but typed against another query's projection.
- Two queries (`GET_WATCH_EXPERIENCE`, `GET_WATCH_SETTINGS`) both spread `...watchExperienceFragment`, both feed the same downstream consumer (`resolveHomepage` / `resolveSlugPage`).
- ce-code-review (correctness / kieran-typescript persona) flags the cast as a load-bearing bridge between two `ResultOf` paths that should be one type.
- No runtime error — the bug compiles, tests pass, only review catches it.

## What Didn't Work

- **Reading the two queries side-by-side and assuming gql.tada unifies fragment-derived types.** It doesn't. Fragments are projected through each query's selection set, not unified by name.
- **Trusting that "both spread `...watchExperienceFragment`" means "both project to the same `WatchExperience` type".** gql.tada types the selection set on the parent query, not the fragment standalone.
- **Suppressing the cast warning by adding `as NonNullable<WatchExperience>`.** The cast is the symptom, not the fix; the bug compiles.
- **Anchoring the consumer alias to either query's projection.** Whichever query you pick, the other call site still drifts and still needs the cast.
- **(session history)** The U5b adapter work — where correct fragment-anchoring belonged — was explicitly deferred out of PR #915 (Unit 5 web canary, 2026-05-10). The canary shipped the dual-read code in `content.ts` with the cast in place, and the cleanup never happened until ce-code-review surfaced it in PR #939.
- **(session history)** A `@ts-expect-error` type-isolation proof pattern already existed in `packages/graphql/src/parity/compare.types.ts` (PR #912) — designed precisely to prove that fragment-anchored types reject the broader query-result shape. That enforcement mechanism was not applied in `content.ts`.

## Solution

Anchor the consumer's type alias to the fragment itself via `FragmentOf<typeof fragment>` rather than to one query's `ResultOf<>` path. Both query projections then collapse to the same consumer type.

**Before** (`apps/web/src/lib/content.ts`):

```ts
import { graphql, type ResultOf } from "@forge/graphql"

type WatchData = ResultOf<typeof GET_WATCH_EXPERIENCE>
type WatchSettingsData = ResultOf<typeof GET_WATCH_SETTINGS>

export type WatchExperience = WatchData["experiences"][number]
```

**After** (commit `37c5e2d5`):

```ts
import { graphql, type FragmentOf, type ResultOf } from "@forge/graphql"

type WatchSettingsData = ResultOf<typeof GET_WATCH_SETTINGS>

// Anchor WatchExperience to the fragment itself so both `GET_WATCH_EXPERIENCE`
// (experiences[number]) and `GET_WATCH_SETTINGS` (homepageExperience /
// defaultTemplateExperience) project through the same type. Avoids gql.tada
// type drift between two query-derived projections of the same fragment.
export type WatchExperience = FragmentOf<typeof watchExperienceFragment>
```

Call sites are unchanged in syntax — `experience: homepageExperience as NonNullable<WatchExperience>` and `experience: templateExperience as NonNullable<WatchExperience>` — but the cast is now trivially correct because the source value and the target type both derive from the same fragment shape.

The `WatchData` intermediate alias was dropped entirely since `GET_WATCH_EXPERIENCE`'s result is no longer the anchor for the consumer type.

## Why This Works

- gql.tada's `ResultOf<typeof Query>` types a query's result through that query's selection set. A fragment spread inside a query becomes a subset of the query's projection, not the fragment's own type.
- Two queries spreading the same fragment produce two structurally-identical-but-nominally-distinct result types at the consumer site.
- `FragmentOf<typeof fragment>` types the fragment shape independent of any query.
- When the consumer's type alias anchors to `FragmentOf<>`, every query's `...FragmentName` projection unifies to the same consumer type. The cast bridge dissolves into a trivial identity.
- **(session history)** The dual-client setup in PR #902 (Unit 3, 2026-05-06/07) already re-exported `FragmentOf` and `ResultOf` from `packages/graphql` precisely so consumers could anchor at the fragment level. The tools were in place for ~3 weeks before content.ts adopted them — the fix was a missing convention, not a missing primitive.

## Prevention

- **Convention.** When a fragment-projected value is consumed across multiple queries, define the consumer type via `FragmentOf<typeof fragment>` — not `ResultOf<typeof Query>["path"]["to"]["fragment-spread"]`. Single-query consumers can stay on `ResultOf<>` but should switch to `FragmentOf<>` the moment a second query enters the picture.

- **Detection.** Grep for `as NonNullable<` and `as <FragmentType>` cast patterns adjacent to gql.tada queries:

  ```bash
  rg '\bas NonNullable<\w+>\s*[,)]' apps/web/src apps/admin/src apps/mobile/src apps/tv/src
  ```

  Each match is a candidate for fragment-anchoring. Combined with `graphql\``-tagged template literals nearby, the pattern signals a load-bearing bridge.

- **Code review heuristic.** When a query-result type alias is consumed at multiple call sites — especially across `homepageX` / `defaultY` / `experiences[number]`-style branches sourced from different queries — check whether the alias is fragment-anchored or query-anchored. Query-anchored + multi-source = drift risk.

- **TypeScript discipline.** Treat `as <Type>` casts inside gql.tada code paths as a code smell. Before suppressing the warning, ask: _"Why doesn't TypeScript's inference already match? Is there an underlying fragment I should anchor to?"_

- **Type-isolation proof pattern.** For high-stakes types where the consumer must accept only the fragment-anchored shape (not a broader query-result projection), follow `packages/graphql/src/parity/compare.types.ts`'s pattern: a separate `.types.ts` file with `@ts-expect-error` directives proving the type boundary holds. This is the runtime-free equivalent of a regression test.

- **Tier-2 review surface.** This is exactly the class of bug unit tests + green CI cannot catch — the bug compiles and runs. Mandatory Tier-2 ce-code-review before push (per `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`) is what surfaced it; pre-existing convention without review wouldn't have.

## Cross-Package Applicability

This same risk emerges in U9 (`packages/admin-graphql`) when admin GraphQL types land. Admin fragments will likely be spread across multiple admin queries (e.g., a watch-Experience fragment spread on both `experienceBySlug` and `watchSetting.homepageExperience`/`defaultTemplateExperience`). The fix when authoring those consumer types: anchor on `AdminFragmentOf<typeof adminFragment>` from day one, not on `AdminResultOf<typeof Query>["path"]`.

## Related

- [Dual-client gql.tada multi-schema codegen pattern](../architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md) — established the `FragmentOf`/`ResultOf` re-exports in `packages/graphql` (PR #902). Sets up the tools this learning canonizes the use of. Consider an additive refresh adding a "Consumer-side anchoring" sub-section pointing at this doc.
- [GraphQL callsite inventory dual-pattern sweep](../best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md) — sibling gql.tada hygiene doc covering callsite enumeration.
- [Tier-2 ce-code-review mandatory before push](../workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md) — the workflow rule that made this catch possible.
- Commit `37c5e2d5` — the fix landing on `feat/adapt-web-data-layer-to-admin` (PR #939).
- Reference site: `apps/web/src/lib/content.ts:97-101` — the canonical worked example with inline comment.
