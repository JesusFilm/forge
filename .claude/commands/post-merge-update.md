Update GitHub issues after a PR merge. If $ARGUMENTS is provided, use it as the PR number; otherwise infer from the current branch or ask.

## Steps

### 1. Identify the merged PR

If `$ARGUMENTS` is set, use it as the PR number. Otherwise infer from the branch:

```bash
gh pr list --repo JesusFilm/forge --head "$(git branch --show-current)" --state merged --json number --jq '.[0].number'
```

Fetch PR details:

```bash
gh pr view $PR --repo JesusFilm/forge --json number,title,body,mergedAt,state
```

- Confirm the PR is actually merged. If not merged, stop and inform the user.
- Extract the resolved issue number from the PR body (`Resolves #NNN` or `Closes #NNN`).

### 2. Update the resolved issue

Fetch the issue:

```bash
gh issue view $ISSUE --repo JesusFilm/forge --json title,body,number
```

- Parse the issue body's **Acceptance criteria** section (checkbox list).
- Check off all acceptance criteria that are satisfied by the merged PR's changes. Use the PR title, body, and commit messages to determine which criteria are met.

Update the issue body (use a temp file for large bodies):

```bash
gh issue edit $ISSUE --repo JesusFilm/forge --body-file /tmp/issue-body.md
```

Add a comment on the issue:

```bash
gh issue comment $ISSUE --repo JesusFilm/forge --body "Resolved by #$PR (merged). Acceptance criteria updated."
```

### 3. Find and update the parent/epic issue

- In the resolved issue's body, look for `Parent: #NNN` in the **References** section.
- If no parent is found, stop here and inform the user.

Fetch the parent issue:

```bash
gh issue view $PARENT --repo JesusFilm/forge --json title,body,number
```

- In the parent issue body, find the **Dependency order** section (or similar tracking section).
- Update the line referencing the resolved issue:
  - Add strikethrough (`~~...~~`) around the issue title/description if not already struck through.
  - Append ` ✅` marker and optionally `— PR #<PR>; <brief summary from PR>`.
  - Update any summary counts (e.g. "1 of 8 done" → "2 of 8 done").

Update the parent issue body:

```bash
gh issue edit $PARENT --repo JesusFilm/forge --body-file /tmp/parent-issue-body.md
```

### 4. Report

Print a summary:

- Issue #NNN: acceptance criteria checked off
- Parent #NNN: dependency order updated
- Links to both issues

## Notes

- Be careful with body edits — preserve all existing content; only modify the specific sections.
- Always fetch the latest body before editing to avoid overwriting concurrent changes.
- Use `--body-file` with a temp file for large issue bodies to avoid shell escaping issues.
- Do not close the parent/epic issue — it tracks multiple sub-issues.
