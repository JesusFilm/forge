---
artifactType: issue
issueNumber: 207
issueTitle: "chore(tooling): add Claude Code project guide, handle-pr-review command, and clean up work-issue reference"
issueUrl: "https://github.com/JesusFilm/forge/issues/207"
state: "CLOSED"
closedAt: "2026-03-05T03:59:23Z"
labels: ["chore", "tooling"]
linkedPrs: []
---

# Issue Artifact: #207

## Background

Claude Code is used for development workflows in this repo. The current tooling setup is missing a few pieces:

1. No `CLAUDE.md` project guide — Claude Code loads this automatically each session but it doesn't exist yet
2. No `/handle-pr-review` command — this workflow exists in Cursor but hasn't been ported to Claude Code
3. `work-issue.md` references `.cursor/rules/gh-workflow.mdc` which doesn't exist in this repo context

## Expected outcome

Claude Code sessions have a project guide loaded automatically, a `/handle-pr-review` command for addressing PR feedback, and no broken references in existing commands.

## Acceptance criteria

- [ ] `CLAUDE.md` created with project quick-reference (workflow, conventions, scoped AGENTS.md paths, CI commands)
- [ ] `.claude/commands/handle-pr-review.md` created with steps to fetch, filter, fix, push, and summarize PR review comments
- [ ] `.claude/commands/work-issue.md` updated to remove `.cursor/rules/gh-workflow.mdc` reference

## Possible solution(s)

Not provided in source issue.

## References

- `AGENTS.md`
- `.claude/commands/work-issue.md`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
