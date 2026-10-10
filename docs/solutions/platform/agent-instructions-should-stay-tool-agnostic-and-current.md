---
title: "Agent instructions should stay tool-agnostic and current"
category: platform
date: 2026-04-13
tags:
  - documentation
  - agent-workflows
  - compound-engineering
  - mobile-v2
---

# Agent instructions should stay tool-agnostic and current

## Problem

Root execution guides can drift into assistant-specific wording and stale package references. When that happens, the repo rules become harder to apply outside one chat surface, and active package targets like `apps/mobile-v2/` can diverge from the instructions agents actually read first.

## Solution

Keep active instruction files focused on repo policy, not one assistant UI:

1. Put the short execution checklist in `AGENTS.md`.
2. Keep detailed conventions in `CLAUDE.md` or the package-local guide it points to.
3. Prefer workflow wording like "use Compound Engineering to brainstorm this ticket" over hard-coding one slash-command surface.
4. Update active instruction files together when package ownership changes, especially for deprecated paths like `apps/mobile/` and current targets like `apps/mobile-v2/`.
5. Review adjacent workflow config such as `compound-engineering.local.md` when changing root instructions so the dependency map and review checklist stay aligned.

## Files

- `AGENTS.md`
- `CLAUDE.md`
- `compound-engineering.local.md`
- `docs/roadmap/platform/feat-089-agent-agnostic-repo-instructions.md`
