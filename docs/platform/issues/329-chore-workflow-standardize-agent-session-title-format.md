---
artifactType: issue
issueNumber: 329
issueTitle: "chore(workflow): standardize agent/session title format"
issueUrl: "https://github.com/JesusFilm/forge/issues/329"
state: "CLOSED"
closedAt: "2026-03-10T02:38:28Z"
labels: []
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #329

## Background

Agent/session naming is currently documented as `{number}-{slug}`. Team wants a clearer stateful format that shows issue vs PR at a glance.

## Expected outcome

Agent/session titles use a consistent, human-scannable format that indicates work stage.

## Acceptance criteria

- [ ] Rule defines pre-PR format: `IS#<issueNumber> | <short label>`
- [ ] Rule defines post-PR format: `PR#<prNumber> | <short label>`
- [ ] Rule requires immediate rename after PR creation
- [ ] Existing workflow docs are updated to match the new rule

## Possible solution(s)

1. Add dedicated Cursor rule file for naming conventions.
2. Update `AGENTS.md` and workflow skill checklist/examples to match.

## References

- Existing workflow docs in `AGENTS.md`
- Existing rule in `.cursor/rules/gh-workflow.mdc`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
