---
name: forge-git-issues-prs
description: Teaches the agent how to create GitHub issues, branch from main, commit with conventional format, push, open PRs, and link issues (Resolves #N) in the Forge repo. Use when creating issues, opening PRs, or doing the git/GitHub workflow for Forge.
---

# Forge: Git, Issues, and PRs

Use with the mandatory workflow in `forge-workflow` and `gh-workflow`. This skill gives concrete steps and formats for issues, branches, commits, and PRs.

## 1. Create the issue first

Before any code, create a GitHub issue using the **Bounded Context Work Item** template. The template is defined in **`.github/ISSUE_TEMPLATE/bounded-context.yml`** (name: "Bounded Context Work Item"). Use it every time.

**Via GitHub CLI** — pass the template and a body that matches its structure (required: Background, Expected outcome, Acceptance criteria; optional: Possible solution(s), References):

```bash
gh issue create --template "Bounded Context Work Item" --title "type(scope): description" --body "## Background

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
- Related issue #N"
```

**Via web:** On the repo, click "New issue" and choose **Bounded Context Work Item** from the template dropdown so the form matches the template.

**Title:** Must use the template prefix `type(scope): ` (e.g. `feat(web): add validation`, `fix(cms): schema fix`, `chore(tooling): add commitlint`). Labels and assignee are often auto-applied from the title. Note the issue number from the output (e.g. `https://github.com/JesusFilm/forge/issues/52` → **52**).

## 2. Branch from main

Use the **issue number** and a short slug. Create branch from up-to-date `main`:

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feat/52-short-slug
# or: fix/52-short-slug
```

If using a fork (origin = their fork, upstream = JesusFilm/forge):

```bash
git fetch upstream
git checkout main
git merge upstream/main   # or: git reset --hard upstream/main
git checkout -b feat/52-short-slug
```

## 3. Plan on the issue

Post the plan as a comment via GitHub CLI:

```bash
gh issue comment <ISSUE_NUMBER> --body "## Execution plan

- [ ] Step 1
- [ ] Step 2
- [ ] ..."
```

When creating an execution plan (e.g. todo list), post it as a **comment on the issue** before starting work. Use GitHub “Add comment” or the API; Do not only keep the plan in the chat.

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

**If user has no write access to JesusFilm/forge:** ensure fork exists and remotes are correct. From repo root: `gh repo fork --remote=true` (creates fork, sets `origin` to their fork, `upstream` to JesusFilm/forge). Then push to `origin`.

Rebase on `main` before opening the PR:

```bash
git fetch origin
# if using fork, rebase on upstream: git fetch upstream && git rebase upstream/main
git rebase origin/main
# resolve conflicts if any, then:
git push -u origin feat/52-short-slug
```

**Open PR** targeting `main` on JesusFilm/forge. Use the **same title** as the issue.

- **Direct push (write access):** `gh pr create --base main --title "type(scope): description" --body "Resolves #52\n\n## Summary\n\n...\n\n## Contracts Changed\n\n- [ ] yes\n- [x] no\n\n## Regeneration Required\n\n- [ ] yes\n- [x] no\n\n## Validation\n\n- [ ] ..."`
- **From fork:** `gh pr create --repo JesusFilm/forge --base main --head USERNAME:feat/52-short-slug --title "type(scope): description" --body "Resolves #52\n\n## Summary\n\n...\n\n## Contracts Changed\n\n...\n\n## Regeneration Required\n\n...\n\n## Validation\n\n..."`

**In the PR description:** Include **`Resolves #52`** (or `Fixes #52`) at the top so the issue closes on merge. Fill the rest per `.github/PULL_REQUEST_TEMPLATE.md` (Summary, Contracts Changed, Regeneration Required, Validation).

## 6. Link issue in commits (optional but good)

In commit messages you can add `Resolves #123` or `Refs #123` to tie commits to the issue. The PR description **must** contain `Resolves #123` for auto-close.

## 7. After PR is open

- **Check CI:** `gh pr checks <PR_NUMBER> --repo JesusFilm/forge` (or use `mcp_GitHub_pull_request_read` with `method: get_status`). Fix failures and push; re-run or fix until all checks pass.
- Address review comments; add a PR comment summarizing what was fixed and what was not changed and why (see `handle-pr-review` skill).

## Quick reference

| Step        | Command / action                                              |
|------------|----------------------------------------------------------------|
| Issue      | Template: `.github/ISSUE_TEMPLATE/bounded-context.yml` (Bounded Context Work Item); title `type(scope): description` |
| Branch     | `feat/123-slug` or `fix/123-slug` from `main`                  |
| Commit     | `feat:`, `fix:`, `chore:`, `docs:`; atomic                    |
| PR title   | Same as issue                                                 |
| PR description | `Resolves #123` + PR template filled                      |
| Base       | `main`                                                        |
