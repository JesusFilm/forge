---
id: "feat-459"
title: "Generated video catalog identities and provenance"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-09-07"
duration: 4
depends_on:
  - "feat-454"
  - "feat-455"
blocks:
  - "feat-460"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

Generated outputs need real Forge Video/Dub/Edition records, but those currently require Core IDs. Ordinary parent-child links do not describe derivation.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `apps/admin/prisma/schema.prisma`
3. `apps/admin/src/graphql/types/video.ts`
4. `apps/admin/src/services/video.service.ts`
5. `apps/admin/src/services/core-sync/`
6. `packages/admin-graphql/`
7. `apps/web/src/lib/`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `model Video|model VideoDub|model VideoEdition|SourceTier|coreId|VideoRelation`

## What To Build

1. Implement MANAGER-origin generated Video, locale, dub, edition and Mux associations with normal Forge identity and idempotent staged ingest.
2. Plan additive nullability changes for Core IDs on Video/VideoDub/VideoEdition, with CORE-origin identity constraints, unique real Core IDs, and a complete GraphQL/consumer/sync audit. Never synthesize fake Core IDs.
3. Add derivation records referencing source Video/Dub/Edition, exact clip ranges, selected source/pack versions and generation metadata.
4. Keep staged ingest hidden and immutable release references distinct from draft project state; catalog visibility is finalized by feat-460.
5. Update nullable Core-ID consumers deliberately, including Manager, Watch, mobile/TV typed clients, source lookup and sync assumptions.

## Constraints

- Core-origin records remain read-only through authoring commands.
- Core sync must not overwrite generated MANAGER records.
- No public visibility from a mere render/Mux-complete event.

## Verification

- Database/schema tests create generated content without fake Core identifiers and preserve Core uniqueness/required identity invariants.
- Run schema/client generation plus consumer typechecks and affected builds.
- Test idempotent ingest, source derivation and unchanged Core sync behavior.
