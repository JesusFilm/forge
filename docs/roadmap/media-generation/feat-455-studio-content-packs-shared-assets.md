---
id: "feat-455"
title: "Content Packs and shared authoring assets"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-09-07"
duration: 4
depends_on:
  - "feat-452"
  - "feat-454"
blocks:
  - "feat-456"
  - "feat-457"
  - "feat-458"
  - "feat-459"
  - "feat-461"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

Generation needs reusable source material and audio with provenance; the old Shorts picker can use language fallbacks and fresh transcription.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `CONCEPTS.md`
3. `apps/admin/src/services/media-asset.service.ts` and `apps/admin/src/services/media-asset.usage.ts`
4. `apps/admin/src/graphql/types/video.ts`
5. `apps/admin/prisma/schema.prisma`
6. `apps/manager/src/services/storage.ts`
7. `apps/manager/src/lib/state.ts`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `media-asset.usage|deleteMediaAsset|ContentPackRevision`
- `preferredPlayableDub|videoDub|videoEdition|vttSrc|MediaAssetKind|registerMediaAsset`

## What To Build

1. Implement ContentPack and immutable ContentPackRevision with separately represented source references and editorial guidance, assignable to standalone projects and later plan slots.
2. Extend existing MediaAsset registration and add Studio usage records for audio roles, narration text/model/voice/settings, checksums, reusable music/backgrounds, and generated-component code assets.
3. Resolve exact Forge video/dub/edition/language/subtitle identities and preserve timed-track bytes/digests and source-to-timeline mapping. Search is discovery only.
4. Import the inventoried paid assets through normal registration without regenerating them; preserve missing provenance explicitly.
5. Expose pack/asset selection in Studio with scoped upload/read capabilities and source reference inspection. Use existing storage adapters rather than a third registry.
6. Add durable Studio revision/attempt/pack/component/publication usage edges; the existing usage scanner only covers ExperienceLocale and VideoLocale. Integrate them into generic delete, replacement, and visibility operations. Replacing referenced bytes creates a new asset version.
7. Define explicit music/voice experiment request, estimated-cost and candidate/provenance contracts. Feat-458 implements provider execution and audition/selection; retain all candidates.

## Constraints

- Content Pack is not a viewer Video collection.
- No silent wrong-language playback or authoring-time Whisper replacement captions. Source eligibility includes current access and platform restrictions; derived catalog identity must not bypass them.
- Retain all assets initially. New music/voice experimentation is explicit.
- No new vector store or mandatory RAG ingest; reuse exact source selection first.

## Verification

- Test changed pack/source versions, exact language, wrong edition, missing subtitles, trim bounds, and multiple source ranges.
- Verify checksum-preserving real storage upload/read and restricted asset access.
- Verify source text versus instructions are distinguishable and usage references survive project edits.

- Verify generic asset deletion/replacement cannot remove referenced Studio bytes, including after publication and unpublication.
