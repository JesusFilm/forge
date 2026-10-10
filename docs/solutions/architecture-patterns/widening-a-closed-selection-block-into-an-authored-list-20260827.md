---
title: "Widening a closed-selection Experience block into an authored list"
date: 2026-08-27
category: architecture-patterns
module: Watch Experience blocks
problem_type: architecture_pattern
component: fullstack
severity: medium
applies_when:
  - "An Experience block stores a closed enum selection and editors now need to author free-form entries"
  - "A GraphQL type that already has a schema-lag fallback gains a new FIELD"
  - "A consumer-owned presentation constant has to become an authoring vocabulary"
  - "An editor field is a controlled input whose persisted form should be trimmed"
tags:
  - experience-editor
  - watch
  - admin
  - graphql
  - gql-tada
  - back-compat
  - security
  - performance
---

# Widening a closed-selection Experience block into an authored list

## Context

The Watch homepage "Browse by category" rail shipped as
`watchHomeCategoryRail { categoryIds: [WatchHomeCategoryId!]! }` — an ordered
subset of a closed catalog. Titles, destinations, icons, and gradients were all
consumer-owned constants in `apps/web`. The ask was for admins to create, edit,
delete, and reorder arbitrary tiles with an editable title, destination URL,
icon, and visual style, while the predefined categories stayed as defaults.

That is a shape change, not a field addition: the unit of authoring moves from
"which catalog entries, in what order" to "an ordered list of tiles, each of
which may or may not reference a catalog entry." Four things break if you treat
it as a simple replacement.

## Guidance

### 1. Keep the original field as a compatibility mirror, not as history

The instinct is to replace `categoryIds` with `tiles`. Don't — `categoryIds` is
non-null in the published schema and is what an apps/web deploy that predates
the change reads. Web and Admin autodeploy from the same merge but not
atomically.

Add `tiles` as an OPTIONAL sibling, make it authoritative when present, and have
the editor keep `categoryIds` in sync with the predefined members of `tiles` in
tile order. An old renderer then degrades to "the predefined subset, correctly
ordered" instead of to an empty rail.

The mirror has one edge the naive derivation misses: a rail of purely custom
tiles mirrors to an empty array, which the required `min(1)` field rejects — the
save would fail for a reason that has nothing to do with what the admin did.
Fall back to the block's PREVIOUS mirror in that case. The mirror exists for old
readers; it must never be the reason a write fails.

Absent vs empty is a real distinction here: `tiles: undefined` means "nothing
authored, read `categoryIds`", while `tiles: []` is rejected on write and
treated as "nothing authored" on read. Both halves need that rule spelled out,
because a serializer that emits `[]` for an empty list would otherwise blank the
rail.

### 2. A new FIELD produces a different schema-lag error than a new TYPE

`apps/web` already carried a fallback for this block: on
`Unknown type "WatchHomeCategoryRailBlock".` it retried with a legacy selection
that omits the block. That matcher is structurally blind to the new case.
Selecting a field an older Admin does not have yields:

```
Cannot query field "tiles" on type "WatchHomeCategoryRailBlock".
```

Different message, same meaning, same correct response. Matching only the
type-level error turns the deploy window into a hard failure on every homepage
render rather than a graceful degrade. When you add a field to a type that
already has a schema-lag fallback, extend the matcher — and pin the negative
case too (`Cannot query field "tiles" on type "PromoBannerBlock"` must NOT
trigger the category-rail fallback), or the matcher quietly becomes a catch-all.

### 3. Moving presentation into the shared package needs a byte-identical pin

An icon and style picker is only useful if the editor's swatch matches what
viewers see, so the icon and gradient VOCABULARIES have to leave the consumer
and move to the shared package. Keep the split honest: vocabularies and
per-category defaults move; localized viewer copy stays with the consumer.

Sourcing thirteen gradients from a new catalog is a refactor only if the strings
survive. Pin every predefined tile's resolved gradient against the literals that
shipped, in the shared package's own test. A colour change smuggled in under a
"move the constants" diff is a viewer-visible regression that no type check and
no renderer test would catch.

Keep the persisted keys SEMANTIC (`"film"`, `"crimson"`), never library
component names — the key outlives the icon library. Map every key through an
exhaustive `Record<Key, T>` in each consumer so adding a vocabulary entry
without a glyph is a compile error rather than a blank tile.

