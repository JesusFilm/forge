---
name: post-merge-update
description: After a PR is merged, update the resolved issue's acceptance criteria and the parent/epic issue's dependency tracking. Use when the user confirms a PR has been merged and wants issue tracking updated.
---

# Post-Merge Issue Update

Update GitHub issues after a PR merge — check off acceptance criteria on the resolved issue and mark it complete in the parent epic's dependency order.

## Steps

### 1. Identify the merged PR

- Use the PR number from context (conversation, branch, or user input).
- Fetch PR details: number, title, body, merge status.
- Extract the resolved issue number from the PR body (`Resolves #NNN` or `Closes #NNN`).
- Confirm the PR is merged before proceeding.

### 2. Update the resolved issue

- Fetch the issue body.
- In the **Acceptance criteria** section, check off items satisfied by the PR.
- Update the issue body via `gh issue edit`.
- Comment on the issue: `Resolved by #<PR> (merged). Acceptance criteria updated.`

### 3. Find and update the parent/epic issue

- Look for `Parent: #NNN` in the resolved issue's **References** section.
- If found, fetch the parent issue body.
- In the **Dependency order** section, strikethrough the completed item, add ✅ and a brief note (e.g. `— PR #<PR>; <summary>`).
- Update summary counts (e.g. "1 of 8 done" → "2 of 8 done").
- Update the parent issue body via `gh issue edit`.

### 4. Report

Summarize what was updated with links to both issues.

## Notes

- Preserve all existing issue body content — only modify the targeted sections.
- Always fetch the latest body before editing to avoid overwriting concurrent changes.
- Do not close the parent/epic issue.
