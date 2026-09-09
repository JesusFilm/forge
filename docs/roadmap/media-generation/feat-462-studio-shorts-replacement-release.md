---
id: "feat-462"
title: "Shorts replacement release verification"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-09-07"
duration: 3
depends_on:
  - "feat-461"
blocks: []
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

The replacement feature is named **Shorts** and keeps `/dashboard/shorts`. The unshipped public API, GraphQL names, MCP tools and OAuth scopes also use Shorts, without Studio compatibility aliases. Internal package and database names remain implementation details.

The replacement is complete only when Lyuba can use it end to end and obsolete Shorts behavior no longer competes with it.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `apps/manager/CLAUDE.md`
3. `apps/mastra/AGENTS.md`
4. `apps/shorts-worker/CLAUDE.md`
5. `docs/roadmap/media-generation/feat-178-manager-shorts-studio.md`
6. `docs/runbooks/devotional-workspace-cutover.md`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `shorts-draft-v1|SHORT_TEMPLATES|DEVOTIONAL_NEW_RUNS_ENABLED|ready_for_review`

## What To Build

1. Complete operator acceptance: standalone manual project, hosted/MCP generation, prompt change, paid-audio reuse, dynamic component, publish/download/unpublish, and calendar planning.
2. Remove legacy Shorts creation/caption/draft/clone UI and exclusive execution paths; retain shared infrastructure still used elsewhere. No archive/data migration is required.
3. Update roadmap supersession notes and package guidance for canonical library captions, Mastra Editor instruction ownership and the new Manager-led project lifecycle.
4. Record real Postgres/object-storage/Mux/worker restart and runtime evidence, UI performance, current authorization and deployment configuration, and independent disable controls.
5. Deploy via reviewed PRs to main and normal Railway flow, then record canary results and durable lessons in docs/solutions.

## Constraints

- Do not delete other consumers merely because a module is named shorts or devotional.
- Do not mark old unperformed deployment acceptance criteria as passed.
- No worktree production deployment, direct Railway redeploy shortcut or automatic asset deletion.

## Verification

- All plan acceptance scenarios have real evidence; database/source migrations and consumer checks pass.
- Fresh PR-focused checks, format, builds and worker container smoke pass for touched scope.
- Lyuba accepts the standalone path and the full Watch path; fallback disables new work without reopening published content.

## Local progress and remaining release gates

Legacy retirement is reviewed in `docs/validation/studio-462-retirement/README.md`.
The integrated local matrix and evidence are in
`docs/validation/studio-462-release/README.md` and `acceptance-matrix.md`; the
reviewable operator procedure is `docs/runbooks/studio-release-canary-and-rollback.md`.
Fresh owned Postgres replay and Studio Prisma alignment, independent default-off
production/publication admission controls, and focused regression coverage are
local evidence. Actual provider/creative/ElevenLabs, object storage, OCI/deployed
containment/private transport/Mux/revocation, Claude app login, performance and
Lyuba acceptance plus normal reviewed release remain open. This ticket stays
in progress; local checks do not waive the original full acceptance contract.