### 4. An authored destination is a new security surface; validate at both ends

The pre-existing authored-link fields in this schema (`ctaLink`, `buttonLink`)
are unvalidated `z.string()` and land straight in an `href`. Do not extend that
for a new field. Accept exactly two shapes — a same-origin path starting with a
single `/`, or an absolute `https:` URL — and reject everything else:
`javascript:`/`data:`/`vbscript:` (script-execution sinks), `//host` (a
cross-origin destination wearing a path's clothes), `http:` (protocol
downgrade), and any control character (the NUL/newline/tab tricks that smuggle a
scheme past a prefix check).

Re-run the check at RENDER, not just at the Admin write boundary. Persisted
block JSON outlives any one validator, and this repo's blocks are also writable
through the MCP tool surface. On failure drop the tile rather than substituting
the catalog default — silently sending viewers to a destination the operator
never chose is worse than showing one tile fewer.

Route `https:` destinations to a plain `<a target="_blank" rel="noopener
noreferrer">`, not `next/link`: client-routing an off-site URL is wrong, and a
new tab without `noopener` hands the opener reference to a third party.

## Traps worth their own line

**Trimming inside a controlled input's change handler makes spaces untypeable.**
`onChange={v => set(v.trim())}` looks like harmless canonicalization. Typing the
space in "Meet Jesus" produces a state of `"Meet"`, React rewrites the field
from state, and the space can never be entered. Store the value as typed;
canonicalize once at serialization, and evaluate inline validation against the
trimmed view so a whitespace-only field reads as the absent override it is about
to become.

**`tsc --noEmit` does not prove a `next/link` href compiles.** With
`typedRoutes: true`, the route-type augmentation is generated during
`next build`. A runtime-derived href passes `pnpm typecheck` and fails the build
with `Type 'string' is not assignable to type 'UrlObject | RouteImpl<string>'`.
Any change that puts a computed value in a `Link href` needs a real build in the
verification set. The established escape hatch in this repo is `as Route` with a
comment naming the runtime guarantee that replaces the static one.

**Widening a block summary changes what its tests assert vacuously.** A
page-level save test that asserts inside an async server-action mock
(`vi.fn(async fd => { expect(...) })`) turns a mismatch into an unhandled
rejection while `expect(action).toHaveBeenCalledTimes(1)` still passes. This
change altered the saved payload and that test stayed green on the wrong shape.
Capture the payload in the mock and assert outside it.

## Verification

- `pnpm --filter @forge/watch-url-policy test` — vocabulary + href policy +
  the byte-identical gradient pin.
- `pnpm --filter @forge/admin test` — persisted schema (accept/reject per tile
  shape and per destination shape), editor tile helpers, editor interactions.
- `pnpm --filter @forge/web test` — resolution rules, defensive drops, renderer
  anchor-vs-Link split, and BOTH schema-lag matcher directions.
- `pnpm --filter @forge/admin schema:print` +
  `pnpm --filter @forge/admin-graphql generate` must produce no further diff.
- `pnpm --filter @forge/web build` — the only check that exercises typedRoutes.

### Measuring the client-bundle cost of an icon vocabulary

An icon picker bundles every glyph in the vocabulary, because the key is chosen
at runtime. Measure it rather than guessing:

1. Make a temporary WIP commit so the baseline checkout is reversible.
2. `git checkout HEAD~1 -- <dirs>` AND delete the files ADDED in HEAD (a
   checkout does not remove them, and a leftover file importing a reverted
   export fails the baseline build). Revert every app in the type graph — web's
   build type-checks imported admin source.
3. Build, then sum `gzip -c` over `.next/static/**/*.js`. Raw `du` on
   `.next/static` is dominated by source maps and overstates the delta ~6x.
4. To attribute the delta, point the newly added symbols at ones the baseline
   already bundled and rebuild — the difference isolates that cost from the
   feature's logic.

Measured here: +17.4 KB gzipped total client JS (+1.44%), of which 14.0 KB is
the nine added lucide glyphs (~1.4 KB each, carried by the three chunks that
include the rail) and 3.4 KB is all the tile logic. Trimming the vocabulary is
the lever if that budget matters.
