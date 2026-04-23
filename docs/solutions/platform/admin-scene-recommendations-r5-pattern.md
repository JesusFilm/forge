---
title: Admin R5 — Scene-recommendations port (cms → admin)
date: 2026-04-23
category: platform
tags:
  - admin
  - migration-playbook
  - recommendations
  - pgvector
  - graphql
  - rest
---

# Admin R5 — Scene-recommendations port

Durable learnings from porting `apps/cms`'s scene-similarity
recommendation query (feat-044) into `apps/admin`. Sibling document to
`admin-hybrid-search-r4-pattern.md`; together they cover the public
read-side of the admin migration playbook.

## Context

cms owns `GET /api/scene-embedding/recommendations` and a public
`sceneRecommendations(slug, locale, limit)` GraphQL query. apps/web's
Recommendations block consumes the GraphQL version via a raw `gql` tag
in `apps/web/src/lib/recommendations.ts`. R5 replicates the endpoint
surface on admin so R8 (one-shot consumer cutover) can swap base URL
with a one-line TypeScript-type update on the consumer.

## Learnings

### Identity delta is a one-line renderer change, not a response redesign

cms returns `videoId: Int!`; admin returns `videoId: ID!` (cuid string).
Grepping apps/web's renderer showed `videoId` is used only as a React
key (`${rec.videoId}-${rec.sceneIndex}`). Everything else keys off
`videoSlug`. That means the cutover is literally `videoId: number →
videoId: string` on one type definition; nothing breaks at render
time. This is the same class of delta R4 absorbed when returning cuid
`resultId`s — byte-parity is about field names + nullability, not
column types.

### Shared dedup primitive stays a single algorithm across R4 and R5

R4's `deduplicateResults(FusedResult[], limit)` assumed an RRF `score`
was on every row. R5 has no RRF score. Rather than duplicate the
3-layer logic into a second file, the shared primitive
`dedupeByVideoIdentity<T extends VideoDedupKeys>(rows, limit)` operates
on a structural shape (`videoCoreId`, `videoTitle`, `embeddingText`)
and is consumed by both. R4's `deduplicateResults` became a thin
`FusedResult`-typed wrapper — existing tests unchanged. R5 calls the
primitive on a different row type directly.

This factoring is worth doing _the second time you'd copy the
function_, not the first. R4 was fine standalone; extracting then
would have been premature. The R5 port surfaced the need.

### INNER JOIN on dub/mux diverges from R4's LEFT JOIN — on purpose

cms's recommender guarantees `playbackId: String!`. The apps/web
renderer consumes it as non-null. Admin's scene rows don't carry
playbackId directly — it derives via the 3-hop
`VideoDub(edition, language) → MuxVideo` chain. If any leg is missing,
the row has no playable URL.

R4 hybrid-search uses LEFT JOIN on that chain: a row without a
resolvable playback still surfaces (the user can read the result, just
no deep-link). R5 uses INNER JOIN: a result without a playable dub is
not an actionable recommendation, and cms's contract promises
non-null. Same schema, different product intent, different join.

The lesson: _cms-parity-first_ isn't just about field names. When the
underlying join strategy differs between cms and admin because cms
stored the data differently, the port has to re-derive which join
guarantees the consumer contract — and may diverge from sibling
admin services that made different calls.

### Forward-looking Zod variants are OK when the scope is "schema only"

The playbook mentioned a `ComponentBlocksVideoRecommendations` variant
for admin's block schema. Grepping cms turned up no such component —
no Strapi file, no introspection type, no apps/web consumer. R5 added
the Zod variant anyway because:

- The schema change is zero-cost (one new discriminated-union entry).
- Future editor work (tatai's feat-100/103) will need it.
- `z.discriminatedUnion.strict()` rejects unknown keys, so the
  variant can't be accidentally emitted by today's R3 content-dump
  transformer until it's explicitly wired.
- The block `t` literal + field names are internal to admin; no
  cutover dependency.

The important call-out: schema-only additions need explicit
scope-boundary language in the plan ("no editor UX, no renderer") so
reviewers don't ask "where's the UI?" every time the feature is
audited.

### Single-dimensional test vectors cosine-collide

Test fixtures with `embedding_text: "[0.N]"` (one-dim scalars) all
have cosine similarity 1.0 regardless of N, because a single positive
scalar compared to another positive scalar is always the same unit
vector. The 3-layer dedup's embedding check then silently removes
everything. Default fixtures must be ≥2 dimensions with distinct
directions (e.g. `[1,0,0]`, `[0,1,0]`, `[0,0,1]`). The retriever-layer
tests don't hit this because they only test row mapping; it bites at
the orchestrator layer where dedup actually runs.

## Artifacts

- Plan: `docs/plans/2026-04-23-003-feat-admin-r5-recommendations-plan.md`
- Service: `apps/admin/src/services/scene-recommendations.service.ts`
- Retriever: `apps/admin/src/services/scene-recommendations-retriever.ts`
- Shared dedup: `apps/admin/src/services/video-dedup.ts`
- REST: `apps/admin/src/app/api/scene-embedding/recommendations/route.ts`
- GraphQL: `apps/admin/src/graphql/queries/scene-recommendations.ts`
- Zod variant: `apps/admin/src/domain/blocks.ts::VideoRecommendationsBlockSchema`
- cms source: `apps/cms/src/api/scene-embedding/{services,controllers,routes}/`
  - `apps/cms/src/graphql/recommendations.ts`
- apps/web consumer contract:
  `apps/web/src/lib/recommendations.ts` +
  `apps/web/src/components/sections/VideoRecommendations.tsx`

## Related learnings

- `admin-hybrid-search-r4-pattern.md` — the structural sibling.
- `dead-invariant-checks-from-sibling-port-20260422.md` — every SQL
  invariant re-derived against admin's schema; documents the specific
  deltas R5 inherits from R4 plus R5-only deltas (INNER vs LEFT join,
  `video_relation` vs `videos_children_lnk`, per-locale `themes`).
- `prototype-defaults-vs-data-derived-enumeration-20260422.md` — no
  hardcoded locale fallback; `locale` is a required boundary parameter.
