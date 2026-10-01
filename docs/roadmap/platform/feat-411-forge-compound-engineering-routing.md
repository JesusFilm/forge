---
id: "feat-411"
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
- `ce:plan`
- `compound-engineering:lfg`
- `/home/lado/Projects`

## What To Build

1. Require available Compound Engineering skills for Forge software-engineering
   work regardless of checkout or worktree path.
2. Keep `AGENTS.md` and `CLAUDE.md` aligned on repository-identity routing.
3. Reserve the full `compound-engineering:lfg` shipping pipeline for an explicit
   user request while selecting the smallest fitting CE workflow otherwise.

## Constraints

- Do not change product code, runtime behavior, or deployment configuration.
- Do not weaken the existing requirement to plan, work, review, and compound.
- Do not make `lfg` implicit for ordinary Forge tasks.

## Verification

- Confirm both root guidance files contain the same routing and `lfg` policy.
- Run changed-file formatting and `git diff --check`.
