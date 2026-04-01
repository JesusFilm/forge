---
id: "feat-037"
title: "Move Forge Codex skills to user level"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-04-01"
duration: 1
depends_on: []
blocks: []
tags:
  - "tooling"
  - "platform"
---

## Problem

The repo currently carries Forge-specific Codex skills under `.codex/skills/`, while `.claude/commands/work.md` is now the primary workflow source of truth. Keeping repo-local Codex workflow skills alongside the repo's Claude commands creates drift risk and makes the workflow feel duplicated inside the codebase instead of installed as user tooling.

## Entry Points — Read These First

1. `.claude/commands/work.md` — current repo-level workflow source of truth
2. `CONTRIBUTING.md` — current branch naming and PR expectations
3. `.codex/skills/` — repo-local Codex skill directory to remove Forge-specific workflow skills from
4. `$CODEX_HOME/skills` or `~/.codex/skills` — user-level Codex skill location

## Grep These

- `\.codex/skills/` in the repo root — repo-local Codex skill location
- `forge-workflow\|work-issue\|handle-pr-review\|post-merge-update` — Forge-specific skill names to relocate
- `\.claude/commands/work\.md` — canonical workflow command to keep in-repo

## What To Build

1. Remove the Forge-specific Codex workflow skills from the repo under `.codex/skills/`.
2. Keep `.claude/commands/work.md` as the in-repo workflow source of truth.
3. Install the Forge-specific Codex skills into the user-level Codex skills directory outside the repo.
4. Ensure no in-repo references still point at the removed repo-local Forge skills.
5. Document the repo-vs-user-level split in `docs/solutions/`.

## Constraints

- Do NOT remove `.claude/commands/work.md`.
- Do NOT leave duplicated Forge workflow definitions in both `.claude` and repo-local `.codex/skills/`.
- Do NOT move unrelated user-level skills.
- Keep this PR scoped to workflow/tooling only.

## Verification

- `find .codex/skills -maxdepth 2 -type f | sort` should show no Forge-specific workflow skills in the repo after the change.
- `find ~/.codex/skills -maxdepth 2 -type f | sort | rg '/(forge-check|forge-work|work-issue|handle-pr-review|post-merge-update)/SKILL\\.md$'` should show the user-level installed skills.
- `rg -n "\.codex/skills/(forge-workflow|work-issue|handle-pr-review|post-merge-update)" .` should return no in-repo references.
- Review `.claude/commands/work.md` and confirm it remains the workflow source of truth.
