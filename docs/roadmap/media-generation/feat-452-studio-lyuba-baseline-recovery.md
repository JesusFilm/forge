---
id: "feat-452"
title: "Preserve Lyuba devotional baseline"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-09-07"
duration: 2
depends_on:
  - "feat-451"
blocks:
  - "feat-455"
  - "feat-458"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

The latest creative fixes and paid assets came from a separate fork and local archive. The attached patch is not a self-contained change against the current checkout.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `docs/brainstorms/2026-09-07-studio-video-authoring-brief.md`
3. `docs/research/devotional-editor-feasibility.md`
4. `apps/mastra/src/services/devotional/`
5. `packages/shorts-compositions/src/devotional/`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `reflection-voice-check|settleLine|text-approved|continuousClip`

## What To Build

1. Resolve the full ancestry around 05f45858, 9d1e9335, and the later a5df2445 handoff; record exact commits and compare the actual diff instead of relying on handoff statistics.
2. Inventory the supplied devo-data archive, record hashes and provenance for the six saved scripts, narration, music, and corpus files, and preserve original bytes outside disposable worktrees.
3. Extract representative acceptance fixtures from saved work, including multi-card splits, continuous background behavior, full spoken-script fingerprints, and subtitle-aware clip boundaries.
4. Identify reusable generation logic separately from local CLI, filesystem, and old Workspace orchestration. Port only in later scoped implementation tickets.

## Constraints

- Do not regenerate paid media during inventory or delete the source worktree/archive.
- Do not blindly apply the patch or restore obsolete composition behavior from another branch.

## Verification

- Demonstrate the complete baseline is recoverable and identify missing dependencies/assets explicitly.
- Run the recovered baseline focused tests in isolation; distinguish historical test claims from tests actually run.
- Save fixture hashes and a reproducibility note alongside the implementation plan.

## Recovery evidence

[Recovery report](../../plans/2026-09-07-feat-452-lyuba-baseline-recovery.md)
records full ancestry, verified bundle, all 132 file hashes, provenance gaps,
six saved-script fixtures, and reproducibility commands. Original paid bytes
are preserved outside the worktree; no production pipeline code was ported.

Executed: recovered devotional suite 477 tests / 56 files; recovered full Mastra
suite 954 tests / 110 files; recovered composition suite 59 tests / 6 files;
both recovered typechecks; 10 acceptance checks. One historical test required
an explicitly recorded corpus-path adaptation. Dependencies were borrowed from
the installed current checkout, not installed from the historical lockfile.
No render or runtime-preview verification is claimed; missing source media,
MP4/full manifest, and provenance remain documented gaps for later scoped work.
