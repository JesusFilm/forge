---
name: forge-git-issues-prs
description: Teaches the agent how to create GitHub issues, branch from main, commit with conventional format, push, open PRs, and link issues (Resolves #N) in the Forge repo. Use when creating issues, opening PRs, or doing the git/GitHub workflow for Forge.
---

# Forge: Git, Issues, and PRs

Use with the mandatory workflow in `forge-workflow` and `gh-workflow`. This skill gives concrete steps and formats for issues, branches, commits, and PRs.

## 1. Create the issue first

Before any code, create a GitHub issue using the **Bounded Context Work Item** template.

**Title:** `type(scope): description`  
Examples: `feat(web): add validation`, `fix(cms): schema fix`, `chore(tooling): add commitlint`

**Body structure** (use when creating via API or when guiding the user):

```markdown
## Background

[Why this is needed]

## Expected outcome

[Clear, testable outcome]

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Possible solution(s)

1. Option A - ...
2. Option B - ...

## References

- Link to doc
- Related issue #N
```

Template source: `.github/ISSUE_TEMPLATE/bounded-context.yml`. Labels and assignee are often auto-applied from the title.

## 2. Branch from main

Use the issue number and a short slug. Create branch from up-to-date `main`:

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feat/123-short-slug
# or: fix/123-short-slug
```

If using a fork with `upstream`:

```bash
git fetch upstream
git checkout main
git merge upstream/main   # or: git reset --hard upstream/main
git checkout -b feat/123-short-slug
```

## 3. Plan on the issue

When creating an execution plan (e.g. todo list), post it as a **comment on the issue** before starting work. Use GitHub “Add comment” or the API; do not only keep the plan in the chat.

## 4. Work and commit

- Make changes within the bounded context of the issue.
- If contracts change: run codegen in the same PR and tick “Regeneration Required: yes” in the PR template.

**Commits:** One per small block. Conventional format only:

- `feat: add X`
- `fix: resolve #123`
- `chore: update deps`
- `docs: update README`

Keep commits atomic and reviewable.

## 5. Push and open PR

Rebase on `main` before opening the PR:

```bash
git fetch origin
git rebase origin/main
# resolve conflicts if any, then:
git push origin feat/123-short-slug
```

If using a fork, push to the fork: `git push -u origin feat/123-short-slug`.

**Open PR** targeting `main`. Use the **same title** as the issue: `type(scope): description`.

**In the PR description:**

- Include **`Resolves #123`** (or `Fixes #123`) so the issue is linked and will close on merge.
- Fill the PR template:
  - **Summary** — bounded change and reason
  - **Contracts Changed** — yes/no
  - **Regeneration Required** — yes/no
  - **Validation** — checkboxes as applicable

Template: `.github/PULL_REQUEST_TEMPLATE.md`

## 6. Link issue in commits (optional but good)

In commit messages you can add `Resolves #123` or `Refs #123` to tie commits to the issue. The PR description **must** contain `Resolves #123` for auto-close.

## 7. After PR is open

- Ensure CI passes (see `forge-workflow`: use `mcp_GitHub_pull_request_read` with `method: get_status`).
- Address review comments; add a PR comment summarizing what was fixed and what was not changed and why (see `handle-pr-review` skill).

## Quick reference

| Step        | Command / action                                              |
|------------|----------------------------------------------------------------|
| Issue      | Bounded Context Work Item, title `type(scope): description`   |
| Branch     | `feat/123-slug` or `fix/123-slug` from `main`                  |
| Commit     | `feat:`, `fix:`, `chore:`, `docs:`; atomic                    |
| PR title   | Same as issue                                                 |
| PR description | `Resolves #123` + PR template filled                      |
| Base       | `main`                                                        |
