---
artifactType: plan
sourceId: 347
sourceTitle: "chore: add post-merge-update skill for issue tracking"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "chore: add post-merge-update skill for issue tracking"

## Objective

A `/post-merge-update` command (Claude) and Cursor skill that automates post-merge housekeeping:

- Checks off acceptance criteria on the resolved issue
- Finds the parent/epic issue via `Parent: #NNN` in References
- Updates the epic's dependency order (strikethrough + ✅ + PR summary)
- Updates summary counts

## Planned approach

1. Claude command with step-by-step instructions using `gh` CLI for issue reads/edits.
2. Cursor skill mirroring the same steps for Cursor agent discovery.

## Validation

- [ ] Claude command at `.claude/commands/post-merge-update.md`
- [ ] Cursor skill at `.cursor/skills/post-merge-update/SKILL.md`
- [ ] Command registered in `CLAUDE.md`
- [ ] Both Claude and Cursor can discover and invoke the skill

## References

- Follows conventions from `work-issue.md` and `handle-pr-review.md`
- Uses `Parent: #NNN` pattern already established in issue bodies (e.g. #288 → Parent: #100)

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
