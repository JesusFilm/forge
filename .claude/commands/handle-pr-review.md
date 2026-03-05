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
          isResolved
          comments(first:100) {
            nodes { author { login } body url }
          }
        }
      }
    }
  }
}' -F owner=JesusFilm -F repo=forge -F pr=<PR>
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

### 6. Post summary comment

```bash
gh pr comment <PR> --repo JesusFilm/forge --body "<summary>"
```

Use this format:

```markdown
## Review feedback addressed (<sha>)

**Fixed:**

- [comment]: [what changed]

**Not changed:**

- [comment]: [reason]
```

### 7. Re-check CI

```bash
gh pr checks <PR> --repo JesusFilm/forge
```

Fix any failures before marking complete.
