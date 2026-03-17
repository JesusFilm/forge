---
artifactType: plan
sourceId: 329
sourceTitle: "chore(workflow): standardize agent/session title format"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "chore(workflow): standardize agent/session title format"

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

## References

- Existing workflow docs in `AGENTS.md`
- Existing rule in `.cursor/rules/gh-workflow.mdc`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
