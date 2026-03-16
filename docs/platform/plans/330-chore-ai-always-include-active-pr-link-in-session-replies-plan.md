---
artifactType: plan
sourceIssueNumber: 330
sourceIssueTitle: "chore(ai): always include active PR link in session replies"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/330"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #330

## Objective

The workspace has an always-on Cursor rule that enforces including the active PR URL in all later assistant replies after PR creation.

## Planned approach

1. Add a dedicated `.mdc` rule file with `alwaysApply: true`.
2. Define active PR selection as most recently opened PR.

## Validation

- [ ] An always-on rule exists in `.cursor/rules/` for this behavior.
- [ ] Rule text clearly states the requirement starts after a PR is opened.
- [ ] Rule covers brief status updates, not only long responses.
- [ ] Rule behavior for multiple PRs is defined.

## Source links

- Issue: [#330](https://github.com/JesusFilm/forge/issues/330)
- PRs:
- None
