---
id: "feat-912"
title: "Forge Compound Engineering routing"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "infrastructure"
---

## Problem

Forge requires the Compound Engineering workflow, but personal path-based
routing can skip it when the repository is checked out as a Codex worktree
outside `/home/lado/Projects`. Repository guidance must make Forge identity,
not its checkout path, the routing rule.

## Entry Points - Read These First

1. `AGENTS.md` - the concise Forge execution guide used by Codex agents.
2. `CLAUDE.md` - the detailed Forge repository conventions.

## Grep These

- `## Compound Engineering`
- `ce-plan`
- `compound-engineering:lfg`
- `/home/lado/Projects`

## What To Build

1. Require available Compound Engineering skills for Forge software-engineering
   work regardless of checkout or worktree path.
2. Keep `AGENTS.md` and `CLAUDE.md` aligned on repository-identity routing.
3. Reserve the full `compound-engineering:lfg` shipping pipeline for an explicit
   user request while selecting the smallest fitting CE workflow otherwise.
4. Use the current `ce-plan`, `ce-work`, `ce-code-review`, and `ce-compound`
   skill names in both root guides.

## Constraints

- Do not change product code, runtime behavior, or deployment configuration.
- Do not weaken the existing requirement to plan, work, review, and compound.
- Do not make `lfg` implicit for ordinary Forge tasks.
- Workflow selection must respect the user's limits on delegation and publication
  and the repository production deployment boundary.
- Preserve unrelated current-main guidance and preexisting roadmap tickets when
  reconciling an older instruction change.

## Verification

- Confirm both root guidance files contain the same routing and `lfg` policy.
- Confirm the ticket filename and frontmatter use the same globally unique ID.
  Allocate against current main, fully paginated all-author open PR heads, and
  protected local refs, worktrees, indexes, and reservations.
- Verify introduced-ID collisions with the current-main
  `scripts/check-new-roadmap-ids.mjs` checks; preserve inherited collisions.
- Run changed-file Prettier and `git diff --check`.
