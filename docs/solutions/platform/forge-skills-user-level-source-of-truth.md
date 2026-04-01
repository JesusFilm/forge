---
title: "Forge skills belong at user level when .claude commands are canonical"
category: "platform"
date: "2026-04-01"
severity: "low"
tags:
  - tooling
  - codex
  - claude
  - workflow
modules:
  - .claude
related_issues:
  - "feat-037"
---

# Forge skills belong at user level when .claude commands are canonical

## Problem

The repo contained Forge-specific Codex workflow skills under `.codex/skills/` while `.claude/commands/work.md` had become the canonical workflow definition. That made the workflow live in two places and increased drift risk.

## Solution

Keep the repo-owned workflow definition in `.claude/commands/work.md`, and move Forge-specific Codex skills to the user-level Codex skills directory outside the repo.

## Why This Split

- The repo keeps one primary source of truth for workflow behavior.
- User-level Codex skills remain available locally without becoming repo maintenance burden.
- Workflow changes in `.claude` do not require mirrored repo-skill edits.

## Verification

- Repo-local Forge-specific skills are removed from `.codex/skills/`
- User-level Forge skills exist under `~/.codex/skills/`
- `.claude/commands/work.md` remains in the repo
