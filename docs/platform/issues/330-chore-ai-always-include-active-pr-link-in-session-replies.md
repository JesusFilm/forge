---
artifactType: issue
issueNumber: 330
issueTitle: "chore(ai): always include active PR link in session replies"
issueUrl: "https://github.com/JesusFilm/forge/issues/330"
state: "CLOSED"
closedAt: "2026-03-10T03:05:01Z"
labels: []
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #330

## Background

We need a persistent agent rule so that once a pull request is opened, the assistant includes that PR URL in every subsequent message in the same session.

## Expected outcome

The workspace has an always-on Cursor rule that enforces including the active PR URL in all later assistant replies after PR creation.

## Acceptance criteria

- [ ] An always-on rule exists in `.cursor/rules/` for this behavior.
- [ ] Rule text clearly states the requirement starts after a PR is opened.
- [ ] Rule covers brief status updates, not only long responses.
- [ ] Rule behavior for multiple PRs is defined.

## Possible solution(s)

1. Add a dedicated `.mdc` rule file with `alwaysApply: true`.
2. Define active PR selection as most recently opened PR.

## References

- User request in this session

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
