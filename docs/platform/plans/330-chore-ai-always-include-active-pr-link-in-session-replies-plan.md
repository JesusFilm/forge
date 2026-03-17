---
artifactType: plan
sourceId: 330
sourceTitle: "chore(ai): always include active PR link in session replies"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "chore(ai): always include active PR link in session replies"

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

## References

- User request in this session

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
