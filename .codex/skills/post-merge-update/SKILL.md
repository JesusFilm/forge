---
name: post-merge-update
description: Update issue tracking after a PR merge by checking acceptance criteria and parent issue progress. Use when the user confirms a Forge PR merged or asks to update issue tracking after merge.
argument-hint: [pr-number]
---

# Post Merge Update

Use this workflow after a PR has merged.

## Steps

### 1. Identify the PR and confirm it is merged

Use the provided PR number, or infer it from the current branch. Fetch the PR and confirm `mergedAt` is set. Extract the resolved issue number from `Resolves #NNN` or `Closes #NNN` in the PR body.

### 2. Update the resolved issue

- Fetch the latest issue body.
- In the `Acceptance criteria` section, check off the items satisfied by the merged PR.
- Update the issue with `gh issue edit`.
- Add a comment such as `Resolved by #<PR> (merged). Acceptance criteria updated.`

Use `--body-file` with a temp file when updating large issue bodies.

### 3. Update the parent or epic issue

If the resolved issue references `Parent: #NNN` in `References`:

- Fetch the parent issue body.
- Update the `Dependency order` section to mark the completed item with `~~...~~` and `OK`.
- Update any summary counts that track completion progress.
- Save the body with `gh issue edit`.

### 4. Report what changed

Summarize the updates and include links to the resolved issue and the parent issue if one was updated.

## Notes

- Preserve all unrelated issue body content.
- Always fetch the latest issue body before editing.
- Do not close the parent or epic issue unless the user explicitly asks.
