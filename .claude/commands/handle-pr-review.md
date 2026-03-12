Fetch and address PR review comments for the current branch. If a PR number is given as $ARGUMENTS, use that; otherwise infer from the current branch.

## Steps

### 1. Identify PR

If `$ARGUMENTS` is set, use it as the PR number. Otherwise infer from the branch:

```bash
gh pr list --repo JesusFilm/forge --head "$(git branch --show-current)" --json number --jq '.[0].number'
```

### 2. Fetch review comments

```bash
# Fetch thread-level state including resolution via GraphQL
gh api graphql -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          comments(first:100) {
            nodes { id author { login } body url }
          }
        }
      }
    }
  }
}' -F owner=JesusFilm -F repo=forge -F pr=<PR>
```

Also fetch review comment IDs to reply directly on each thread:

```bash
gh api repos/JesusFilm/forge/pulls/<PR>/comments --paginate \
  --jq '.[] | {id, in_reply_to_id, path, body, html_url}'
```

### 3. Filter actionable

- Ignore resolved threads.
- Focus on unresolved CodeRabbit, CodeQL, or human comments.
- Skip nitpicks marked "optional" unless explicitly requested.

### 4. Fix

- Apply changes per comment.
- One commit per logical change using conventional format (`fix:`, `chore:`).
- Keep commits atomic.

### 5. Push

```bash
git push
```

### 6. Reply directly on each review thread

Reply directly to each actionable review comment, not just with a top-level summary.

Use this query to reply on the specific thread:

```bash
gh api -X POST repos/JesusFilm/forge/pulls/<PR>/comments \
  -f body='<reply>' \
  -F in_reply_to=<COMMENT_ID>
```

Include exactly one of the following in each direct reply:

- how the feedback was handled
- a short reason for declining to address it
- one or more questions that need answers before proceeding

If the feedback was handled, resolve the conversation too:

```bash
gh api graphql -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) {
    thread { id isResolved }
  }
}' -F threadId=<THREAD_ID>
```

### 7. Post summary comment

```bash
gh pr comment <PR> --repo JesusFilm/forge --body "<summary>"
```

Post the summary comment too. Summarize every actionable review comment. For each one, include exactly one of:

- how the feedback was handled
- a short reason for declining to address it
- one or more questions that need answers before proceeding

Use this format:

```markdown
## Review feedback addressed (<sha>)

**Handled:**

- [comment]: [what changed]

**Declined:**

- [comment]: [reason]

**Questions / blocked:**

- [comment]: [question 1]
- [comment]: [question 2]
```

### 8. Re-check CI

```bash
gh pr checks <PR> --repo JesusFilm/forge
```

Fix any failures before marking complete.

## Session behavior

- **GitHub link in every message**: Include a clickable Markdown link to the active PR in every assistant message.
- **Auto commit and push**: After making requested changes, commit and push automatically. Do not ask whether to commit or push.
