---
title: "Migrating a native client's home to a single admin CMS Experience (hydrate-by-coreId, TV home parity)"
date: "2026-07-12"
last_refreshed: "2026-07-14"
category: "architecture-patterns"
module: "apps/tv, apps/admin, packages/admin-graphql"
problem_type: "architecture_pattern"
component: "data-layer"
severity: "high"
applies_when:
  - "Pointing a native/second client's home (or any curated surface) at a single admin CMS Experience that web already renders"
  - "The CMS's curated items do NOT carry a directly-hydratable id for the consumer's bulk fetch (stored id is an internal cuid, public slug is null)"
  - "You want editor-controlled curation from one object while keeping a client-owned hero, exact per-item metadata, and precise routing"
  - "The client cannot render the flat CMS items (they coarsen metadata or can't even navigate) and must hydrate each item from an existing bulk fetch"
tags:
  - architecture
  - graphql
  - gql-tada
  - admin
  - cms
  - migration
  - react-native
  - tv
  - hydration
---

## Context

TV Home shipped (feat-179) against a **code-curated copy** of the home rows plus a
client-owned hero pool. Meanwhile web and mobile moved their home body onto the
single admin `watch-home` **Experience** object — an editor changes it once and both
surfaces update. This work consolidated TV onto that same Experience so row curation
is editor-controlled from one place, while keeping TV's focus-driven showcase, its
client-owned featured banner, and precise series routing unchanged, with a fall back
to code curation when the Experience is unavailable.

The naive port ("read the Experience blocks, render the items") is impossible against
live prod, and the reasons generalize. This is the pattern plus the learnings.

## Guidance

### 1. Two planes: CMS decides _structure_, the existing bulk fetch supplies _content_, joined by a stable id

Do **not** render the flat CMS items. Read only the _shape_ from the Experience —
which items appear in which rows and in what order — and hydrate each item's actual
record from the client's existing bulk fetch, joined on a stable id. On TV:
`experienceAdapter.buildWatchHomeSectionsFromExperience(blocks, videoByCoreId)` walks
each `MediaCollectionBlock`, maps each item to its `coreId`, looks it up in a hydration
index, and builds the card through the **same** normalizer the code path already uses
(`model.normalizeCard`) — so meta chips are exact ("N episodes" for a series, a
duration for a single), series-vs-single routing is precise and direct, and it works
for any editor-curated video, not just ones the client hardcodes.

This is a deliberate **divergence from mobile**, which renders the flat item
(`childCount: 0`, no wire label, and — in prod — a null slug it cannot even navigate
to). The divergence is worth it wherever the flat item can't carry the fidelity the
surface needs.

### 2. The CMS item's stored id is NOT the consumer's hydration key — add an additive public bridge field

The load-bearing discovery: the admin `MediaCollectionItem`'s `videoId` is the Video's
internal **cuid** (`documentId`), which the public `watchHomeVideos(coreIds:)` fetch
does **not** accept (returns `[]`); and `videoSlug` was **null on all 51 prod items**.
There is no public bulk-by-id/slug query. So the client cannot hydrate an arbitrary
curated item from the Experience payload alone.

Fix: expose a small **additive, public `coreId`** on the CMS item, resolved read-time
from the stored video id via the _existing batched loader_ — one batched `findMany`
per home resolve, never N+1, no new loader:

```ts
// apps/admin/src/graphql/types/blocks.ts (MediaCollectionItem)
coreId: t.string({
  nullable: true,
  resolve: async (item, _args, ctx) => {
    const videoId = optionalString(item.videoId)
    if (!videoId) return null // never pass null into a string-keyed loader
    const row = await ctx.loaders.videoById.load(videoId)
    return row?.coreId ?? null // also null-guard soft-deleted/missing rows
  },
})
```

Reach it through the **shared** `AdminMediaCollection` fragment so web, mobile, and TV
all receive `items { coreId }` from one place. Default to a read-time batched resolve;
denormalizing `coreId` onto the stored item at author time is a zero-read alternative
kept in reserve, out of scope unless profiling demands it. Register the new public
field in the server's public-widening discipline (see
[pothos-public-widening-multi-layer-coordination](../graphql/pothos-public-widening-multi-layer-coordination-20260511.md)).

### 3. Build the hydration index across BOTH levels, top-level-wins

The config-pool bulk fetch (`getWatchHomeCoreIds()`, ~26 collection ids) returns
records **and** their `children[].child`. Many curated items (20 of prod's 42 unique
item ids) live only as a child of some collection. So the index must span both:

```ts
// model.buildVideoByCoreIdIndex — children first, then top-level, so top-level WINS
for (const v of videos)
  for (const c of resolvedChildren(v)) if (c.coreId) index.set(c.coreId, c)
for (const v of videos) if (v.coreId) index.set(v.coreId, v)
```

Insert children first, then top-level, so a coreId present both ways resolves to the
top-level record (which carries `children` → a real `childCount` → correct series
routing). Both the config model and the adapter consume this one builder.

Crucially, **hydration coverage is the index keyset, not the fetched id list** — the
index is a superset (records ∪ their children). Compute divergence against the keyset,
so already-indexed child episodes are never re-fetched.

