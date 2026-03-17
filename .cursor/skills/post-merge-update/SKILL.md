---
name: post-merge-update
description: Updates plan docs after a PR merge. Use when the user confirms a PR has been merged and wants plan docs updated.
---

# Post-Merge Plan Update

When user confirms a PR has been merged:

## Steps

1. **Identify PR** — From context (conversation, branch, PR number) or ask. Fetch PR details and confirm it is merged. Extract the plan doc path from the PR body.

2. **Update plan doc** — Open the referenced plan doc. In the **Acceptance criteria** section, check off items satisfied by the PR. Add a brief merged note with PR link and date.

3. **Update linked docs** — Look for linked dependent plan docs in **References**. If found, add follow-up notes where needed and keep dependency status current.

4. **Report** — Summarize what was updated with links to plan docs and the merged PR.

## Notes

- Preserve existing plan content — only modify targeted sections.
- Always fetch latest file content before editing.
- If PR number unknown: infer from `git branch --show-current` or ask the user.
