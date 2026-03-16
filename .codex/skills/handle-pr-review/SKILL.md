---
name: handle-pr-review
description: Address actionable PR review feedback with GitHub CLI and direct thread replies. Use when the user asks to check review feedback, fix PR comments, or close out review threads.
argument-hint: [pr-number]
---

# Handle PR Review

Use the provided PR number if one is given. Otherwise infer it from the current branch.

## Workflow

### 1. Identify the PR

If `$ARGUMENTS` is provided, use it directly:

```bash
PR="$ARGUMENTS"
```

If `$ARGUMENTS` is empty, infer the PR from the current branch and stop if this branch already has a merged PR:

```bash
if [ "$(gh pr list --repo JesusFilm/forge \
  --head "$(git branch --show-current)" \
  --state merged \
  --json number \
  --jq 'length')" -gt 0 ]; then
  echo "This branch already has a merged PR. Create a fresh branch from main." >&2
  exit 1
fi

PR=$(gh pr list --repo JesusFilm/forge \
  --head "$(git branch --show-current)" \
  --state open \
  --json number \
  --jq '.[0].number')
```

If `PR` is empty after the open-PR lookup, stop and ask the user for the PR number.

### 2. Fetch unresolved review context

Get review threads and thread resolution state:

```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          comments(first:100) {
            nodes {
              id
              body
              url
              author { login }
            }
          }
        }
      }
    }
  }
}' -F owner=JesusFilm -F repo=forge -F pr="$PR"
```

Fetch review comment IDs so replies can be posted on the right thread:

```bash
gh api repos/JesusFilm/forge/pulls/"$PR"/comments --paginate \
  --jq '.[] | {id, in_reply_to_id, path, body, html_url}'
```

### 3. Filter actionable feedback

- Ignore resolved threads.
- Focus on unresolved CodeRabbit, CodeQL, or human review comments.
- Skip comments explicitly marked optional unless the user wants them.

### 4. Apply fixes

Make the required code changes and keep commits atomic with conventional commit subjects.

### 5. Push

```bash
git push
```

### 6. Reply on each actionable thread

Reply directly to the relevant review comment:

```bash
gh api -X POST repos/JesusFilm/forge/pulls/"$PR"/comments \
  -f body='<reply>' \
  -F in_reply_to="$COMMENT_ID"
```

Each reply should do exactly one of these:

- say how the feedback was handled
- give a short reason for declining it
- ask the blocking question that still needs an answer

If the feedback was handled, resolve the review thread:

```bash
gh api graphql -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) {
    thread { id isResolved }
  }
}' -F threadId="$THREAD_ID"
```

### 7. Post a summary comment

Add a PR comment covering every actionable review item:

```bash
gh pr comment "$PR" --repo JesusFilm/forge --body "$(cat <<'EOF'
<summary>
EOF
)"
```

Use this structure:

```markdown
## Review feedback addressed (<sha>)

**Handled:**

- [comment]: [what changed]

**Declined:**

- [comment]: [reason]

**Questions / blocked:**

- [comment]: [question]
```

### 8. Re-check CI

```bash
gh pr checks "$PR" --repo JesusFilm/forge
gh run view <RUN_ID> --log-failed
```

If any checks fail, inspect each failed run with `gh run view <RUN_ID> --log-failed`, fix the issue, and push again before resolving the review.