### 4. Top-up only the genuinely-uncovered ids; degrade, never blank

`divergent = ExperienceItemCoreIds − indexKeyset`. When non-empty, a top-up fetch
hydrates the rest (`topUpFetch.fetchTopUpVideos`), chunked under the per-call cap
(`VIDEOS_BY_CORE_IDS_MAX = 100`), bounded by a client timeout, with a `requestId`
re-check after the await. Any rejected chunk **degrades**: drop the divergent items,
keep the config-pool rows, emit one `topup-error` log — it never blanks the home. In
today's prod the Experience mirrors the config pool 1:1, so `divergent = 0` and the
top-up never fires — but the machinery is required the instant an editor adds a net-new
video.

### 5. The resilience ladder is a PURE function and the SINGLE decision point

Extract the Experience-vs-fallback + reason-logging decision into a pure
`reconcileWatchHome(input)` so it is unit-testable **without rendering the hook** — the
TV codebase never uses `renderHook`, it extracts pure logic (cf. `homeScreenState.ts`).
Route _all_ primary states through it (videos-ok / rejected / empty-over-snapshot), so
it is the one place the R8/R9/R10 decision lives and there are no branches that exist
only for tests. It maps `{primary, experienceSections, experienceOutcome,
experienceBlocks, topUpFailed}` → the body + the fallback reasons to emit
(`null | error | empty | error-recovered | topup-error`) + the next last-good blocks.
Emit every revert through the telemetry sink with the reason as a **context attribute**,
not interpolated into the message.

### 6. Hero stays client-owned; config becomes a hydrated, exercised, frozen fallback

Only the **rows** move to the CMS. The admin `WatchHomeHeroBlock` is an **inert
placeholder** (fragment selects only `t`/`sectionKey`, no video items) — neither web nor
TV sources hero content from it. Both heroes are code-owned. The code curation becomes a
**frozen emergency fallback**: still rendered from the same bulk fetch (so it needs no
second fetch), guarded by a test so it can't bitrot, and split in `config.ts` with
LIVE (hero) / FROZEN (fallback) markers so the two halves don't read as interchangeably
mirrored.

### 7. Snapshot the resolved body for instant cold-launch; guard the public query at two layers

Persist the merged videos **and** the Experience blocks in a versioned snapshot
(bump the version; old snapshots parse to null — clean network-first migration) so cold
launch paints the last body instantly and reconciles in place. Guard the public query at
two layers: a **print-based doc guard** (never selects the editor-gated `experiences`
field; DOES select the item hydration key; stays lean — no `dubs`/`variants`) and a
**transport guard** (the home op carries no bearer). See
[tv-mobile-clients-consume-only-public-admin-queries](../conventions/tv-mobile-clients-consume-only-public-admin-queries.md).

### 8. Renderer transparency + widened block allowlist

Map the CMS blocks into the client's **existing** rail/card model so the renderer
changes nothing — `index.tsx` maps `model.sections` generically by `section.id`, so the
data-layer swap is renderer-transparent. Per-item drop on no-hydrate; per-section skip
on zero cards. **Widen the silent block allowlist** vs the sibling platform: mobile
warns on every non-hero block, so a verbatim port spuriously warns on the prod
`SectionBlock`; TV silently skips the known non-rail blocks
(`WatchHomeHeroBlock`/`SectionBlock`/promo/CTA) and dev-warns only on a genuinely
unrecognized `__typename`.

## Why This Matters

Rendering the flat CMS items looks simpler but silently coarsens or breaks the surface
(no exact metadata; in prod, a null slug means the card can't even navigate). Hydrating
by a stable id through the existing bulk fetch keeps full fidelity and reuses the
normalizer, so the CMS-driven path and the code path produce identical cards. Making the
resilience decision a pure single point is what let the ladder ship with real branch
coverage in a codebase that can't render hooks in tests.

## Learnings discovered (the gotchas)

- **"Merged to main" ≠ "live in prod" (deploy ordering is load-bearing).** The additive
  `coreId` field must be live in prod admin _before_ the shared-fragment edit ships in
  any consumer deploy — selecting a field the deployed schema lacks fails the whole home
  query. Worse, during this work prod admin briefly stopped serving `coreId` **despite
  the field being merged**: its build had been superseded by a **redeploy of an older
  snapshot**, silently reverting the running schema. **Verify the field is LIVE in prod
  by querying it, not just merged** — a passing CI and a green main tell you nothing
  about which image the prod service is actually running.
- **Live-prod verification overturned the plan's core assumption.** The original
  `videoId`-as-`coreId` port was proven impossible only by querying live prod
  (`watchHomeVideos([...videoIds]) → []`; `videoSlug` null 51/51). A direct instance of
  [mocked-shape-vs-real-contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md):
  a mocked fixture would have "hydrated" fine and hidden the gap.
- **Prod hydration gate.** Before merge, confirm **every** Experience item `coreId` is
  covered by the client's config-pool index (top-level ∪ children). Method: fetch the
  Experience item coreIds, build the index the way the client does, assert
  `divergent = 0` (or that the top-up covers the rest). Result here: 42/42 covered, 0
  divergent — the "1:1 mirror" assumption holds today.
- **You cannot unit-test a React hook file directly under jest-expo.** Importing a hook
  module (which imports `react`) into a test resolves `react` to
  `@types/react/index.d.ts` and fails with _"Cannot use import statement outside a
  module."_ Fix: extract the pure logic into its own module (here `topUpFetch.ts`, and
  the pure `reconcileWatchHome`) and test **that** — matching the codebase's existing
  extract-pure-logic discipline. Don't reach for `renderHook`.
