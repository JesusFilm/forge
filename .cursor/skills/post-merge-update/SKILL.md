---
name: post-merge-update
description: Updates resolved issue acceptance criteria and parent epic dependency tracking after a PR merge. Use when the user confirms a PR has been merged, says a PR was merged, or asks to update issue tracking after merge.
---

# Post-Merge Issue Update

When user confirms a PR has been merged:

## Steps

1. **Identify PR** — From context (conversation, branch, PR number) or ask. Fetch PR details and confirm it is merged. Extract the resolved issue number from the PR body (`Resolves #NNN` or `Closes #NNN`).

2. **Update resolved issue** — Fetch the issue body. In the **Acceptance criteria** section, check off items satisfied by the PR. Update the issue body via `gh issue edit`. Comment on the issue: `Resolved by #<PR> (merged). Acceptance criteria updated.`

3. **Update parent/epic** — Look for `Parent: #NNN` in the resolved issue's **References** section. If found, fetch the parent issue body. In the **Dependency order** section, strikethrough the completed item, add ✅ and a brief note (e.g. `— PR #<PR>; <summary>`). Update summary counts (e.g. "1 of 8 done" → "2 of 8 done"). Update the parent issue body via `gh issue edit`.

4. **Report** — Summarize what was updated with links to both issues.

## Notes

- Preserve all existing issue body content — only modify the targeted sections.
- Always fetch the latest body before editing to avoid overwriting concurrent changes.
- Use `--body-file` with a temp file for large issue bodies.
- Do not close the parent/epic issue — it tracks multiple sub-issues.
- If PR number unknown: infer from `git branch --show-current` or ask the user.
