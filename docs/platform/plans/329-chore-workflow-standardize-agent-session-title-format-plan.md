---
artifactType: plan
sourceIssueNumber: 329
sourceIssueTitle: "chore(workflow): standardize agent/session title format"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/329"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #329

## Objective

Agent/session titles use a consistent, human-scannable format that indicates work stage.

## Planned approach

1. Add dedicated Cursor rule file for naming conventions.
2. Update `AGENTS.md` and workflow skill checklist/examples to match.

## Validation

- [ ] Rule defines pre-PR format: `IS#<issueNumber> | <short label>`
- [ ] Rule defines post-PR format: `PR#<prNumber> | <short label>`
- [ ] Rule requires immediate rename after PR creation
- [ ] Existing workflow docs are updated to match the new rule

## Source links

- Issue: [#329](https://github.com/JesusFilm/forge/issues/329)
- PRs:
- None
