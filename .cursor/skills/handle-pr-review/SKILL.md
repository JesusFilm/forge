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

## Finding review comments

CodeRabbit (and other bots) post content across multiple GitHub API surfaces. Check all three:

1. **PR reviews** — `GET /repos/{owner}/{repo}/pulls/{n}/reviews` (formal review objects)
2. **PR inline comments** — `GET /repos/{owner}/{repo}/pulls/{n}/comments` (line-level review comments)
3. **Issue comments** — `GET /repos/{owner}/{repo}/issues/{n}/comments` (summary comments, walkthrough)

Also use the GraphQL `reviewThreads` query to get thread IDs and resolution status.

If CodeRabbit's issue comment says "Currently processing new changes", wait and re-check — it can take several minutes to complete.

## Verifying bot suggestions

Bot reviewers (CodeRabbit, CodeQL) can cite documentation that doesn't match the installed package version. Before applying a bot suggestion:

- Grep `node_modules/<package>` for the mentioned prop/API to confirm it exists
- Check the component's TypeScript types if available
- If the suggestion references a prop or API that doesn't exist in the codebase, reply explaining why it's not applicable and resolve the thread

## Notes

- Workflow-level `permissions: contents: read` satisfies CodeQL; job-level override only if needed.
- Resolved threads: skip; comment may say "Addressed in commits X to Y".
- **Always resolve threads** after replying—each addressed comment should be marked resolved so the PR shows no outstanding conversations.
- If PR number unknown: infer from `git branch --show-current` (e.g. `chore/3-lint-rollout` → PR for issue #3) or list PRs for branch.
