---
artifactType: issue
issueNumber: 347
issueTitle: "chore: add post-merge-update skill for issue tracking"
issueUrl: "https://github.com/JesusFilm/forge/issues/347"
state: "CLOSED"
closedAt: "2026-03-11T02:19:44Z"
labels: []
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #347

## Background

After a PR is merged, the resolved issue's acceptance criteria and the parent/epic issue's dependency tracking need to be updated manually. This is tedious and often forgotten, leaving epic issues out of date.

## Expected outcome

A `/post-merge-update` command (Claude) and Cursor skill that automates post-merge housekeeping:

- Checks off acceptance criteria on the resolved issue
- Finds the parent/epic issue via `Parent: #NNN` in References
- Updates the epic's dependency order (strikethrough + ✅ + PR summary)
- Updates summary counts

## Acceptance criteria

- [ ] Claude command at `.claude/commands/post-merge-update.md`
- [ ] Cursor skill at `.cursor/skills/post-merge-update/SKILL.md`
- [ ] Command registered in `CLAUDE.md`
- [ ] Both Claude and Cursor can discover and invoke the skill

## Possible solution(s)

1. Claude command with step-by-step instructions using `gh` CLI for issue reads/edits.
2. Cursor skill mirroring the same steps for Cursor agent discovery.

## References

- Follows conventions from `work-issue.md` and `handle-pr-review.md`
- Uses `Parent: #NNN` pattern already established in issue bodies (e.g. #288 → Parent: #100)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
