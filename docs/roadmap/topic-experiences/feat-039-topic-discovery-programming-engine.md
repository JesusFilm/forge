---
id: "feat-039"
title: "Topic Programming Engine"
owner: "ekkasit"
priority: "P1"
status: "not-started"
start_date: "2026-06-02"
duration: 28
depends_on:
  - "feat-007"
  - "feat-020"
blocks:
  - "feat-040"
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

The roadmap defines how topic pages can be generated, but not how the system decides which topics deserve attention next from existing internal signals and editorial intent. The manager app needs a programming engine that assembles topic opportunities and recurring formats like daily devotionals so topic generation becomes guided and repeatable.

## Entry Points — Read These First

1. `docs/roadmap/topic-experiences/feat-007-topic-clustering.md` — cluster inputs that should seed programming decisions
2. `docs/roadmap/topic-experiences/feat-020-ai-topic-content-generation.md` — downstream topic-page generation contract
3. `apps/manager/src/services/metadata.ts` and `apps/manager/src/services/embeddings.ts` — current content signal patterns available inside manager
4. `apps/manager/src/app/` — existing dashboard route and API structure for new editorial queues
5. `apps/web/src/` — existing topic-page consumption side once generated content exists

## Grep These

- `topics|tags|speakers` in `apps/manager/src/services/metadata.ts`
- `EmbeddingsResult|chunkText` in `apps/manager/src/services/embeddings.ts`
- `topic` in `docs/roadmap/topic-experiences/`

## What To Build

1. New manager route: `apps/manager/src/app/dashboard/programming/page.tsx`
   - Ranked queue of topic candidates with evidence, freshness, audience fit, and status.
2. Discovery jobs:
   - Combine internal cluster signals, reviewed semantic clusters, and explicit editorial seeds.
   - Store evidence and scoring so operators can audit why a topic was suggested.
3. Program templates:
   - Create daily devotional sequences and other repeatable programming packages from existing videos/topic assets.
4. Editorial queue:
   - Convert candidates into topic-page briefs that feed existing generation flows.

## Constraints

- Programming suggestions inform editorial decisions; they do NOT auto-publish content.
- Do NOT build an unrestricted web crawler in manager.
- Keep the first version focused on programming and devotional packaging rather than SEO governance.

## Verification

- A discovery run produces ranked topic candidates with evidence.
- An operator can convert a candidate into a generation-ready brief.
- A daily devotional package can be assembled from existing video/topic assets.
- An editorial queue can review both topic-page and devotional candidates before publication.
