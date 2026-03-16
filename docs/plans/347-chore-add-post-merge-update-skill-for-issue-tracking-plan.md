---
artifactType: plan
sourceIssueNumber: 347
sourceIssueTitle: "chore: add post-merge-update skill for issue tracking"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/347"
linkedPrs: []
---

# Plan Artifact: #347

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

## Source links

- Issue: [#347](https://github.com/JesusFilm/forge/issues/347)
- PRs:
- None
