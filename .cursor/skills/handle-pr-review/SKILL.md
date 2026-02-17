---
name: handle-pr-review
description: Fetches PR review comments, applies fixes, commits, pushes, and posts a summary comment. Use when the user asks to check review feedback, address PR comments, fix review issues, or handle review feedback.
---

# Handle PR Review Feedback

When user asks to check/fix review feedback on a PR:

## Steps

1. **Identify PR** — From context (branch, issue number) or ask. Use `mcp_GitHub_pull_request_read` with `method: get_review_comments` and `method: get_reviews`.

2. **Filter actionable** — Ignore resolved threads. Focus on unresolved CodeRabbit, CodeQL, or human comments. Skip nitpicks marked "optional" unless user wants them.

3. **Fix** — Apply changes per comment. One commit per logical change (conventional: `fix:`, `chore:`). Atomic commits.

4. **Push** — `git push` to PR branch.

5. **Comment** — Add PR comment via `mcp_GitHub_add_issue_comment` summarizing:
   - What was fixed (with commit SHA)
   - What was intentionally not changed and why

## Example comment

```markdown
## Review feedback addressed (abc1234)

**Fixed:**
- [item]: [brief change]
- [item]: [brief change]

**Not changed:**
- [item]: [reason]
```

## Notes

- Workflow-level `permissions: contents: read` satisfies CodeQL; job-level override only if needed.
- Resolved threads: skip; comment may say "Addressed in commits X to Y".
- If PR number unknown: infer from `git branch --show-current` (e.g. `chore/3-lint-rollout` → PR for issue #3) or list PRs for branch.
