---
artifactType: issue
issueNumber: 187
issueTitle: "chore(tooling): add .claude/commands to repo for shared Claude Code workflow"
issueUrl: "https://github.com/JesusFilm/forge/issues/187"
state: "CLOSED"
closedAt: "2026-03-04T04:00:27Z"
labels: ["chore", "tooling"]
linkedPrs: []
---

# Issue Artifact: #187

## Background

The `work-issue` Claude Code command currently lives only at the user level (`~/.claude/commands/work-issue.md`). Moving it into the repo under `.claude/commands/` makes it a project-level command: all contributors get it automatically when they clone the repo, and changes are versioned alongside the code.

A `.claude/settings.local.json` file (machine-specific Claude Code state) must be gitignored to avoid committing local session data.

## Expected outcome

- `.claude/commands/work-issue.md` committed to the repo with the current command content.
- `.claude/settings.local.json` added to `.gitignore` so local Claude Code state is never committed.
- Contributors who clone the repo can run `/work-issue <number>` in Claude Code without any manual setup.

## Acceptance criteria

- [ ] `.claude/commands/work-issue.md` exists in the repo and matches the current user-level command.
- [ ] `.claude/settings.local.json` is covered by `.gitignore`.
- [ ] No other `.claude/` machine-specific files are committed.

## Possible solution(s)

1. Create `.claude/commands/work-issue.md` by copying from `~/.claude/commands/work-issue.md`.
2. Add `.claude/settings.local.json` (and optionally `.claude/` cache/debug dirs) to root `.gitignore`.

## References

- Current user-level command: `~/.claude/commands/work-issue.md`
- Claude Code custom commands docs: https://docs.anthropic.com/en/docs/claude-code/slash-commands

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