- **Hero divergence — gap since closed to an approximation by PR #1534.** As shipped
  here (feat-179), TV's hero showed only the 4 `WATCH_HOME_HERO_SOURCE_IDS`, while web's
  top carousel cycled a much larger set (Christmas short films, etc.) via
  `WATCH_HOME_PLAYLIST_SEQUENCE` + `WATCH_HOME_MUX_INSERTS` + a "short-films sweep",
  keeping the 4 ids only as the empty-queue _fallback_. PR #1534 later ported the
  playlist-sequence pool queue + short-films pool to **both** TV and mobile (still no Mux
  inserts on TV — scarce tvOS decode slots, image-based banner), so the 4 ids are now the
  fallback on TV too. The catch: TV/mobile use a lean fetch without `hls`, so they cannot
  replicate web's exact `hls` eligibility gate and instead **approximate** it with a
  wire-`label` gate (drop `COLLECTION`/`SERIES`, keep `FEATURE_FILM`/`SHORT_FILM`). So the
  gap is closed to an approximation — a few feature films web drops only for missing `hls`
  are over-included — not an exact match. The hero stays client-owned throughout (guidance
  #6). See
  [Cross-client home-hero web parity via a wire-label eligibility gate](cross-client-hero-parity-eligibility-gate.md).
- **tvOS device-smoke has a real limit.** The Home top bar is a sticky ScrollView
  header, and tvOS drops `nextFocus` on its children, so the D-pad won't reliably descend
  past the banner into lower rails — some smoke verifications end up inferred (from card
  labels + unit tests) rather than directly driven. Don't treat a smoke as _proof_ of no
  regression; it evidences the paths you drove.

## When to Apply

- Pointing any native / second consumer of a shared admin Experience at that single
  object for its structure, when the CMS items don't carry a directly-hydratable id.
- Consolidating a code-curated surface onto a CMS-driven single source while keeping a
  client-owned element (hero), exact per-item metadata, and a hydrated code fallback.
- Any additive public field on an admin type consumed by TV/mobile/web through a shared
  fragment — honor backend-first deploy ordering and verify-in-prod.

## Examples

- Bridge field + batched resolve: `apps/admin/src/graphql/types/blocks.ts` `coreId`.
- Two-level index: `apps/tv/src/lib/watchHome/model.ts` `buildVideoByCoreIdIndex`.
- Adapter (hydrate-by-coreId, not flat): `apps/tv/src/lib/watchHome/experienceAdapter.ts`.
- Pure resilience ladder: `reconcileWatchHome` (same file); wired in `apps/tv/src/hooks/useWatchHome.ts`.
- Top-up extracted for testability: `apps/tv/src/lib/watchHome/topUpFetch.ts`.
- Snapshot v2: `apps/tv/src/lib/watchHome/homeSnapshot.ts`.

## Related

- [Mobile data-layer cutover to admin GraphQL](mobile-admin-data-layer-cutover-pattern-20260525.md) — the sibling migration TV mirrors but diverges from (hydrate-by-coreId vs render-flat).
- [Lean bulk + lazy per-item GraphQL fetch](../design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md) — the additive-public-field + backend-first two-PR shape the coreId bridge follows.
- [AsyncStorage SWR snapshot over a slow admin resolver](../design-patterns/asyncstorage-swr-snapshot-slow-admin-resolver.md) — the never-paint-empty resilience machinery this reuses.
- [TV/mobile clients consume only public admin queries](../conventions/tv-mobile-clients-consume-only-public-admin-queries.md) — the public-query posture and the two-layer guards.
- [Pothos public widening multi-layer coordination](../graphql/pothos-public-widening-multi-layer-coordination-20260511.md) — where the new public `coreId` field must register.
- [Mocked-shape vs real-contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — why live-prod verification caught the videoId≠coreId gap.
- [Cross-client home-hero web parity via a wire-label eligibility gate](cross-client-hero-parity-eligibility-gate.md) — the follow-up that closed the hero-divergence gap this doc flagged (label-gate approximation of web's hls gate; PR #1534).
- [TV SDUI MediaCollection card image/title resolution](tv-sdui-mediacollection-card-image-title-resolution.md) — extends this doc's coreId-hydration beyond the Home migration to the general SDUI Experience-Details MediaCollection renderer (`ExperienceProvider` / `experienceHydration.ts`), and adds the card image-resolution layer (imageOverrideUrl origin rewrite, field-major cardImage, Mux 640 ceiling) this doc does not cover; PR #1551.
- Plan: `docs/plans/2026-07-08-003-feat-tv-home-experience-parity-plan.md`.
