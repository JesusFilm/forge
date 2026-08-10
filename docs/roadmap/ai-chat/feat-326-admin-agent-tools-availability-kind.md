---
id: "feat-326"
title: "Admin agent-tools search-videos: expose availability.kind"
owner: "jian wei"
priority: "P1"
status: "complete"
start_date: "2026-08-03"
duration: 1
depends_on: []
blocks:
  - "feat-327"
tags:
  - "ai-pipeline"
  - "search"
---

## Resolution

**Shipped:** 2026-08-03 via [PR #1813](https://github.com/JesusFilm/forge/pull/1813) (`feat(admin): expose availability.kind on agent-tools search-videos (ai-chat feat-326)`).

**What landed.** The nested `availability: { kind }` projection exactly per the brief — report-only, no server-side kind filtering, in-process twin untouched. At ship time `watchabilityFromSubtitle` returned no playback, so the playable `target_subtitle` fixture was initially a deliberately synthetic contract pin. **Superseded 2026-08-05 by feat-346:** subtitle watchability now attaches a same-edition playable Dub, making that fixture production-reachable while preserving `target_subtitle` availability. A platform-lane feat-326 was created independently on main the same weekend — cross-lane duplicate IDs are accepted lane convention; this is the ai-chat feat-326.

**Compound docs.** [mocked-shape-vs-real-contract-discipline-20260506.md](../../solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — twenty-second worked instance ("deliberately synthetic contract-pinning fixture unlabeled as synthetic") + prevention checklist item 8.

**Residual risk / follow-ups.** **Resolved 2026-08-05 by feat-346:** the watchability change is now explicit and tested; playable `target_subtitle` rows can reach this route. Consumers that require target audio must continue filtering on `availability.kind`.

**Unblocked.** [feat-327](feat-327-seeker-video-tools-result-projection.md).

## Problem

The Seeker video-featuring arc (plan:
`docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md`, unit U1)
needs language-availability on the bearer-gated
`POST /api/internal/agent-tools/search-videos` response so the mastra-side
seeker tool can enforce the v1 `target_audio`-only policy (plan D5). The
response filters `playbackId !== null` but a playable row can still be a
FALLBACK row (`availability.kind` of `target_subtitle` / `related_language` —
e.g. an English dub offered for a non-English query). Today the projection
drops availability entirely.

> **Correction (2026-08-03, during U1 implementation):** the fallback example
> above overstates `target_subtitle` — a playable row cannot currently be a
> `target_subtitle` row: `watchabilityFromSubtitle`
> (`apps/admin/src/services/search-watchability.ts`) hardcodes
> `playbackId: null`, so only `target_audio` and `related_language` rows pass
> the playability filter today. "A playable dub in another language" is
> `related_language`'s shape. The required playable `target_subtitle` test
> fixture stands — it is deliberately synthetic, labeled as such in-place,
> and pins the no-kind-filter contract for kinds a future upstream change
> could make playable; the suite's playable `related_language` fixture covers
> the production-reachable fallback shape.

> **Superseding correction (2026-08-05, feat-346):**
> `watchabilityFromSubtitle` now attaches a playable Dub from the same Video
> Edition and emits that Dub's audio language as the watch action. A playable
> `target_subtitle` row is therefore production-reachable; its availability
> language remains the requested subtitle language.

This is the arc's PR 1 — tiny, additive, admin-only. Template: PR
[#1789](https://github.com/JesusFilm/forge/pull/1789) (commit `546a4361`),
which added `playbackId`/`durationSeconds`/`languageSlug` the same way.

## Entry Points — Read These First

1. `docs/plans/2026-08-02-001-feat-seeker-video-featuring-plan.md` — the arc
   plan; read Summary, D5, P5, P6, and unit U1 (this ticket).
2. `apps/admin/src/services/experience-ai/agent-tools.service.ts` —
   `AgentVideoResult` + `searchVideosForAgent` (the flatMap narrowing to
   extend). Note the header comment: the mastra caller is UNTRUSTED; filters
   live server-side.
3. `apps/admin/src/services/watch-search.service.ts` —
   `WatchSearchAvailability` / `WatchSearchAvailabilityKind`
   (`target_audio | target_subtitle | related_language | unavailable`);
   `WatchSearchResult.availability` is non-nullable.
4. `git show 546a4361` — the exact shape to mirror (projection, toStrictEqual
   tests, populated fixtures, route-shape assertion).

## Grep These

- `AgentVideoResult` (apps/admin/src)
- `playbackId !== null` (the narrowing this extends)
- `WatchSearchAvailabilityKind`
- `search-videos` in `apps/admin/src/app/api/internal/agent-tools/`

## What To Build

Add to `AgentVideoResult` (nested, mirroring the upstream shape so later
widening is additive — plan P6):

```ts
availability: {
  kind: WatchSearchAvailabilityKind
}
```

projected as `availability: { kind: result.availability.kind }` inside the
existing flatMap. HTTP response only — no GraphQL, no schema.graphql, no
codegen. Admin REPORTS kind and does NOT filter by it (the endpoint serves
multiple agent consumers; target_audio-only is seeker policy in mastra —
feat-327).

Refresh the divergence comment above `AgentVideoResult` (the in-process twin
`apps/admin/src/mastra/tools/search-videos.ts` stays untouched and now
diverges by one more field).

Required test scenarios (see plan U1 for the full list):

- `target_audio` row projects `availability: { kind: "target_audio" }` with
  all #1789 fields (`toStrictEqual`, populated fixture).
- A playable `target_subtitle` fixture projects its kind unchanged — proves
  the no-filter contract AND gives feat-327's filter a real upstream shape.
- Post-#1789 review note folded in: a playable row with
  `durationSeconds: null` AND `languageSlug: null` still projects, explicit
  nulls.
- `playbackId: null` rows still dropped regardless of kind.
- `routes.test.ts`: serialized response carries `availability.kind`.

## Constraints

- Do NOT filter by availability kind server-side.
- Do NOT touch the in-process twin, the GraphQL surface, or any env var.
- Do NOT widen the mastra client schemas here — that is feat-327's first
  commit (the schemas are tolerant of the extra field meanwhile; zod strips
  unknown keys).
- Additive only: existing response fields and their types are frozen.

## Verification

- `pnpm --filter @forge/admin test -- agent-tools` green (service + routes
  suites), `pnpm --filter @forge/admin typecheck` green.
- The `target_subtitle` fixture test FAILS if the projection filters by kind
  (falsify once by adding a kind filter locally — anti-vacuous check).
- No diff outside `apps/admin/src/services/experience-ai/` and
  `apps/admin/src/app/api/internal/agent-tools/`.
