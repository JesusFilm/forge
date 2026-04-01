---
title: "chore: move Forge Codex workflow skills to user level"
type: chore
status: complete
date: 2026-04-01
origin: docs/roadmap/platform/feat-037-user-level-forge-skills.md
---

# chore: move Forge Codex workflow skills to user level

## Overview

The repo should keep `.claude/commands/work.md` as the canonical workflow source while the Forge-specific Codex skills live in the user's Codex skills directory outside the repo.

## Problem Statement

- The repo currently carries Forge-specific Codex skills under `.codex/skills/`.
- The repo now treats `.claude/commands/work.md` as the primary workflow source of truth.
- Keeping both in the repo creates unnecessary duplication and workflow drift risk.

## Proposed Solution

1. Copy the Forge-specific Codex skills to the user-level Codex skills directory.
2. Remove the repo-local Forge-specific Codex skills from `.codex/skills/`.
3. Leave `.claude/commands/work.md` untouched as the in-repo workflow source of truth.
4. Add a platform solution doc describing why the split exists.

## Files In Scope

- `.codex/skills/`
- `docs/roadmap/platform/feat-037-user-level-forge-skills.md`
- `docs/plans/2026-04-01-003-move-forge-skills-user-level-plan.md`
- `docs/solutions/platform/forge-skills-user-level-source-of-truth.md`

## Acceptance Criteria

- Repo-local Forge-specific Codex skills are removed from `.codex/skills/`.
- User-level Codex skills exist outside the repo.
- `.claude/commands/work.md` remains the canonical in-repo workflow definition.
- The repo contains a durable learning describing the split.

## Verification

- Confirm the user-level skill files exist under `~/.codex/skills/`.
- Confirm the repo no longer contains the removed Forge-specific skill files.
- Confirm there are no in-repo references to the removed repo-local skill paths.
