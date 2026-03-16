---
name: handle-pr-review
description: Fetches PR review comments, applies fixes, commits, pushes, and posts a summary comment. Use when the user asks to check review feedback, address PR comments, fix review issues, or handle review feedback.
---

# Handle PR Review Feedback

When user asks to check/fix review feedback on a PR:

## Steps

1. **Identify PR** — From context (branch, issue number) or ask. Use `gh pr view <PR> --repo JesusFilm/forge --json comments,reviews`.

2. **Filter actionable** — Ignore resolved threads. Focus on unresolved CodeRabbit, CodeQL, or human comments. Skip nitpicks marked "optional" unless user wants them.

3. **Fix** — Apply changes per comment. One commit per logical change (conventional: `fix:`, `chore:`). Atomic commits.

4. **Push** — `git push` to PR branch.

5. **Comment** — Add a PR comment with `gh pr comment <PR> --repo JesusFilm/forge --body "<summary>"` summarizing:
   - What was fixed (with commit SHA)
   - What was intentionally not changed and why

6. **Resolve threads** — As each review comment is addressed, mark the conversation resolved so reviewers see it’s done. Reply to the thread (e.g. `POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/replies` with a short “Addressed in commit X” or “Not changed: …”), then resolve the thread via GraphQL: `resolveReviewThread(input: { threadId: "<thread_id>" })`. Get unresolved thread IDs with a GraphQL query on the PR’s `reviewThreads(first: N) { nodes { id isResolved } }`.

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
- **Always resolve threads** after replying—each addressed comment should be marked resolved so the PR shows no outstanding conversations.
- If PR number unknown: infer from `git branch --show-current` (e.g. `chore/3-lint-rollout` → PR for issue #3) or list PRs for branch.
