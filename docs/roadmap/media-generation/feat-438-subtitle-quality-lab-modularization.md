---
id: "feat-438"
title: "Subtitle quality lab modularization"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: null
duration: 4
depends_on:
  - "feat-397"
blocks: []
tags:
  - "manager"
  - "admin"
  - "subtitles"
  - "maintainability"
---

## Problem

The first Subtitle Quality Lab delivery keeps its service, GraphQL, Manager
client, dashboard, and service tests in large feature modules. The public
contracts are covered, but future changes will be harder to review and more
likely to collide until the existing domain boundaries become explicit files.

## Entry Points — Read These First

1. `docs/roadmap/media-generation/feat-397-subtitle-quality-lab.md` — shipped
   behavior, invariants, and validation contract.
2. `apps/admin/src/services/subtitle-eval.service.ts` — current Admin façade,
   policy, persistence, reviewer workflow, and evidence aggregation.
3. `apps/admin/src/graphql/types/managerSubtitleEval.ts` — current Pothos
   registration surface.
4. `apps/manager/src/features/subtitle-lab/subtitle-lab-admin-client.ts` —
   current operator and reviewer Admin client.
5. `apps/manager/src/features/subtitle-lab/subtitle-lab-dashboard.tsx` — current
   operator dashboard composition.

## Grep These

- `class SubtitleEvalService`
- `subtitleEvalService`
- `ManagerSubtitleEval`
- `SubtitleLabAdminClient`
- `SubtitleLabDashboard`

## What To Build

1. Keep `SubtitleEvalService` as a compatibility façade while extracting
   digest/policy, corpus/run lifecycle, reviewer assignment, and comparison
   evidence modules under `apps/admin/src/services/subtitle-eval/`.
2. Partition the Admin service tests by those public domains and keep shared
   builders in one test fixture module without dropping cases.
3. Split the Pothos schema registration into corpus, run/cell,
   reviewer-assignment, and report/comparison modules behind one explicit
   registration entry point.
4. Extract shared Manager GraphQL transport/session-proof helpers and create
   focused corpus/run, operator-assignment, and reviewer-assignment clients.
5. Split the operator dashboard into bounded sections while keeping shared
   loading and mutation state in a small container.

## Constraints

- Preserve every existing GraphQL, digest, authorization, artifact, workflow,
  reviewer, and UI behavior; this ticket is structural only.
- Do not hand-edit generated GraphQL outputs. Regenerate the Admin schema and
  `packages/admin-graphql` after schema-module changes.
- Keep operator and limited-reviewer access boundaries separate.
- Do not change the frozen corpus, prompt/model policy, or publication boundary.

## Verification

- Run the complete Subtitle Quality Lab Admin, Manager, Mastra, Auth, and
  Admin GraphQL suites from `feat-397`.
- Run affected package lint and type checks, schema generation, roadmap lint,
  and `git diff --check`.
- Confirm generated schema and typed-client changes are either empty or purely
  ordering-equivalent to the preserved contract.
- Browser-smoke the operator dashboard and limited-reviewer workspace.
