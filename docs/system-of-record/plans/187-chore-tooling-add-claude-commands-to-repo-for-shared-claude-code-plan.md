---
artifactType: plan
sourceIssueNumber: 187
sourceIssueTitle: "chore(tooling): add .claude/commands to repo for shared Claude Code workflow"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/187"
linkedPrs: []
---

# Plan Artifact: #187

## Objective

- `.claude/commands/work-issue.md` committed to the repo with the current command content.
- `.claude/settings.local.json` added to `.gitignore` so local Claude Code state is never committed.
- Contributors who clone the repo can run `/work-issue <number>` in Claude Code without any manual setup.

## Planned approach

1. Create `.claude/commands/work-issue.md` by copying from `~/.claude/commands/work-issue.md`.
2. Add `.claude/settings.local.json` (and optionally `.claude/` cache/debug dirs) to root `.gitignore`.

## Validation

- [ ] `.claude/commands/work-issue.md` exists in the repo and matches the current user-level command.
- [ ] `.claude/settings.local.json` is covered by `.gitignore`.
- [ ] No other `.claude/` machine-specific files are committed.

## Source links

- Issue: [#187](https://github.com/JesusFilm/forge/issues/187)
- PRs:
- None
