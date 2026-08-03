---
id: "feat-326"
title: "Admin agent-tools search-videos: expose availability.kind"
owner: "jian wei"
priority: "P1"
status: "not-started"
start_date: "2026-08-03"
duration: 1
depends_on: []
blocks:
  - "feat-327"
tags:
  - "ai-pipeline"
  - "search"
---

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
