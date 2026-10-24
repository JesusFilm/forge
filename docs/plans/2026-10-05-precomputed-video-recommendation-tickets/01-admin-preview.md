---
date: 2026-10-05
draft_id: "01"
title: "Inspect saved recommendations in Admin"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2566
roadmap: feat-590
draft_blocked_by: []
---

# 01: Inspect saved recommendations in Admin

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Deliver the first private, end-to-end slice: submit a controlled recommendation
generation through authenticated Admin contracts, store it compactly, and select
a source Video in Admin to compare its saved results with the incumbent. A fixture
producer stands in for the model only in this first slice.

This establishes canonical Video identity, direct/alternative choices, evidence,
generation status, and a review surface that later slices can use. It must integrate
with the already merged compact recommendation formats and preserve public serving.

## Acceptance criteria

- [ ] An authenticated producer can submit an idempotent generation with source/target identities, ordering, relation/explanation, direct/alternative status, evidence basis/references, and input/model provenance. Unauthorized writes are denied.
- [ ] A generation has explicit incomplete, failed, and complete states. Only a complete, internally consistent generation can be previewed as ready; completion does not select a public strategy.
- [ ] Admin comparison accepts source Video, generation, and selected audio language, and shows incumbent versus experimental cards, English reasons, supporting excerpts, and honest metadata-only labels. Preview does not add A/B evidence or mutate public assignment.
- [ ] Fixture cases cover one, more than six, and zero accepted connections, precomputed alternatives, non-English evidence, and a language coverage gap. All accepted connections persist even when preview shows at most six.
- [ ] Self-references, duplicate content, alternate Dubs, invalid evidence references, and conflicting retry payloads are rejected or recorded as invalid before completion. Useful chapters/parent films carry additional-viewing-value explanations.
- [ ] The model-owned relationship data is stored once per generation; previews do not create per-visit copies of transcripts or reasoning.
- [ ] Native PostgreSQL contract tests prove idempotent writes, transactional completion, failed completion rollback, and correct Admin reads. Browser coverage proves comparison/empty states and checks its loading impact.
- [ ] Any GraphQL changes regenerate the shared contracts. The feature remains private/default-off and existing Watch behavior is unchanged.

## Implementation context

Reuse Admin catalog identities, recommendation request-detail authorization, and
existing authenticated ingest/client patterns. Use the build-to-review testing
boundary from the parent spec. Do not build a generic analytics or workflow
framework. Live provider and warehouse access are not prerequisites for this slice.

## Blocked by

None (can start immediately).

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
